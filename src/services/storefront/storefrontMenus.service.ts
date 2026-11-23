import type { Request } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, storefrontCampaigns, storefrontMenuItems, storefrontMenus } from '../../db/schema.js';
import { NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { systemNowUtcIso } from '../../lib/businessClock.js';
import { OptimisticLockError, nextVersion } from '../../lib/occHelper.js';
import {
  MENU_LOCATIONS, MENU_LOCATION_TITLES, MENU_SITE_PAGES, isMenuIcon, isMenuLinkKind, isMenuSitePage, menuProblem,
  normalizedMenuItem, type MenuItemValues, type MenuLocation,
} from '../../lib/storefront/storefrontMenuRules.js';
import type { MenuItemRow, MenuLinkOptions, MenuSaveInput, MenuView, MenusView } from '../../lib/storefront/storefrontMenuContracts.js';
import { catalogItems } from './storefrontCatalog.service.js';
import { campaignOpenNow } from './storefrontCampaigns.service.js';
import { pageLinkTargets, type PageLinkTarget } from './storefrontPageLinks.js';
import { newsLinkTargets, newsListLive, type NewsLinkTarget } from './storefrontNewsLinks.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v12 phase 9b (package 18, V12_SITE_NEXT_START_PLAN.md §6): the site's menu builder on the ERP side. Reading needs
 * `site_content.view`, saving `site_content.manage`. A place is saved whole: its row is locked, a stale version is 409,
 * the items are added, changed or soft-deleted against the saved ones, and one audit row with the menu before and after
 * is written, all in one transaction. A place starts off and the site keeps its fixed menu until it is switched on.
 */
type ItemRecord = typeof storefrontMenuItems.$inferSelect;
type MenuRecord = typeof storefrontMenus.$inferSelect;

const AUDIT_ENTITY = 'منوی سایت';
const actorOf = (req: Request) => String((req.user as { username?: string } | undefined)?.username ?? '');
const invalid = (message: string, field: string, code: string) => new ValidationError(message, { field }, code);

/** What the site has now, to tell which links it would show */
interface SiteNow {
  categories: Set<string>;
  collections: Set<string>;
  products: Map<number, string>;
  campaigns: Map<number, { title: string; live: boolean }>;
  pages: Map<number, PageLinkTarget>;
  /** v12 phase 10d: the news items the menu names, and whether the site has its list of news now */
  news: Map<number, NewsLinkTarget>;
  newsList: boolean;
  /** the site takes orders, so it shows the cart and order tracking (9b review) */
  ordering: boolean;
}

async function siteNow(executor: DbExecutor, campaignIds: readonly number[], pageIds: readonly number[], newsIds: readonly number[]): Promise<SiteNow> {
  const settings = await storefrontSettingValues(executor);
  const onSale = await catalogItems(executor, settings);
  const campaigns = new Map<number, { title: string; live: boolean }>();
  if (campaignIds.length) {
    const rows = await executor.select({ id: storefrontCampaigns.id, title: storefrontCampaigns.title }).from(storefrontCampaigns)
      .where(and(inArray(storefrontCampaigns.id, [...campaignIds]), eq(storefrontCampaigns.isDeleted, 0)));
    const open = new Set((await executor.select({ id: storefrontCampaigns.id }).from(storefrontCampaigns)
      .where(and(inArray(storefrontCampaigns.id, [...campaignIds]), campaignOpenNow()))).map(r => r.id));
    for (const r of rows) campaigns.set(r.id, { title: r.title, live: open.has(r.id) });
  }
  return {
    categories: new Set(onSale.map(i => i.category).filter(Boolean)),
    collections: new Set(onSale.flatMap(i => i.collections)),
    products: new Map(onSale.map(i => [i.itemId, i.name])),
    campaigns,
    pages: await pageLinkTargets(executor, pageIds),
    news: await newsLinkTargets(executor, newsIds),
    newsList: await newsListLive(executor),
    ordering: settings.enabled && settings.ordersEnabled,
  };
}

function valuesOf(row: ItemRecord, children: MenuItemValues[]): MenuItemValues {
  return {
    id: row.id, label: row.label, kind: isMenuLinkKind(row.linkKind) ? row.linkKind : 'none', target: row.target,
    itemId: row.targetItemId, campaignId: row.targetCampaignId, pageId: row.targetPageId, newsId: row.targetNewsId, icon: isMenuIcon(row.icon) ? row.icon : '',
    isActive: row.isActive === 1, children,
  };
}

/** The saved items of a place as a tree, in their order */
function treeOf(rows: readonly ItemRecord[]): MenuItemValues[] {
  const byParent = new Map<number | null, ItemRecord[]>();
  for (const r of rows) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  const ordered = (list: ItemRecord[] = []) => [...list].sort((a, b) => (a.position - b.position) || (a.id - b.id));
  return ordered(byParent.get(null)).map(top => valuesOf(top, ordered(byParent.get(top.id)).map(child => valuesOf(child, []))));
}

/** pages the site shows only while it takes orders */
const ORDERING_PAGES: readonly string[] = ['cart', 'track'];

function rowOf(item: MenuItemValues, now: SiteNow): MenuItemRow {
  let live = item.isActive;
  let targetTitle = '';
  switch (item.kind) {
    case 'page':
      targetTitle = isMenuSitePage(item.target) ? MENU_SITE_PAGES[item.target].title : '';
      live &&= now.ordering || !ORDERING_PAGES.includes(item.target);
      // v12 phase 10d: the list of news is a page only while the site has news
      live &&= item.target !== 'news' || now.newsList;
      break;
    case 'category': live &&= now.categories.has(item.target); break;
    case 'collection': live &&= now.collections.has(item.target); break;
    case 'product':
      // 9b review: only a product on the site is named (an item's ERP name is not this screen's to read)
      targetTitle = item.itemId !== null ? (now.products.get(item.itemId) ?? '') : '';
      live &&= item.itemId !== null && now.products.has(item.itemId);
      break;
    case 'campaign': {
      const campaign = item.campaignId !== null ? now.campaigns.get(item.campaignId) : undefined;
      targetTitle = campaign?.title ?? '';
      live &&= Boolean(campaign?.live);
      break;
    }
    case 'content': {
      const page = item.pageId !== null ? now.pages.get(item.pageId) : undefined;
      targetTitle = page?.title ?? '';
      live &&= Boolean(page?.live);
      break;
    }
    case 'news': {
      const news = item.newsId !== null ? now.news.get(item.newsId) : undefined;
      targetTitle = news?.title ?? '';
      live &&= Boolean(news?.live);
      break;
    }
    default: break;
  }
  const children = item.children.map(child => rowOf(child, now));
  // a heading shows only with a child the site shows
  if (item.kind === 'none') live &&= children.some(c => c.live);
  return { ...item, id: item.id ?? 0, targetTitle, live, children };
}

async function menuViews(executor: DbExecutor, only?: MenuLocation): Promise<MenuView[]> {
  const menus = await executor.select().from(storefrontMenus).where(only ? eq(storefrontMenus.location, only) : undefined);
  const rows = await executor.select().from(storefrontMenuItems)
    .where(only ? and(eq(storefrontMenuItems.isDeleted, 0), eq(storefrontMenuItems.location, only)) : eq(storefrontMenuItems.isDeleted, 0))
    .orderBy(asc(storefrontMenuItems.position), asc(storefrontMenuItems.id));
  const now = await siteNow(
    executor, [...new Set(rows.map(r => r.targetCampaignId).filter((id): id is number => id !== null))],
    [...new Set(rows.map(r => r.targetPageId).filter((id): id is number => id !== null))],
    [...new Set(rows.map(r => r.targetNewsId).filter((id): id is number => id !== null))],
  );
  return MENU_LOCATIONS.filter(location => !only || location === only).flatMap((location): MenuView[] => {
    const menu = menus.find(m => m.location === location);
    if (!menu) return [];
    return [{
      location, enabled: menu.isEnabled === 1, version: menu.version, updatedBy: menu.updatedBy, updatedAt: menu.updatedAt,
      items: treeOf(rows.filter(r => r.location === location)).map(item => rowOf(item, now)),
    }];
  });
}

/** `GET /api/storefront/menus`: the four places with their items and whether the site would show each link now */
export async function listMenus(executor: DbExecutor): Promise<MenusView> {
  return { menus: await menuViews(executor) };
}

/** `GET /api/storefront/menus/link-options`: what a link may name, from the site as it is now */
export async function menuLinkOptions(executor: DbExecutor): Promise<MenuLinkOptions> {
  const onSale = await catalogItems(executor, await storefrontSettingValues(executor));
  const fa = (a: string, b: string) => a.localeCompare(b, 'fa');
  const campaigns = await executor.select({ id: storefrontCampaigns.id, title: storefrontCampaigns.title }).from(storefrontCampaigns)
    .where(eq(storefrontCampaigns.isDeleted, 0)).orderBy(asc(storefrontCampaigns.id));
  const open = new Set((await executor.select({ id: storefrontCampaigns.id }).from(storefrontCampaigns).where(campaignOpenNow())).map(r => r.id));
  return {
    categories: [...new Set(onSale.map(i => i.category).filter(Boolean))].sort(fa),
    collections: [...new Set(onSale.flatMap(i => i.collections).filter(Boolean))].sort(fa),
    campaigns: campaigns.map(c => ({ id: c.id, title: c.title, live: open.has(c.id) })),
    pages: [...await pageLinkTargets(executor)].map(([id, page]) => ({ id, title: page.title, live: page.live })),
    news: [...await newsLinkTargets(executor)].map(([id, news]) => ({ id, title: news.title, live: news.live })),
    products: onSale.map(i => ({ itemId: i.itemId, name: i.name, sku: i.sku })).sort((a, b) => fa(a.name, b.name)),
  };
}

/** The menu as a short list for the audit row: «عنوان ← مقصد», children indented */
function auditLines(list: readonly MenuItemValues[], indent = ''): string[] {
  return list.flatMap(item => {
    const target = item.kind === 'product' ? `کالا ${item.itemId}` : item.kind === 'campaign' ? `صفحهٔ ویژه ${item.campaignId}` : item.kind === 'content' ? `صفحهٔ متنی ${item.pageId}` : item.kind === 'news' ? `خبر ${item.newsId}` : item.target;
    const line = `${indent}${item.label} ← ${item.kind}${target ? `: ${target}` : ''}${item.icon ? ` [${item.icon}]` : ''}${item.isActive ? '' : ' (خاموش)'}`;
    return [line, ...auditLines(item.children, `${indent}  `)];
  });
}

async function lockedMenu(tx: DbExecutor, location: MenuLocation, expectedVersion: number): Promise<MenuRecord> {
  const [menu] = await tx.select().from(storefrontMenus).where(eq(storefrontMenus.location, location)).for('update');
  if (!menu) throw new NotFoundError('این منو پیدا نشد.', undefined, 'STOREFRONT_MENU_NOT_FOUND');
  if (menu.version !== expectedVersion) {
    throw new OptimisticLockError({ entityType: 'StorefrontMenu', entityId: location, expectedVersion, currentVersion: menu.version });
  }
  return menu;
}

/** The products, campaign pages and pages the menu names exist (a removed one is refused; one not on the site now is kept) */
async function checkReferences(tx: DbExecutor, list: readonly MenuItemValues[]): Promise<void> {
  const all = list.flatMap(i => [i, ...i.children]);
  const itemIds = [...new Set(all.map(i => i.itemId).filter((id): id is number => id !== null))];
  if (itemIds.length) {
    const found = new Set((await tx.select({ id: items.id }).from(items)
      .where(and(inArray(items.id, itemIds), eq(items.isDeleted, 0), eq(items.type, 'product')))).map(r => r.id));
    const missing = all.find(i => i.itemId !== null && !found.has(i.itemId));
    if (missing) throw invalid(`محصول «${missing.label}» در ERP نیست یا کالای تمام‌شده نیست.`, 'items', 'STOREFRONT_MENU_PRODUCT_UNKNOWN');
  }
  const campaignIds = [...new Set(all.map(i => i.campaignId).filter((id): id is number => id !== null))];
  if (campaignIds.length) {
    const found = new Set((await tx.select({ id: storefrontCampaigns.id }).from(storefrontCampaigns)
      .where(and(inArray(storefrontCampaigns.id, campaignIds), eq(storefrontCampaigns.isDeleted, 0)))).map(r => r.id));
    const missing = all.find(i => i.campaignId !== null && !found.has(i.campaignId));
    if (missing) throw invalid(`صفحهٔ ویژهٔ «${missing.label}» حذف شده است.`, 'items', 'STOREFRONT_MENU_CAMPAIGN_UNKNOWN');
  }
  const pageIds = [...new Set(all.map(i => i.pageId).filter((id): id is number => id !== null))];
  if (pageIds.length) {
    const found = await pageLinkTargets(tx, pageIds);
    const missing = all.find(i => i.pageId !== null && !found.has(i.pageId));
    if (missing) throw invalid(`صفحه‌ای که گزینهٔ «${missing.label}» به آن پیوند دارد در فهرست «صفحهٔ متنی» نیست (حذف شده یا از صفحه‌های پایه است)؛ صفحهٔ دیگری برگزینید یا این گزینه را بردارید.`, 'items', 'STOREFRONT_MENU_PAGE_UNKNOWN');
  }
  const newsIds = [...new Set(all.map(i => i.newsId).filter((id): id is number => id !== null))];
  if (newsIds.length) {
    const found = await newsLinkTargets(tx, newsIds);
    const missing = all.find(i => i.newsId !== null && !found.has(i.newsId));
    if (missing) throw invalid(`خبری که گزینهٔ «${missing.label}» به آن پیوند دارد در «خبرهای سایت» نیست (حذف شده است)؛ خبر دیگری برگزینید یا این گزینه را بردارید.`, 'items', 'STOREFRONT_MENU_NEWS_UNKNOWN');
  }
}

const columnsOf = (location: MenuLocation, item: MenuItemValues, parentId: number | null, position: number) => ({
  location, parentId, position, label: item.label, linkKind: item.kind, target: item.target, targetItemId: item.itemId,
  targetCampaignId: item.campaignId, targetPageId: item.pageId, targetNewsId: item.newsId, icon: item.icon, isActive: item.isActive ? 1 : 0,
});

/** `PUT /api/storefront/menus/:location`: the whole place, under its version */
export async function saveMenu(req: Request, location: MenuLocation, input: MenuSaveInput): Promise<MenuView> {
  const list = input.items.map(draft => normalizedMenuItem(location, draft));
  const found = menuProblem(location, list, input.enabled);
  if (found) throw invalid(found.message, found.field, found.code);
  const sentIds = list.flatMap(i => [i, ...i.children]).map(i => i.id).filter((id): id is number => id !== null);
  if (new Set(sentIds).size !== sentIds.length) throw invalid('یک گزینه دو بار در منو آمده است.', 'items', 'STOREFRONT_MENU_ITEM_TWICE');

  await orm.transaction(async (tx) => {
    const menu = await lockedMenu(tx, location, input.version);
    const saved = await tx.select().from(storefrontMenuItems)
      .where(and(eq(storefrontMenuItems.location, location), eq(storefrontMenuItems.isDeleted, 0))).for('update');
    const savedById = new Map(saved.map(r => [r.id, r]));
    const unknown = sentIds.find(id => !savedById.has(id));
    if (unknown !== undefined) throw invalid('گزینه‌ای از این منو دیگر نیست؛ صفحه را دوباره بخوانید.', 'items', 'STOREFRONT_MENU_ITEM_UNKNOWN');
    await checkReferences(tx, list);

    const actor = actorOf(req);
    const at = systemNowUtcIso();
    const kept = new Set<number>();
    const write = async (item: MenuItemValues, parentId: number | null, position: number): Promise<number> => {
      const columns = { ...columnsOf(location, item, parentId, position), updatedBy: actor, updatedAt: at };
      if (item.id !== null) {
        kept.add(item.id);
        await tx.update(storefrontMenuItems).set(columns).where(eq(storefrontMenuItems.id, item.id));
        return item.id;
      }
      const [row] = await tx.insert(storefrontMenuItems).values({ ...columns, createdBy: actor, createdAt: at }).returning({ id: storefrontMenuItems.id });
      return row.id;
    };
    for (const [position, item] of list.entries()) {
      const id = await write(item, null, position);
      for (const [childPosition, child] of item.children.entries()) await write(child, id, childPosition);
    }
    const removed = saved.filter(r => !kept.has(r.id)).map(r => r.id);
    if (removed.length) {
      await tx.update(storefrontMenuItems).set({ isDeleted: 1, isActive: 0, updatedBy: actor, updatedAt: at })
        .where(inArray(storefrontMenuItems.id, removed));
    }
    await tx.update(storefrontMenus)
      .set({ isEnabled: input.enabled ? 1 : 0, version: nextVersion(menu.version), updatedBy: actor, updatedAt: at })
      .where(eq(storefrontMenus.location, location));
    await logActivity({
      req, tx, action: 'UPDATE', entity: AUDIT_ENTITY, entityId: location,
      description: `${MENU_LOCATION_TITLES[location]} ذخیره شد${input.enabled ? '' : ' (روی سایت نیست)'}`,
      details: {
        before: { enabled: menu.isEnabled === 1, items: auditLines(treeOf(saved)) },
        after: { enabled: input.enabled, items: auditLines(list) },
      },
    });
  });
  const [view] = await menuViews(orm, location);
  return view;
}
