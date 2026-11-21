import request from 'supertest';
import { eq, gt, inArray, like, max, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, itemPrices, items, storefrontCampaigns, storefrontMenuItems, storefrontMenus, storefrontProducts } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v12 phase 9c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6, `AGENTS.md` §1.9c): `GET /api/storefront/v1/menus`, the
 * security review's contract on real Express routes and PostgreSQL. Only a place that is on goes out, with only items
 * that are on and lead somewhere the site has now; each item carries exactly label, href, external, icon, role and
 * children, the ERP builds every address (a product and a campaign page from their current slugs), and a place left with
 * nothing to show, or a bottom bar with fewer than three buttons, is null.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

/** a child item: the route takes no `children` key one level down */
const child = (label: string, kind: string, extra: Body = {}): Body => ({
  id: null, label, kind, target: '', itemId: null, campaignId: null, icon: '', isActive: true, ...extra,
});
const leaf = (label: string, kind: string, extra: Body = {}): Body => ({ ...child(label, kind), children: [], ...extra });

export async function runStorefrontMenusPublicV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_menus_public_v12_p9c';
  if (!shouldRun(id, 'v12', 'phase9', 'storefront', 'menus', 'security')) return results;

  const name = 'v12 phase 9c: the site reads only the menus that are on, only the links it has now, with the reviewed fields and the addresses the ERP built';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const campaignIds: number[] = [];
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const savedMenus = await orm.select().from(storefrontMenus);
  const [{ lastItem }] = await orm.select({ lastItem: max(storefrontMenuItems.id) }).from(storefrontMenuItems);
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const erp = {
      get: (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
    };
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];

    const retailList = `تکی منوی سایت ${tag}`;
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
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    const site = () => request(app).get('/api/storefront/v1/menus').set('Authorization', `Bearer ${apiKey}`);

    const category = `دسته سایت ${tag}`;
    const ring = await createTestItem({ name: `انگشتر سایت ${tag}`, code: `SF-P1-${tag}`, category });
    const hidden = await createTestItem({ name: `پنهان ${tag}`, code: `SF-P2-${tag}`, category: `دسته پنهان ${tag}` });
    itemIds.push(ring.id, hidden.id);
    for (const item of [ring, hidden]) await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money('3100000'), currency: 'IRR' });
    const slug = `site-ring-${tag}`;
    const pub = await erp.put(`/api/storefront/products/${ring.id}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 1, version: 0 });
    if (pub.status !== 200) throw new Error(`publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    const [live, off, later, past] = await orm.insert(storefrontCampaigns).values([
      { slug: `site-live-${tag}`, title: `صفحهٔ روشن ${tag}`, source: 'collection', collection: `کالکشن ${tag}`, isActive: 1 },
      { slug: `site-off-${tag}`, title: `صفحهٔ خاموش ${tag}`, source: 'collection', collection: `کالکشن ${tag}`, isActive: 0 },
      // 9c review: on, but outside its days
      { slug: `site-later-${tag}`, title: `صفحهٔ آینده ${tag}`, source: 'collection', collection: `کالکشن ${tag}`, isActive: 1, startsAt: sql`now() + interval '2 days'` },
      { slug: `site-past-${tag}`, title: `صفحهٔ گذشته ${tag}`, source: 'collection', collection: `کالکشن ${tag}`, isActive: 1, startsAt: sql`now() - interval '3 days'`, endsAt: sql`now() - interval '1 day'` },
    ]).returning({ id: storefrontCampaigns.id });
    campaignIds.push(live.id, off.id, later.id, past.id);

    // 1) every place off: four nulls, and nothing else in the answer
    const first = await site();
    if (first.status !== 200 || Object.keys(first.body.data ?? {}).sort().join() !== 'bottom,drawer,footer,header'
      || Object.values(first.body.data ?? {}).some(v => v !== null)) wrong.push(`all off: ${first.status} ${JSON.stringify(first.body)}`);

    // 2) a header on: only the links the site has, the addresses built by the ERP, the reviewed fields only
    const views = (await erp.get('/api/storefront/menus')).body.data.menus as Body[];
    const versionOf = (location: string) => Number(views.find(m => m.location === location)?.version);
    const saved = await erp.put('/api/storefront/menus/header', { enabled: true, version: versionOf('header'), items: [
      leaf('دربارهٔ ما', 'page', { target: 'about' }),
      leaf('ردیابی', 'page', { target: 'track' }),
      leaf('انگشترها', 'category', { target: category }),
      leaf('پنهان', 'category', { target: `دسته پنهان ${tag}` }),
      leaf('خاموش', 'page', { target: 'about', isActive: false }),
      { ...leaf('ویژه', 'none'), children: [
        child('انگشتر', 'product', { itemId: ring.id }), child('پنهان', 'product', { itemId: hidden.id }),
        child('روشن', 'campaign', { campaignId: live.id }), child('خاموش', 'campaign', { campaignId: off.id }),
        child('وبلاگ', 'url', { target: 'https://blog.papital-test.example/a' }),
      ] },
      { ...leaf('مرده', 'none'), children: [child('پنهان', 'product', { itemId: hidden.id })] },
    ] });
    if (saved.status !== 200) throw new Error(`header save: ${saved.status} ${JSON.stringify(saved.body)}`);
    const header = (await site()).body.data?.header as Body[] | null;
    const labels = (header ?? []).map(i => `${i.label}:${(i.children as Body[]).map(c => c.label).join('+')}`).join('|');
    // order tracking stays off while the site takes no order
    if (labels !== 'دربارهٔ ما:|انگشترها:|ویژه:انگشتر+روشن+وبلاگ') wrong.push(`header items: ${labels}`);
    const all = (header ?? []).flatMap(i => [i, ...(i.children as Body[])]);
    for (const item of all) {
      if (Object.keys(item).sort().join() !== 'children,external,href,icon,label,role') wrong.push(`item fields: ${Object.keys(item).sort().join()}`);
    }
    const hrefOf = (label: string) => all.find(i => i.label === label)?.href;
    if (hrefOf('دربارهٔ ما') !== '/about' || hrefOf('انگشترها') !== `/products?category=${encodeURIComponent(category)}`
      || hrefOf('انگشتر') !== `/p/${slug}` || hrefOf('روشن') !== `/campaigns/site-live-${tag}` || hrefOf('ویژه') !== '') {
      wrong.push(`hrefs: ${JSON.stringify(all.map(i => [i.label, i.href]))}`);
    }
    if (all.find(i => i.label === 'وبلاگ')?.external !== true || all.some(i => i.label !== 'وبلاگ' && i.external !== false)) wrong.push('external flags');
    if (JSON.stringify(header).match(/"id"|itemId|campaignId|updatedBy|version|3100000/)) wrong.push('the answer carries an id, an editor, a version or a price');

    // 3) a product's new slug is followed at once
    const [row] = await orm.select({ version: storefrontProducts.version }).from(storefrontProducts).where(eq(storefrontProducts.itemId, ring.id));
    const renamed = await erp.put(`/api/storefront/products/${ring.id}`, { published: true, slug: `${slug}-new`, seoTitle: '', seoDescription: '', sortOrder: 1, version: row.version });
    const afterRename = ((await site()).body.data?.header as Body[]).flatMap(i => [i, ...(i.children as Body[])]).find(i => i.label === 'انگشتر')?.href;
    if (renamed.status !== 200 || afterRename !== `/p/${slug}-new`) wrong.push(`after a new slug: ${renamed.status} ${afterRename}`);

    // 4) a bottom bar left with fewer than three buttons (home only: the cart waits for orders, the product is off the site)
    // is null; a turned-off place is null again
    const bottom = await erp.put('/api/storefront/menus/bottom', { enabled: true, version: versionOf('bottom'), items: [
      leaf('خانه', 'page', { target: 'home', icon: 'home' }), leaf('سبد', 'page', { target: 'cart', icon: 'bag' }),
      leaf('پنهان', 'product', { itemId: hidden.id, icon: 'gift' }),
    ] });
    const roles = await site();
    if (bottom.status !== 200 || roles.body.data?.bottom !== null) wrong.push(`a bottom bar of two live buttons: ${bottom.status} ${JSON.stringify(roles.body.data?.bottom)}`);
    const headerNow = (await erp.get('/api/storefront/menus')).body.data.menus.find((m: Body) => m.location === 'header');
    await erp.put('/api/storefront/menus/header', { enabled: false, version: headerNow.version, items: [leaf('ردیابی', 'page', { target: 'track' })] });
    if ((await site()).body.data?.header !== null) wrong.push('a place turned off still goes out');

    // 4b) the site takes no order here: the cart and order tracking stay off the site
    const cartOff = await erp.put('/api/storefront/menus/bottom', { enabled: true, version: bottom.body.data.version, items: [
      leaf('خانه', 'page', { target: 'home', icon: 'home' }), leaf('سبد', 'page', { target: 'cart', icon: 'bag' }),
      leaf('پیگیری', 'page', { target: 'track', icon: 'truck' }), leaf('من', 'page', { target: 'account', icon: 'user' }),
    ] });
    if (cartOff.status !== 200 || (await site()).body.data?.bottom !== null) wrong.push(`cart and tracking without orders: ${cartOff.status} ${JSON.stringify((await site()).body.data?.bottom)}`);
    // orders on (the stored switch; the settings form would also ask for a card and a treasury account)
    await orm.insert(appSettings).values({ key: 'sf_orders_enabled', value: '1' })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: '1' } });
    invalidateSettingsCache();

    // 5) the cart and the account are marked for the site, with their icons
    const third = await erp.put('/api/storefront/menus/bottom', { enabled: true, version: cartOff.body.data.version, items: [
      leaf('خانه', 'page', { target: 'home', icon: 'home' }), leaf('سبد', 'page', { target: 'cart', icon: 'bag' }),
      leaf('من', 'page', { target: 'account', icon: 'user' }),
    ] });
    const bar = (await site()).body.data?.bottom as Body[] | null;
    if (third.status !== 200 || (bar ?? []).map(b => `${b.role}/${b.icon}`).join() !== '/home,cart/bag,account/user') wrong.push(`bottom roles: ${JSON.stringify(bar)}`);
    if ((await request(app).get('/api/storefront/v1/menus')).status !== 401) wrong.push('the menus answer without the site key');

    // 6) the footer and the drawer: a campaign outside its days, a collection without items on the site, a path, an
    // item that is off with its children on (none go out but the path and the live collection)
    const views2 = (await erp.get('/api/storefront/menus')).body.data.menus as Body[];
    const versionNow = (location: string) => Number(views2.find(m => m.location === location)?.version);
    const collection = `کالکشن سایت ${tag}`;
    await orm.update(items).set({ collections: [collection] }).where(eq(items.id, ring.id));
    const footer = await erp.put('/api/storefront/menus/footer', { enabled: true, version: versionNow('footer'), items: [
      { ...leaf('ستون', 'none'), children: [
        child('آینده', 'campaign', { campaignId: later.id }), child('گذشته', 'campaign', { campaignId: past.id }),
        child('خالی', 'collection', { target: `کالکشن خالی ${tag}` }), child('پر', 'collection', { target: collection }),
        child('مسیر', 'path', { target: '/products?sort=newest' }),
      ] },
    ] });
    const drawer = await erp.put('/api/storefront/menus/drawer', { enabled: true, version: versionNow('drawer'), items: [
      leaf('دربارهٔ ما', 'page', { target: 'about' }),
      { ...leaf('خاموش با فرزند روشن', 'none', { isActive: false }), children: [child('روشن', 'page', { target: 'contact' })] },
    ] });
    const both = (await site()).body.data ?? {};
    const footerLinks = ((both.footer ?? [])[0]?.children ?? []).map((c: Body) => `${c.label}=${c.href}`).join('|');
    const expectedFooter = `پر=/collections/${encodeURIComponent(collection)}|مسیر=/products?sort=newest`;
    if (footer.status !== 200 || footerLinks !== expectedFooter) wrong.push(`footer: ${footer.status} ${footerLinks}`);
    if (drawer.status !== 200 || (both.drawer ?? []).map((i: Body) => i.label).join() !== 'دربارهٔ ما') wrong.push(`drawer: ${drawer.status} ${JSON.stringify(both.drawer)}`);

    // 6b) an outside address stored in the bottom bar (the editor refuses it; a row written another way) is no button, so
    // two site buttons with it are fewer than three
    const bottomNow = (await erp.get('/api/storefront/menus')).body.data.menus.find((m: Body) => m.location === 'bottom');
    const twoAndOut = await erp.put('/api/storefront/menus/bottom', { enabled: true, version: bottomNow.version, items: [
      leaf('خانه', 'page', { target: 'home', icon: 'home' }), leaf('جست‌وجو', 'page', { target: 'search', icon: 'search' }),
      leaf('سوم', 'page', { target: 'about', icon: 'book' }),
    ] });
    const third2 = (twoAndOut.body.data?.items as Body[] | undefined)?.find(i => i.label === 'سوم');
    await orm.update(storefrontMenuItems).set({ linkKind: 'url', target: 'https://blog.papital-test.example/' }).where(eq(storefrontMenuItems.id, Number(third2?.id ?? 0)));
    if (twoAndOut.status !== 200 || (await site()).body.data?.bottom !== null) wrong.push(`an outside address in the bottom bar: ${twoAndOut.status} ${JSON.stringify((await site()).body.data?.bottom)}`);

    // 7) the site switched off: the menus answer 404 like every route of the site
    await orm.update(appSettings).set({ value: '0' }).where(eq(appSettings.key, 'sf_enabled'));
    invalidateSettingsCache();
    const offSite = await site();
    if (offSite.status !== 404) wrong.push(`the menus while the site is off: ${offSite.status}`);

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
