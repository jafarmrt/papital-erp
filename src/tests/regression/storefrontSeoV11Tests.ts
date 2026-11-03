import request from 'supertest';
import { eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, appSettings, itemPrices, items, storefrontProducts, storefrontRedirects } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v11 phase 8.5 (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md): the search and statistics settings and the old-address
 * redirects, on real Express routes and PostgreSQL. The settings save under their own version (a stale form is 409, a
 * wrong GA4 id 422) and the site reads exactly the reviewed fields; a redirect is saved by its old address's key (a
 * pasted, encoded link and its decoded form are one address: 409), never to another site, and reaches the site only while
 * it is on and its product is published, by the product's current address; an edit, a switch and a soft delete each
 * write their audit row; a holder of `storefront.view` reads but cannot write.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

export async function runStorefrontSeoV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_seo_v11_8_5';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'seo', 'redirects', 'occ')) return results;

  const name = 'v11 phase 8.5: search and statistics settings under their own version with the reviewed public fields, and old-address redirects saved by their key, only to this site, served while on and published, audited, and view-only holders refused';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const redirectIds: number[] = [];
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      del: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
    });
    const erp = as(admin);
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const keys = (value: Body) => Object.keys(value).sort().join(',');

    // the site on, with a key and a retail list, so the public routes answer
    const retailList = `تکی سئو ${tag}`;
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
    const made = await erp.post('/api/storefront/api-key');
    const apiKey = String(made.body.data?.apiKey ?? '');
    const site = (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`);

    // 1) search and statistics settings: off by default, a wrong id 422, a save in upper case, a stale save 409
    const seo = await erp.get('/api/storefront/seo');
    if (seo.status !== 200 || seo.body.data.analyticsProvider !== 'none') wrong.push(`seo defaults: ${seo.status} ${JSON.stringify(seo.body.data)}`);
    const pubOff = await site('/api/storefront/v1/seo');
    if (pubOff.status !== 200 || pubOff.body.data.analytics.provider !== 'none' || pubOff.body.data.analytics.id !== '') wrong.push(`public seo while off: ${JSON.stringify(pubOff.body)}`);
    const seoVersion = Number(seo.body.data.version);
    const seoForm = {
      googleVerification: 'abc_DEF-123', bingVerification: '', analyticsProvider: 'ga4', analyticsId: 'g-test123', analyticsUrl: 'https://ignored.example',
      alternateSiteUrl: 'https://papital.gallery/', version: seoVersion,
    };
    const badId = await erp.put('/api/storefront/seo', { ...seoForm, analyticsId: 'UA-123-1' });
    if (badId.status !== 422 || badId.body.code !== 'STOREFRONT_SEO_INVALID') wrong.push(`a wrong GA4 id: ${badId.status} ${badId.body.code}`);
    const seoSaved = await erp.put('/api/storefront/seo', seoForm);
    if (seoSaved.status !== 200 || seoSaved.body.data.analyticsId !== 'G-TEST123' || seoSaved.body.data.analyticsUrl !== ''
      || seoSaved.body.data.alternateSiteUrl !== 'https://papital.gallery' || seoSaved.body.data.version !== seoVersion + 1) {
      wrong.push(`seo save: ${seoSaved.status} ${JSON.stringify(seoSaved.body.data)}`);
    }
    const seoStale = await erp.put('/api/storefront/seo', seoForm);
    if (seoStale.status !== 409) wrong.push(`a stale seo save: ${seoStale.status}, not 409`);
    const pub = await site('/api/storefront/v1/seo');
    // the security review's contract: exactly these fields reach the site
    if (pub.status !== 200 || keys(pub.body.data) !== 'alternateSiteUrl,analytics,verification'
      || keys(pub.body.data.analytics) !== 'id,provider,url' || keys(pub.body.data.verification) !== 'bing,google') {
      wrong.push(`public seo fields: ${pub.status} ${JSON.stringify(pub.body.data)}`);
    } else if (pub.body.data.analytics.id !== 'G-TEST123' || pub.body.data.verification.google !== 'abc_DEF-123') {
      wrong.push(`public seo values: ${JSON.stringify(pub.body.data)}`);
    }

    // 2) a redirect to a product: saved by its key, waits while the product is not published
    const item = await createTestItem({ name: `گوشواره انتقال ${tag}`, code: `SF-R-${tag}` });
    itemIds.push(item.id);
    await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money('5000000'), currency: 'IRR' });
    const persian = `گوشواره-کاشی-${tag}`;
    const pasted = `https://papitalgallery.com/product/${encodeURIComponent(persian)}/?utm_source=ig`;
    const created = await erp.post('/api/storefront/redirects', { fromPath: pasted, targetKind: 'product', targetItemId: item.id, target: '', note: '', isActive: true });
    if (created.status !== 201 || created.body.data.fromPath !== `/product/${persian}` || created.body.data.source !== 'manual') {
      throw new Error(`create redirect: ${created.status} ${JSON.stringify(created.body)}`);
    }
    const redirectId = Number(created.body.data.id);
    redirectIds.push(redirectId);
    const twin = await erp.post('/api/storefront/redirects', { fromPath: `/product/${persian}`, targetKind: 'path', targetItemId: null, target: '/products', note: '', isActive: true });
    if (twin.status !== 409 || twin.body.code !== 'STOREFRONT_REDIRECT_FROM_TAKEN') wrong.push(`the same address decoded: ${twin.status} ${twin.body.code}`);
    const offsite = await erp.post('/api/storefront/redirects', { fromPath: `/old-${tag}`, targetKind: 'path', targetItemId: null, target: '//evil.example', note: '', isActive: true });
    if (offsite.status !== 422 || offsite.body.code !== 'STOREFRONT_REDIRECT_TARGET_INVALID') wrong.push(`a redirect to another site: ${offsite.status} ${offsite.body.code}`);
    const itself = await erp.post('/api/storefront/redirects', { fromPath: `/old-${tag}/`, targetKind: 'path', targetItemId: null, target: `/old-${tag}`, note: '', isActive: true });
    if (itself.status !== 422 || itself.body.code !== 'STOREFRONT_REDIRECT_TARGET_INVALID') wrong.push(`a redirect to itself: ${itself.status} ${itself.body.code}`);
    const home = await erp.post('/api/storefront/redirects', { fromPath: 'https://papitalgallery.com/', targetKind: 'path', targetItemId: null, target: '/products', note: '', isActive: true });
    if (home.status !== 422 || home.body.code !== 'STOREFRONT_REDIRECT_FROM_INVALID') wrong.push(`the home page as an old address: ${home.status} ${home.body.code}`);
    const fromOf = (list: Body[]) => list.find(r => r.from === `/product/${persian}`);
    const waiting = await site('/api/storefront/v1/redirects');
    if (waiting.status !== 200 || fromOf(waiting.body.data ?? [])) wrong.push(`a redirect to an unpublished product reached the site: ${waiting.status}`);

    // 3) published: the site gets it by the product's slug, with exactly the reviewed fields
    const slug = `earring-r-${tag}`;
    const publish = await erp.put(`/api/storefront/products/${item.id}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
    if (publish.status !== 200) throw new Error(`publish: ${publish.status} ${JSON.stringify(publish.body)}`);
    const live = await site('/api/storefront/v1/redirects');
    const row = fromOf(live.body.data ?? []);
    if (!row || row.kind !== 'product' || row.target !== slug || keys(row) !== 'from,kind,target') wrong.push(`the published product's redirect: ${JSON.stringify(row)}`);

    // 4) the list finds it by a pasted link; a switch off hides it, a stale switch is 409; an edit; a soft delete
    const found = await erp.get(`/api/storefront/redirects?q=${encodeURIComponent(pasted)}`);
    if (found.status !== 200 || found.body.total !== 1 || found.body.data[0].targetSlug !== slug || found.body.data[0].targetCode !== item.code) {
      wrong.push(`the list by a pasted link: ${found.status} ${JSON.stringify(found.body)}`);
    }
    const off = await erp.put(`/api/storefront/redirects/${redirectId}/active`, { active: false, version: 1 });
    if (off.status !== 200 || off.body.data.isActive !== false || off.body.data.version !== 2) wrong.push(`switch off: ${off.status} ${JSON.stringify(off.body)}`);
    const staleSwitch = await erp.put(`/api/storefront/redirects/${redirectId}/active`, { active: true, version: 1 });
    if (staleSwitch.status !== 409) wrong.push(`a stale switch: ${staleSwitch.status}, not 409`);
    const hidden = await site('/api/storefront/v1/redirects');
    if (fromOf(hidden.body.data ?? [])) wrong.push('a switched-off redirect reached the site');
    const edited = await erp.put(`/api/storefront/redirects/${redirectId}`, {
      fromPath: `/product/${persian}`, targetKind: 'collection', targetItemId: null, target: `یلدا ${tag}`, note: 'کالکشن یلدا', isActive: true, version: 2,
    });
    if (edited.status !== 200 || edited.body.data.targetKind !== 'collection' || edited.body.data.version !== 3) wrong.push(`edit: ${edited.status} ${JSON.stringify(edited.body)}`);
    const collectionRow = fromOf((await site('/api/storefront/v1/redirects')).body.data ?? []);
    if (!collectionRow || collectionRow.kind !== 'collection' || collectionRow.target !== `یلدا ${tag}`) wrong.push(`the collection redirect: ${JSON.stringify(collectionRow)}`);
    const removed = await erp.del(`/api/storefront/redirects/${redirectId}?version=3`);
    if (removed.status !== 200) wrong.push(`delete: ${removed.status}`);
    const [kept] = await orm.select({ isDeleted: storefrontRedirects.isDeleted }).from(storefrontRedirects).where(eq(storefrontRedirects.id, redirectId));
    if (kept?.isDeleted !== 1) wrong.push('the deleted redirect was not kept as a soft delete');
    const again = await erp.post('/api/storefront/redirects', { fromPath: `/product/${persian}`, targetKind: 'path', targetItemId: null, target: '/products', note: '', isActive: true });
    if (again.status !== 201) wrong.push(`the address free again after a delete: ${again.status}`);
    else redirectIds.push(Number(again.body.data.id));
    const audits = await orm.select({ id: activityLogs.id }).from(activityLogs).where(eq(activityLogs.entityId, `redirect-${redirectId}`));
    if (audits.length !== 4) wrong.push(`audit rows of the redirect: ${audits.length}, not 4 (create, switch, edit, delete)`);

    // 5) a holder of storefront.view reads but cannot write
    const role = await createTestRole({ permissions: ['storefront.view'] });
    const user = await createTestUser({ role: role.code });
    const viewer = as(await loginTestUserWithSession(app, user.username));
    const viewerList = await viewer.get('/api/storefront/redirects');
    const viewerSeo = await viewer.put('/api/storefront/seo', { ...seoForm, version: seoVersion + 1 });
    const viewerImport = await viewer.post('/api/storefront/redirects/import');
    const viewerCreate = await viewer.post('/api/storefront/redirects', { fromPath: `/v-${tag}`, targetKind: 'path', targetItemId: null, target: '/', note: '', isActive: true });
    if (viewerList.status !== 200 || viewerSeo.status !== 403 || viewerImport.status !== 403 || viewerCreate.status !== 403) {
      wrong.push(`view only: list ${viewerList.status}, seo ${viewerSeo.status}, import ${viewerImport.status}, create ${viewerCreate.status}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'search and statistics settings started off, refused a wrong GA4 id (422) and a stale version (409), saved the id in upper case and reached the site with exactly the reviewed fields; a redirect from a pasted encoded link was kept by its decoded key, the same address decoded was 409, another site and the home page 422; it reached the site only once its product was published, by the slug, not while switched off; an edit to a collection, a soft delete that freed the address, four audit rows; a view-only holder could not write',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (redirectIds.length > 0) await orm.update(storefrontRedirects).set({ isDeleted: 1 }).where(inArray(storefrontRedirects.id, redirectIds)).catch(() => undefined);
    if (itemIds.length > 0) {
      await orm.delete(storefrontRedirects).where(inArray(storefrontRedirects.targetItemId, itemIds)).catch(() => undefined);
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
