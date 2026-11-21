import request from 'supertest';
import { and, desc, eq, gt, inArray, like, max } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, itemPrices, items, storefrontCampaigns, storefrontMenuItems, storefrontMenus, storefrontProducts } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v12 phase 9b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6, owner's decisions 3 and 15): the site's menu builder on real
 * Express routes and PostgreSQL.
 *
 * - The four places start off and empty (migration 0028).
 * - A place is saved whole under its version: a stale form is 409; a kept item keeps its row, a removed one is soft-deleted;
 *   one audit row per save with the menu before and after.
 * - Every rule is refused with its code: a heading without children, a second level, a footer column with a link, an
 *   unsafe path or address, a long label, a bottom bar with two carts or too few buttons, too many items, an unknown row
 *   or product. The database refuses the same shapes on its own (CHECK).
 * - Whether the site would show a link: a category or a collection with items on the site, a product on the site, a
 *   campaign page on and inside its days.
 * - `site_content.view` reads, `site_content.manage` saves; `storefront.manage` alone does neither.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const leaf = (label: string, kind: string, extra: Body = {}): Body => ({
  id: null, label, kind, target: '', itemId: null, campaignId: null, icon: '', isActive: true, ...extra,
});

export async function runStorefrontMenusV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_menus_v12_p9b';
  if (!shouldRun(id, 'v12', 'phase9', 'storefront', 'menus', 'occ', 'security')) return results;

  const name = 'v12 phase 9b: site menus start off, are saved whole under their version with soft deletes and one audit row, refuse every rule (also in the database), tell which links the site would show, and need site_content keys';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const campaignIds: number[] = [];
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const savedMenus = await orm.select().from(storefrontMenus);
  const [{ lastItem }] = await orm.select({ lastItem: max(storefrontMenuItems.id) }).from(storefrontMenuItems);
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    });
    const erp = as(await getAdminSession());
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];

    // the site's catalog: a retail list, one published item (its category and collection on the site), one that is not
    const retailList = `تکی منو ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const base = (await erp.get('/api/storefront/settings')).body.data;
    const on = await erp.put('/api/storefront/settings', {
      cardNumber: '', cardHolder: '', bankName: '', iban: '', freeShippingThreshold: '', reservationHours: 24, retailPriceList: retailList,
      wholesalePriceList: '', lowStockThreshold: 3, stockDisplay: 'status', warehouseCode: '', whatsappNumber: '', whatsappEnabled: false,
      enabled: true, ordersEnabled: false, treasuryAccountId: 0, openOrdersPerPhone: 3, version: base.version,
    });
    if (on.status !== 200) throw new Error(`turning the site on: ${on.status} ${JSON.stringify(on.body)}`);
    const category = `دسته منو ${tag}`;
    const collection = `کالکشن منو ${tag}`;
    const [onSite, offSite] = [await createTestItem({ name: `انگشتر منو ${tag}`, code: `SF-M1-${tag}`, category, collections: [collection] }),
      await createTestItem({ name: `دستبند منو ${tag}`, code: `SF-M2-${tag}`, category: `دسته خالی ${tag}` })];
    itemIds.push(onSite.id, offSite.id);
    for (const item of [onSite, offSite]) await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money('2500000'), currency: 'IRR' });
    const pub = await erp.put(`/api/storefront/products/${onSite.id}`, { published: true, slug: `menu-ring-${tag}`, seoTitle: '', seoDescription: '', sortOrder: 1, version: 0 });
    if (pub.status !== 200) throw new Error(`publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    const [live, off] = await orm.insert(storefrontCampaigns).values([
      { slug: `menu-live-${tag}`, title: `یلدای منو ${tag}`, source: 'collection', collection, isActive: 1 },
      { slug: `menu-off-${tag}`, title: `صفحهٔ خاموش ${tag}`, source: 'collection', collection, isActive: 0 },
    ]).returning({ id: storefrontCampaigns.id });
    campaignIds.push(live.id, off.id);

    // 1) four places, off and empty
    const first = (await erp.get('/api/storefront/menus')).body.data?.menus ?? [];
    const header0 = first.find((m: Body) => m.location === 'header');
    if (first.map((m: Body) => m.location).join() !== 'header,drawer,footer,bottom' || first.some((m: Body) => m.enabled !== false)) {
      wrong.push(`first view: ${JSON.stringify(first.map((m: Body) => [m.location, m.enabled]))}`);
    }

    // 2) a whole save: a page, a category on the site and one that is not, a heading with a collection, a product, two campaigns
    const header = [
      leaf('همه', 'page', { target: 'products' }),
      leaf('انگشتر', 'category', { target: category }),
      leaf('خالی', 'category', { target: `دسته خالی ${tag}` }),
      { ...leaf('بیشتر', 'none'), children: [
        leaf('کالکشن', 'collection', { target: collection }), leaf('انگشتر منو', 'product', { itemId: onSite.id }),
        leaf('دستبند', 'product', { itemId: offSite.id }), leaf('یلدا', 'campaign', { campaignId: live.id }),
        leaf('خاموش', 'campaign', { campaignId: off.id }), leaf('بیرون', 'url', { target: 'https://papitalgallery.com/blog' }),
      ] },
    ].map(i => ({ children: [], ...i }));
    const saved = await erp.put('/api/storefront/menus/header', { enabled: true, version: header0?.version ?? 1, items: header });
    const view = saved.body.data;
    const liveOf = (label: string) => [...(view?.items ?? []), ...(view?.items ?? []).flatMap((i: Body) => i.children as Body[])].find((i: Body) => i.label === label)?.live;
    if (saved.status !== 200 || view?.enabled !== true || view?.version !== (header0?.version ?? 1) + 1) wrong.push(`save: ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`);
    const expected: Array<[string, boolean]> = [['همه', true], ['انگشتر', true], ['خالی', false], ['بیشتر', true], ['کالکشن', true],
      ['انگشتر منو', true], ['دستبند', false], ['یلدا', true], ['خاموش', false], ['بیرون', true]];
    for (const [label, want] of expected) if (liveOf(label) !== want) wrong.push(`${label} live ${liveOf(label)}, not ${want}`);

    // 3) a stale form is 409
    const stale = await erp.put('/api/storefront/menus/header', { enabled: false, version: header0?.version ?? 1, items: [] });
    if (stale.status !== 409) wrong.push(`a stale save: ${stale.status}`);

    // 4) a kept item keeps its row, a removed one is soft-deleted, and each save writes one audit row
    const kept = (view.items as Body[]).filter(i => i.label !== 'خالی').map(i => ({ ...i, children: (i.children as Body[]).map(({ children: _c, live: _l, targetTitle: _t, ...c }) => c) }))
      .map(({ live: _l, targetTitle: _t, ...i }) => i);
    const again = await erp.put('/api/storefront/menus/header', { enabled: true, version: view.version, items: kept });
    const rows = await orm.select().from(storefrontMenuItems).where(and(eq(storefrontMenuItems.location, 'header'), gt(storefrontMenuItems.id, lastItem ?? 0)));
    const removedRow = rows.find(r => r.label === 'خالی');
    if (again.status !== 200 || removedRow?.isDeleted !== 1 || rows.filter(r => r.isDeleted === 0).length !== 9) {
      wrong.push(`second save: ${again.status}, removed ${removedRow?.isDeleted}, live rows ${rows.filter(r => r.isDeleted === 0).length}`);
    }
    const sameIds = (again.body.data?.items ?? []).map((i: Body) => i.id).join() === (view.items as Body[]).filter(i => i.label !== 'خالی').map(i => i.id).join();
    if (!sameIds) wrong.push('a kept item got a new row');
    const audits = await orm.select({ details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'منوی سایت'), eq(activityLogs.entityId, 'header'))).orderBy(desc(activityLogs.id)).limit(5);
    if (audits.length < 2 || !JSON.stringify(audits[0].details).includes('خالی')) wrong.push(`audit rows: ${audits.length}`);

    // 5) every rule refused with its code
    const bottomVersion = (await erp.get('/api/storefront/menus')).body.data.menus.find((m: Body) => m.location === 'bottom').version;
    const footerVersion = (await erp.get('/api/storefront/menus')).body.data.menus.find((m: Body) => m.location === 'footer').version;
    const nowVersion = again.body.data?.version;
    const refusals: Array<[string, string, Body[], boolean, number, string]> = [
      ['a heading without children', 'header', [{ ...leaf('عنوان', 'none'), children: [] }], false, nowVersion, 'STOREFRONT_MENU_HEADING_EMPTY'],
      ['javascript:', 'header', [{ ...leaf('بد', 'url', { target: 'javascript:alert(1)' }), children: [] }], false, nowVersion, 'STOREFRONT_MENU_URL_INVALID'],
      ['http:', 'header', [{ ...leaf('بد', 'url', { target: 'http://papitalgallery.com' }), children: [] }], false, nowVersion, 'STOREFRONT_MENU_URL_INVALID'],
      ['a protocol-relative path', 'header', [{ ...leaf('بد', 'path', { target: '//evil.example/x' }), children: [] }], false, nowVersion, 'STOREFRONT_MENU_PATH_INVALID'],
      ['a long label', 'header', [{ ...leaf('ا'.repeat(41), 'page', { target: 'home' }), children: [] }], false, nowVersion, 'STOREFRONT_MENU_LABEL_TOO_LONG'],
      ['an unknown page', 'header', [{ ...leaf('صفحه', 'page', { target: 'admin' }), children: [] }], false, nowVersion, 'STOREFRONT_MENU_PAGE_INVALID'],
      ['eleven items', 'header', Array.from({ length: 11 }, (_, n) => ({ ...leaf(`گزینه ${n}`, 'page', { target: 'home' }), children: [] })), false, nowVersion, 'STOREFRONT_MENU_TOO_MANY'],
      ['a removed product', 'header', [{ ...leaf('کالا', 'product', { itemId: 2_000_000_000 }), children: [] }], false, nowVersion, 'STOREFRONT_MENU_PRODUCT_UNKNOWN'],
      ['an unknown row', 'header', [{ ...leaf('ردیف', 'page', { target: 'home', id: 2_000_000_000 }), children: [] }], false, nowVersion, 'STOREFRONT_MENU_ITEM_UNKNOWN'],
      ['a footer column with a link', 'footer', [{ ...leaf('ستون', 'page', { target: 'home' }), children: [] }], false, footerVersion, 'STOREFRONT_MENU_FOOTER_HEADING'],
      ['two carts', 'bottom', ['cart', 'cart', 'home'].map(t => ({ ...leaf('دکمه', 'page', { target: t, icon: 'bag' }), children: [] })), false, bottomVersion, 'STOREFRONT_MENU_BOTTOM_TWICE'],
      ['two buttons on', 'bottom', ['home', 'cart'].map(t => ({ ...leaf('دکمه', 'page', { target: t, icon: 'bag' }), children: [] })), true, bottomVersion, 'STOREFRONT_MENU_BOTTOM_FEW'],
      ['a button without an icon', 'bottom', ['home', 'search', 'cart'].map(t => ({ ...leaf('دکمه', 'page', { target: t }), children: [] })), false, bottomVersion, 'STOREFRONT_MENU_ICON_REQUIRED'],
    ];
    for (const [label, location, list, enabled, version, code] of refusals) {
      const res = await erp.put(`/api/storefront/menus/${location}`, { enabled, version, items: list });
      if (res.status !== 422 || res.body.code !== code) wrong.push(`${label}: ${res.status} ${res.body.code}`);
    }
    const deep = await erp.put('/api/storefront/menus/header', { enabled: false, version: nowVersion, items: [
      { ...leaf('بالا', 'none'), children: [{ ...leaf('میانه', 'page', { target: 'home' }), children: [leaf('ته', 'page', { target: 'home' })] }] },
    ] });
    if (deep.status < 400 || deep.status >= 500) wrong.push(`a second level: ${deep.status}`);

    // 6) the database refuses the same shapes on its own
    const refusedRow = async (values: Partial<typeof storefrontMenuItems.$inferInsert>) => {
      try {
        await orm.transaction(async (tx) => {
          await tx.insert(storefrontMenuItems).values({ location: 'header', label: 'آزمون', linkKind: 'page', target: 'home', ...values });
          throw new Error('rollback');
        });
        return false;
      } catch (err) {
        return err instanceof Error && err.message !== 'rollback';
      }
    };
    const shapes: Array<[string, Partial<typeof storefrontMenuItems.$inferInsert>]> = [
      ['an unknown kind', { linkKind: 'script' }], ['an http address', { linkKind: 'url', target: 'http://x.example' }],
      ['a // path', { linkKind: 'path', target: '//x.example' }], ['an icon in the header', { icon: 'home' }],
      ['a product without its item', { linkKind: 'product', target: '' }], ['a flag of 2', { isActive: 2 }], ['an empty label', { label: '' }],
    ];
    for (const [label, values] of shapes) if (!(await refusedRow(values))) wrong.push(`the database kept ${label}`);

    // 7) site_content.view reads, site_content.manage saves, storefront.manage alone does neither
    const sessionWith = async (permissions: string[]) => as(await loginTestUserWithSession(app, (await createTestUser({ role: (await createTestRole({ permissions })).code })).username));
    const shop = await sessionWith(['storefront.view', 'storefront.manage']);
    const reader = await sessionWith(['site_content.view']);
    const editor = await sessionWith(['site_content.view', 'site_content.manage']);
    const drawerVersion = (await erp.get('/api/storefront/menus')).body.data.menus.find((m: Body) => m.location === 'drawer').version;
    const body = { enabled: false, version: drawerVersion, items: [{ ...leaf('خانه', 'page', { target: 'home' }), children: [] }] };
    const statuses = [
      (await shop.get('/api/storefront/menus')).status, (await shop.put('/api/storefront/menus/drawer', body)).status,
      (await reader.get('/api/storefront/menus')).status, (await reader.get('/api/storefront/menus/link-options')).status,
      (await reader.put('/api/storefront/menus/drawer', body)).status, (await editor.put('/api/storefront/menus/drawer', body)).status,
    ].join();
    if (statuses !== '403,403,200,200,403,200') wrong.push(`access: ${statuses}`);
    const options = (await reader.get('/api/storefront/menus/link-options')).body.data;
    if (!options?.categories?.includes(category) || options?.categories?.includes(`دسته خالی ${tag}`) || !options?.collections?.includes(collection)
      || !options?.products?.some((p: Body) => p.itemId === onSite.id) || options?.products?.some((p: Body) => p.itemId === offSite.id)
      || options?.campaigns?.find((c: Body) => c.id === off.id)?.live !== false) {
      wrong.push(`link options: ${JSON.stringify(options).slice(0, 300)}`);
    }

    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: wrong.length === 0, durationMs: Date.now() - tStart,
      error: wrong.length ? wrong.join(' | ') : undefined,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await orm.delete(storefrontMenuItems).where(gt(storefrontMenuItems.id, lastItem ?? 0)).catch(() => undefined);
    for (const menu of savedMenus) await orm.update(storefrontMenus).set(menu).where(eq(storefrontMenus.location, menu.location)).catch(() => undefined);
    if (campaignIds.length) await orm.delete(storefrontCampaigns).where(inArray(storefrontCampaigns.id, campaignIds)).catch(() => undefined);
    if (itemIds.length) {
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
    await orm.delete(appSettings).where(like(appSettings.key, 'sf\\_%')).catch(() => undefined);
    if (savedSettings.length > 0) await orm.insert(appSettings).values(savedSettings).catch(() => undefined);
    if (savedStrategies.length > 0) {
      await orm.update(appSettings).set({ value: savedStrategies[0].value }).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    } else {
      await orm.delete(appSettings).where(eq(appSettings.key, 'pricing_strategies')).catch(() => undefined);
    }
    invalidateSettingsCache();
  }
  return results;
}
