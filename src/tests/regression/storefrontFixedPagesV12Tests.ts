import request from 'supertest';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, storefrontContentAssets, storefrontPages } from '../../db/schema.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { FIXED_PAGES } from '../../lib/storefront/storefrontPageRules.js';

/**
 * v12 phase 10c (owner's decision 23, migration 0032; docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, `AGENTS.md` §1.9c):
 * the words of the pages whose work is in the site's code, on real Express routes and PostgreSQL. Migration 0032 makes
 * a row of kind 'fixed' each (nine by migration 0032, a tenth for the list of news by 0034), unpublished. A row takes a title, at most one text and the search words, under its own
 * name; it is never removed, moved or previewed, and no other page takes a name under `fixed-`. Published, its words
 * go to the site by name (`GET /v1/pages/<name>`, kind 'fixed') and are in no list of pages; unpublished, the name is a
 * 404 again and the site keeps its own words.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontFixedPagesV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_fixed_pages_v12_p10c';
  if (!shouldRun(id, 'v12', 'phase10', 'storefront', 'pages', 'fixed', 'migration', 'security')) return results;

  const name = 'v12 phase 10c: a fixed page keeps only its words under its own name, is never removed, moved or previewed, and goes to the site by name and in no list';
  const tStart = Date.now();
  const customIds: number[] = [];
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const fixedBefore = await orm.select().from(storefrontPages).where(eq(storefrontPages.kind, 'fixed'));
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const erp = {
      get: (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      del: (url: string) => request(app).delete(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
    };
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const keys = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');

    const retailList = `تکی ثابت ${tag}`;
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
    const site = (url: string) => request(app).get(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`);

    // 1) the rows of the migrations (nine of 0032, the tenth of 0034): after the base pages, in their order, with the words of today as their titles
    const list = (await erp.get('/api/storefront/pages')).body.data as Array<{ id: number; kind: string; slug: string; title: string; status: string }>;
    const fixedRows = list.filter(row => row.kind === 'fixed');
    if (fixedRows.map(row => `${row.slug}:${row.title}`).join(',') !== FIXED_PAGES.map(page => `${page.slug}:${page.title}`).join(',')) {
      wrong.push(`the fixed rows: ${fixedRows.map(row => row.slug).join(',')}`);
    }
    const kindsInOrder = list.map(row => row.kind).join(',').replace(/(base,)+/, 'base,').replace(/(fixed,?)+/, 'fixed,').replace(/(custom,?)+$/, 'custom');
    if (!/^base,fixed,(custom)?$/.test(kindsInOrder)) wrong.push(`the order of the list: ${kindsInOrder}`);
    const cart = fixedRows.find(row => row.slug === 'fixed-cart');
    if (!cart) throw new Error('no row for the cart page');
    // nothing is on the site by these names before anything is published
    const before = await Promise.all(fixedBefore.filter(row => row.published === null).slice(0, 3).map(row => site(`/pages/${row.slug}`)));
    if (before.some(res => res.status !== 404)) wrong.push(`an unpublished fixed row on the site: ${before.map(res => res.status).join(',')}`);

    const detail = (await erp.get(`/api/storefront/pages/${cart.id}`)).body.data as { version: number };
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const text = (words: string) => ({ kind: 'text', background: 'white', doc: { type: 'doc', content: [p(words)] } });
    const form = (version: number, over: Body = {}) => ({
      title: `سبد شما ${tag}`, slug: 'fixed-cart', seoTitle: 'سبد خرید گالری', seoDescription: 'کالاهایی که برداشته‌اید', noindex: false, shareImageAssetId: null,
      sections: [text('پیش از پرداخت، تعداد را نگاه کنید.')], version, ...over,
    });

    // 2) what a fixed row refuses: another name, a second part, a part that is no text, the search switch, a share image
    const refusals: Array<[string, Body]> = [
      ['another name', { slug: 'fixed-search' }], ['a name of the shop\'s own', { slug: `cart-${tag}` }],
      ['two texts', { sections: [text('یک'), text('دو')] }],
      ['a button', { sections: [{ kind: 'button', background: 'white', label: 'خرید', href: '/products' }] }],
      ['the search switch', { noindex: true }], ['a share image', { shareImageAssetId: 1 }],
      // a few lines, not an article: the words of «پیدا نشد» ride in every page of the site
      ['a text of 2001 letters', { sections: [text('ب'.repeat(2001))] }],
    ];
    for (const [what, over] of refusals) {
      const res = await erp.put(`/api/storefront/pages/${cart.id}`, form(detail.version, over));
      if (res.status !== 400 && res.status !== 422) wrong.push(`a fixed row took ${what}: ${res.status}`);
    }
    const saved = await erp.put(`/api/storefront/pages/${cart.id}`, form(detail.version));
    if (saved.status !== 200 || saved.body.data.kind !== 'fixed' || saved.body.data.slug !== 'fixed-cart' || saved.body.data.draft.sections.length !== 1) {
      wrong.push(`saving a fixed row's words: ${saved.status} ${JSON.stringify(saved.body).slice(0, 200)}`);
    }
    let version = Number(saved.body.data?.version);

    // 3) never removed, moved or previewed
    const [removal, move, preview] = [
      await erp.del(`/api/storefront/pages/${cart.id}?version=${version}`), await erp.post(`/api/storefront/pages/${cart.id}/move`, { slug: `moved-${tag}`, version }),
      await erp.post(`/api/storefront/pages/${cart.id}/preview`),
    ];
    // each is refused by the service, by name (the table's own check would refuse a removal too, with another code)
    if ([removal, move, preview].some(res => res.status !== 400 && res.status !== 422) || removal.body.code !== 'STOREFRONT_PAGE_BASE_KEPT' || move.body.code !== 'STOREFRONT_PAGE_BASE_KEPT'
      || preview.body.code !== 'STOREFRONT_PAGE_PREVIEW_FIXED') {
      wrong.push(`removal, move and preview of a fixed row: ${removal.status} ${removal.body.code}/${move.status} ${move.body.code}/${preview.status} ${preview.body.code}`);
    }
    const [row] = await orm.select().from(storefrontPages).where(eq(storefrontPages.id, cart.id));
    if (row.isDeleted !== 0 || row.slug !== 'fixed-cart' || row.previewHash !== null) wrong.push('a refused removal, move or preview changed the row');

    // 4) no other page takes a name under `fixed-`: not a new page, not a saved draft, not a move
    const madeFixed = await erp.post('/api/storefront/pages', { title: `جعلی ${tag}`, slug: `fixed-fake-${tag}`, template: null });
    const made = await erp.post('/api/storefront/pages', { title: `صفحهٔ فروشگاه ${tag}`, slug: `shop-page-${tag}`, template: null });
    if (made.status !== 201) throw new Error(`a page of the shop: ${made.status} ${JSON.stringify(made.body)}`);
    const customId = Number(made.body.data.id);
    customIds.push(customId);
    const renamed = await erp.put(`/api/storefront/pages/${customId}`, {
      title: `صفحهٔ فروشگاه ${tag}`, slug: 'fixed-cart-two', seoTitle: '', seoDescription: '', noindex: false, shareImageAssetId: null, sections: [], version: 1,
    });
    const movedTo = await erp.post(`/api/storefront/pages/${customId}/move`, { slug: `fixed-moved-${tag}`, version: 1 });
    if ([madeFixed, renamed, movedTo].some(res => res.status !== 400 && res.status !== 422)) wrong.push(`a name under fixed- for a page of the shop: ${madeFixed.status}/${renamed.status}/${movedTo.status}`);

    // 5) published: the words go to the site by name, with nothing of the row, and are in no list of pages
    const published = await erp.post(`/api/storefront/pages/${cart.id}/publish`, { version });
    version = Number(published.body.data?.version);
    const [byName, pages, asPagePath] = [await site('/pages/fixed-cart'), await site('/pages'), await site('/redirects')];
    const words = (byName.body.data ?? {}) as Body & { sections?: Array<{ kind: string }> };
    if (published.status !== 200 || byName.status !== 200 || keys(words) !== 'kind,noindex,sections,seoDescription,seoTitle,shareImage,slug,title,updatedAt'
      || words.kind !== 'fixed' || words.title !== `سبد شما ${tag}` || words.seoTitle !== 'سبد خرید گالری' || words.noindex !== true || words.shareImage !== null
      || (words.sections ?? []).map(s => s.kind).join(',') !== 'text') {
      wrong.push(`the published words: ${published.status}/${byName.status} ${JSON.stringify(words).slice(0, 300)}`);
    }
    // (`noindex` is always true for a fixed row: a site not yet updated would draw it as a page, and must not have it listed)
    for (const leak of ['"id"', 'version', 'updatedBy', 'createdBy', 'previewHash']) if (JSON.stringify(byName.body).includes(leak)) wrong.push(`the published words carry «${leak}»`);
    if (pages.status !== 200 || (pages.body.data as Array<{ slug: string; kind: string }>).some(page => page.kind === 'fixed' || page.slug.startsWith('fixed-'))) {
      wrong.push(`the list of pages names a fixed row: ${JSON.stringify(pages.body.data).slice(0, 200)}`);
    }
    if (asPagePath.status === 200 && JSON.stringify(asPagePath.body).includes('fixed-cart')) wrong.push('the redirect list names a fixed row');
    // a menu cannot link to it as «صفحهٔ متنی»
    const options = await erp.get('/api/storefront/menus/link-options');
    if (JSON.stringify(options.body.data?.pages ?? []).includes(`سبد شما ${tag}`)) wrong.push('a fixed row is offered as a page to link to in a menu');
    // a title alone is enough to publish: the text is taken off and the row published again
    const noText = await erp.put(`/api/storefront/pages/${cart.id}`, form(version, { sections: [] }));
    const again = await erp.post(`/api/storefront/pages/${cart.id}/publish`, { version: Number(noText.body.data?.version) });
    version = Number(again.body.data?.version);
    const titleOnly = await site('/pages/fixed-cart');
    if (noText.status !== 200 || again.status !== 200 || (titleOnly.body.data?.sections ?? [null]).length !== 0) wrong.push(`publishing a title alone: ${noText.status}/${again.status} ${JSON.stringify(titleOnly.body.data?.sections)}`);
    const [audit] = await orm.select().from(activityLogs).where(eq(activityLogs.entityId, `page-${cart.id}`)).orderBy(desc(activityLogs.id)).limit(1);
    if (!String(audit?.description).includes('منتشر')) wrong.push(`the audit row of publishing: ${String(audit?.description)}`);

    // 6) taken off the site: the name is a 404 again (the site then shows its own words)
    const off = await erp.post(`/api/storefront/pages/${cart.id}/unpublish`, { version });
    const gone = await site('/pages/fixed-cart');
    if (off.status !== 200 || gone.status !== 404) wrong.push(`taking the words off the site: ${off.status}/${gone.status}`);

    // 7) the constraints of migration 0032, against a direct write
    const direct = async (values: Partial<typeof storefrontPages.$inferInsert>, where = cart.id) => orm.update(storefrontPages).set(values).where(eq(storefrontPages.id, where)).then(() => 'written', () => 'refused');
    const checks: Array<[string, string, string]> = [
      ['a kind that is none of the three', await direct({ kind: 'other' }), 'refused'],
      ['a removed fixed row', await direct({ isDeleted: 1 }), 'refused'],
      ['a removed page of the shop', await direct({ isDeleted: 1 }, customId), 'written'],
    ];
    for (const [what, got, want] of checks) if (got !== want) wrong.push(`constraint, ${what}: ${got}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the fixed rows of migrations 0032 and 0034 were there after the base pages, unpublished and 404 on the site; a row refused another name, a second text, a part that is no text, the search switch, a share image and a text past 2000 letters, and saved its title, one text and the search words; it was not removed, moved or previewed; a new page, a saved draft and a move could not take a name under fixed-; published, its words went to the site by name with kind fixed and no field of the row, were in no list of pages and not offered to a menu; a title alone could be published; taken off, the name was a 404 again; the constraints refused another kind and a removed fixed row',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    for (const row of fixedBefore) await orm.update(storefrontPages).set(row).where(eq(storefrontPages.id, row.id)).catch(() => undefined);
    await orm.delete(storefrontContentAssets).where(and(eq(storefrontContentAssets.contentKind, 'page'), inArray(storefrontContentAssets.contentId, fixedBefore.map(row => row.id)))).catch(() => undefined);
    if (customIds.length > 0) await orm.delete(storefrontPages).where(inArray(storefrontPages.id, customIds)).catch(() => undefined);
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
