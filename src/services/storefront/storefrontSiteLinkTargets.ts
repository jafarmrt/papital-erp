import { and, eq, inArray } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { items, storefrontCampaigns } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { isMenuLinkKind, menuRuleHref } from '../../lib/storefront/storefrontMenuRules.js';
import type { SiteLink } from '../../lib/storefront/storefrontSiteLinks.js';
import { publicItemsOnSale } from './storefrontCatalog.service.js';
import { campaignOpenNow } from './storefrontCampaigns.service.js';
import { newsLinkTargets, newsListLive } from './storefrontNewsLinks.js';
import { pageLinkTargets } from './storefrontPageLinks.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v12 phase 10e: where a link chosen as in the menus leads on the site now, moved out of `storefrontMenuPublic.ts`
 * unchanged so a slide's button and a banner are resolved by the same code as a menu item. The ERP builds every
 * address: a product's, a campaign page's, a page's and a news item's from their current slugs, so a link follows a
 * change of slug; a link whose target the site does not have now (a category or collection with no item on the site,
 * a product off the site, a campaign page outside its days, an unpublished page, the cart while no order is taken)
 * leads nowhere.
 */
export interface LinkRef {
  kind: string;
  target: string;
  itemId: number | null;
  campaignId: number | null;
  pageId: number | null;
  newsId: number | null;
}

const ids = (list: ReadonlyArray<number | null>): number[] => [...new Set(list.filter((id): id is number => id !== null))];

/** For some links, a function that gives each one's address on the site now, or null when it leads nowhere today */
export async function siteLinkResolver(refs: readonly LinkRef[]): Promise<(ref: LinkRef) => string | null> {
  const onSale = await publicItemsOnSale();
  const settings = await storefrontSettingValues(orm);
  const ordering = settings.enabled && settings.ordersEnabled;
  const categories = new Set(onSale.map(i => i.category).filter(Boolean));
  const collections = new Set(onSale.flatMap(i => i.collections));
  const productSlugs = new Map(onSale.map(i => [i.itemId, i.slug]));
  const campaignIds = ids(refs.map(r => r.campaignId));
  const campaignSlugs = new Map(campaignIds.length === 0 ? [] : (await orm.select({ id: storefrontCampaigns.id, slug: storefrontCampaigns.slug })
    .from(storefrontCampaigns).where(and(inArray(storefrontCampaigns.id, campaignIds), campaignOpenNow()))).map(r => [r.id, r.slug]));
  const pages = await pageLinkTargets(orm, ids(refs.map(r => r.pageId)));
  // v12 phase 10d: the news items named, and whether the site has its list of news now (read only when a link leads there)
  const news = await newsLinkTargets(orm, ids(refs.map(r => r.newsId)));
  const newsList = refs.some(r => r.kind === 'page' && r.target === 'news') && await newsListLive(orm);

  return (ref) => {
    const kind = isMenuLinkKind(ref.kind) ? ref.kind : null;
    switch (kind) {
      case 'category': return categories.has(ref.target) ? menuRuleHref(kind, ref.target) : null;
      case 'collection': return collections.has(ref.target) ? menuRuleHref(kind, ref.target) : null;
      case 'product': {
        const slug = ref.itemId !== null ? productSlugs.get(ref.itemId) : undefined;
        return slug ? `/p/${encodeURIComponent(slug)}` : null;
      }
      case 'campaign': {
        const slug = ref.campaignId !== null ? campaignSlugs.get(ref.campaignId) : undefined;
        return slug ? `/campaigns/${encodeURIComponent(slug)}` : null;
      }
      case 'content': {
        // v12 phase 10c: the address is the page's own of now, so the link follows a change of it; a page off the site leads nowhere
        const page = ref.pageId !== null ? pages.get(ref.pageId) : undefined;
        return page?.live ? page.href : null;
      }
      case 'news': {
        // v12 phase 10d: the address is the item's own; an item that is not on the site now leads nowhere
        const item = ref.newsId !== null ? news.get(ref.newsId) : undefined;
        return item?.live ? item.href : null;
      }
      case 'page':
        if (ref.target === 'news' && !newsList) return null;
        return !ordering && (ref.target === 'cart' || ref.target === 'track') ? null : menuRuleHref(kind, ref.target);
      case 'path': case 'url': return menuRuleHref(kind, ref.target);
      default: return null;
    }
  };
}

/**
 * The product, campaign page, page and news item some links name exist (a removed one is refused with the words that
 * name the link; one that is only off the site now is kept, and the site leaves its button out until it is back)
 */
export async function checkSiteLinkReferences(tx: DbExecutor, links: ReadonlyArray<{ link: SiteLink; label: string }>): Promise<void> {
  const refuse = (message: string) => new ValidationError(message, { field: 'sections' }, 'STOREFRONT_PAGE_LINK_UNKNOWN');
  const itemIds = ids(links.map(l => l.link.itemId));
  if (itemIds.length) {
    const found = new Set((await tx.select({ id: items.id }).from(items).where(and(inArray(items.id, itemIds), eq(items.isDeleted, 0), eq(items.type, 'product')))).map(r => r.id));
    const missing = links.find(l => l.link.itemId !== null && !found.has(l.link.itemId));
    if (missing) throw refuse(`محصولی که ${missing.label} به آن پیوند دارد در ERP نیست یا کالای تمام‌شده نیست؛ محصول دیگری برگزینید.`);
  }
  const campaignIds = ids(links.map(l => l.link.campaignId));
  if (campaignIds.length) {
    const found = new Set((await tx.select({ id: storefrontCampaigns.id }).from(storefrontCampaigns).where(and(inArray(storefrontCampaigns.id, campaignIds), eq(storefrontCampaigns.isDeleted, 0)))).map(r => r.id));
    const missing = links.find(l => l.link.campaignId !== null && !found.has(l.link.campaignId));
    if (missing) throw refuse(`صفحهٔ ویژه‌ای که ${missing.label} به آن پیوند دارد حذف شده است؛ پیوند دیگری برگزینید.`);
  }
  const pageIds = ids(links.map(l => l.link.pageId));
  if (pageIds.length) {
    const found = await pageLinkTargets(tx, pageIds);
    const missing = links.find(l => l.link.pageId !== null && !found.has(l.link.pageId));
    if (missing) throw refuse(`صفحه‌ای که ${missing.label} به آن پیوند دارد در «صفحه‌های سایت» نیست (حذف شده یا از صفحه‌های پایه است)؛ صفحهٔ دیگری برگزینید.`);
  }
  const newsIds = ids(links.map(l => l.link.newsId));
  if (newsIds.length) {
    const found = await newsLinkTargets(tx, newsIds);
    const missing = links.find(l => l.link.newsId !== null && !found.has(l.link.newsId));
    if (missing) throw refuse(`خبری که ${missing.label} به آن پیوند دارد در «خبرهای سایت» نیست (حذف شده است)؛ خبر دیگری برگزینید.`);
  }
}
