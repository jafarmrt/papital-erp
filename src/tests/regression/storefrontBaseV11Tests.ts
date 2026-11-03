import request from 'supertest';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { appSettings, itemPrices, items, storefrontProducts, storefrontShippingMethods, warehouses } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v11 phase 8.1 (docs/roadmap/V11_STOREFRONT_START_PLAN.md): the ERP base of the new site, on real Express routes and
 * PostgreSQL. The Storefront API is 404 until the site is turned on (default off). The settings save under their version (a stale form is 409) and refuse a wrong card; the Storefront API
 * answers only with the site app's key (none or a wrong one is 401); an item without a retail price cannot be published
 * and one address has one owner; the catalog answers only published items with a retail price, with the stock of the
 * chosen warehouse, the configured «تعداد کم» threshold and the count only when the settings show it; a shipping method
 * saves its weight and province rows under its version; a holder of `storefront.view` cannot write.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';

export async function runStorefrontBaseV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_base_v11_8_1';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'settings', 'shipping', 'catalog', 'occ')) return results;

  const name = 'v11 phase 8.1: storefront settings under their version, the key-guarded Storefront API, publishing only with a retail price, unique addresses, the stock of the chosen warehouse with the configured threshold and display, shipping rows under their version, and view-only holders refused';
  const tStart = Date.now();
  const itemIds: number[] = [];
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

    // two price lists for the site: retail and wholesale
    const retailList = `تکی سایت ${tag}`;
    const wholesaleList = `عمده سایت ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList, wholesaleList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList, wholesaleList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);

    // 1) settings: read, a wrong card refused, a save, a stale save 409
    const read = await erp.get('/api/storefront/settings');
    if (read.status !== 200) throw new Error(`GET settings: ${read.status} ${JSON.stringify(read.body)}`);
    const version = Number(read.body.data.version);
    const settings = {
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '۵٬۰۰۰٬۰۰۰',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: wholesaleList, lowStockThreshold: 2, stockDisplay: 'count',
      warehouseCode: warehouse.code, whatsappNumber: '', whatsappEnabled: false, enabled: false, version,
    };
    const badCard = await erp.put('/api/storefront/settings', { ...settings, cardNumber: '6037991234567894' });
    if (badCard.status !== 422 || badCard.body.code !== 'STOREFRONT_CARD_INVALID') wrong.push(`a wrong card: ${badCard.status} ${badCard.body.code}`);
    const saved = await erp.put('/api/storefront/settings', settings);
    if (saved.status !== 200 || saved.body.data.version !== version + 1 || saved.body.data.freeShippingThreshold !== '5000000') {
      wrong.push(`save: ${saved.status} version ${saved.body.data?.version} threshold ${saved.body.data?.freeShippingThreshold}`);
    }
    const stale = await erp.put('/api/storefront/settings', { ...settings, bankName: 'تجارت' });
    if (stale.status !== 409) wrong.push(`a stale settings save: ${stale.status}, not 409`);

    // 2) the key: none and a wrong one are 401; a new one opens the API
    const noKey = await request(app).get('/api/storefront/v1/settings');
    if (noKey.status !== 404) wrong.push(`no key while off: ${noKey.status}, not 404`);
    const made = await erp.post('/api/storefront/api-key');
    const apiKey = String(made.body.data?.apiKey ?? '');
    if (made.status !== 201 || !apiKey.startsWith('sf_')) throw new Error(`POST api-key: ${made.status}`);
    const site = (url: string, key = apiKey) => request(app).get(url).set('Authorization', `Bearer ${key}`);
    // off by default: even the right key gets 404 until the owner turns the site on
    const whileOff = await site('/api/storefront/v1/settings');
    if (whileOff.status !== 404) wrong.push(`the API while off: ${whileOff.status}, not 404`);
    const turnedOn = await erp.put('/api/storefront/settings', { ...settings, enabled: true, version: version + 1 });
    if (turnedOn.status !== 200 || turnedOn.body.data.enabled !== true) wrong.push(`turning the site on: ${turnedOn.status}`);
    const noKeyOn = await request(app).get('/api/storefront/v1/settings');
    if (noKeyOn.status !== 401) wrong.push(`no key: ${noKeyOn.status}, not 401`);
    const wrongKey = await site('/api/storefront/v1/settings', `${apiKey}x`);
    if (wrongKey.status !== 401) wrong.push(`a wrong key: ${wrongKey.status}, not 401`);
    const view = await erp.get('/api/storefront/settings');
    if (JSON.stringify(view.body).includes(apiKey)) wrong.push('the settings answer showed the key again');
    const pub = await site('/api/storefront/v1/settings');
    if (pub.status !== 200 || pub.body.data.payment.cardNumber !== VALID_CARD || pub.body.data.stockDisplay !== 'count') {
      wrong.push(`site settings: ${pub.status} ${JSON.stringify(pub.body.data?.payment)}`);
    }

    // 3) publishing: a retail price is needed, one address has one owner, a stale save is 409
    const priced = await createTestItem({ name: `گوشواره سایت ${tag}`, code: `SF-A-${tag}`, collections: [`یلدا ${tag}`] });
    itemIds.push(priced.id);
    const unpriced = await createTestItem({ name: `دستبند بی‌قیمت ${tag}`, code: `SF-B-${tag}` });
    itemIds.push(unpriced.id);
    await orm.insert(itemPrices).values([
      { itemId: priced.id, title: retailList, price: money('12500000'), currency: 'IRR' },
      { itemId: priced.id, title: wholesaleList, price: money('9000000'), currency: 'IRR' },
      { itemId: unpriced.id, title: wholesaleList, price: money('7000000'), currency: 'IRR' },
    ]);
    const slug = `earring-${tag}`;
    const publish = await erp.put(`/api/storefront/products/${priced.id}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
    if (publish.status !== 200 || publish.body.data.published !== true || publish.body.data.version !== 1) wrong.push(`publish: ${publish.status} ${JSON.stringify(publish.body)}`);
    const again = await erp.put(`/api/storefront/products/${priced.id}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
    if (again.status !== 409) wrong.push(`a stale publish: ${again.status}, not 409`);
    const blocked = await erp.put(`/api/storefront/products/${unpriced.id}`, { published: true, slug: `bracelet-${tag}`, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
    if (blocked.status !== 422 || blocked.body.code !== 'STOREFRONT_PUBLISH_BLOCKED') wrong.push(`publishing without a retail price: ${blocked.status} ${blocked.body.code}`);
    const taken = await erp.put(`/api/storefront/products/${unpriced.id}`, { published: false, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
    if (taken.status !== 409 || taken.body.code !== 'STOREFRONT_SLUG_TAKEN') wrong.push(`a taken address: ${taken.status} ${taken.body.code}`);
    const list = await erp.get(`/api/storefront/products?q=${encodeURIComponent(`SF-B-${tag}`)}`);
    const row = (list.body.data ?? [])[0];
    if (list.status !== 200 || row?.blocker !== 'no_retail_price' || row?.slug !== `sf-b-${tag}`) wrong.push(`admin list: ${list.status} ${JSON.stringify(row)}`);

    // 4) the catalog: only the published, priced item, with the stock of the chosen warehouse (100 seeded, threshold 2)
    const catalog = await site(`/api/storefront/v1/products?q=${encodeURIComponent(tag)}`);
    const cards = catalog.body.data ?? [];
    if (catalog.status !== 200 || cards.length !== 1 || cards[0].slug !== slug) wrong.push(`catalog: ${catalog.status} ${JSON.stringify(cards.map((c: Body) => c.slug))}`);
    else {
      const card = cards[0];
      if (card.retailPrice !== '12500000') wrong.push(`catalog price: ${card.retailPrice}`);
      if (card.stock.status !== 'in_stock' || card.stock.quantity !== 100) wrong.push(`catalog stock: ${JSON.stringify(card.stock)}`);
      // the security review's contract: exactly these fields leave the ERP, so a new one (a cost, a wholesale price, a
      // warehouse) fails here until it is reviewed
      const keys = (value: Body) => Object.keys(value).sort().join(',');
      if (keys(card) !== 'category,collections,cover,name,retailPrice,sku,slug,stock') wrong.push(`catalog card fields: ${keys(card)}`);
      if (keys(card.stock) !== 'quantity,status') wrong.push(`stock fields: ${keys(card.stock)}`);
    }
    await erp.put('/api/storefront/settings', { ...settings, enabled: true, lowStockThreshold: 100, stockDisplay: 'status', version: version + 2 });
    const detail = await site(`/api/storefront/v1/products/${slug}`);
    if (detail.status !== 200 || detail.body.data.stock.status !== 'low' || detail.body.data.stock.quantity !== null) {
      wrong.push(`detail after threshold 100 and status display: ${detail.status} ${JSON.stringify(detail.body.data?.stock)}`);
    }
    const detailKeys = Object.keys(detail.body.data ?? {}).sort().join(',');
    const expectedDetail = 'category,collections,color,cover,description,designYear,images,material,name,retailPrice,seoDescription,seoTitle,size,sku,slug,stock,weightGrams';
    if (detailKeys !== expectedDetail) wrong.push(`detail fields: ${detailKeys}`);
    const publicKeys = Object.keys(pub.body.data ?? {}).sort().join(',');
    if (publicKeys !== 'currency,freeShippingThreshold,payment,reservationHours,shippingMethods,stockDisplay,whatsapp') wrong.push(`site settings fields: ${publicKeys}`);
    if (pub.body.data?.whatsapp !== '') wrong.push(`the WhatsApp number while its button is off: ${pub.body.data?.whatsapp}`);
    // the WhatsApp button (8.3): on needs a number; a local mobile is kept in the wa.me form; off hides the number
    const waNoNumber = await erp.put('/api/storefront/settings', { ...settings, enabled: true, whatsappEnabled: true, version: version + 3 });
    if (waNoNumber.status !== 422 || waNoNumber.body.code !== 'STOREFRONT_WHATSAPP_REQUIRED') wrong.push(`WhatsApp on without a number: ${waNoNumber.status} ${waNoNumber.body.code}`);
    const waBad = await erp.put('/api/storefront/settings', { ...settings, enabled: true, whatsappNumber: '02112345678', version: version + 3 });
    if (waBad.status !== 422 || waBad.body.code !== 'STOREFRONT_WHATSAPP_INVALID') wrong.push(`a landline as WhatsApp: ${waBad.status} ${waBad.body.code}`);
    const waOn = await erp.put('/api/storefront/settings', { ...settings, enabled: true, whatsappNumber: '۰۹۱۲۰۰۰۰۰۰۰', whatsappEnabled: true, version: version + 3 });
    const waPub = await site('/api/storefront/v1/settings');
    if (waOn.status !== 200 || waPub.body.data?.whatsapp !== '989120000000') wrong.push(`WhatsApp on: ${waOn.status} ${waPub.body.data?.whatsapp}`);
    await erp.put('/api/storefront/settings', { ...settings, enabled: true, whatsappNumber: '09120000000', whatsappEnabled: false, version: version + 4 });
    const waOff = await site('/api/storefront/v1/settings');
    if (waOff.body.data?.whatsapp !== '') wrong.push(`WhatsApp off still shows the number: ${waOff.body.data?.whatsapp}`);
    // the logo and browser icon (8.3): a safe image saved with its own version, an unsafe SVG refused, the site reads both
    const brandView = (await erp.get('/api/storefront/settings')).body.data.brand;
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const evilSvg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')}`;
    const badLogo = await erp.put('/api/storefront/brand/logo', { image: evilSvg, version: brandView.version });
    if (badLogo.status !== 422 || badLogo.body.code !== 'STOREFRONT_BRAND_IMAGE_INVALID') wrong.push(`an SVG with a script: ${badLogo.status} ${badLogo.body.code}`);
    const logoSaved = await erp.put('/api/storefront/brand/logo', { image: tinyPng, version: brandView.version });
    if (logoSaved.status !== 200 || logoSaved.body.data.logo !== tinyPng) wrong.push(`saving the logo: ${logoSaved.status}`);
    const staleLogo = await erp.put('/api/storefront/brand/favicon', { image: tinyPng, version: brandView.version });
    if (staleLogo.status !== 409) wrong.push(`a stale brand save: ${staleLogo.status}, not 409`);
    const brandPub = await site('/api/storefront/v1/brand');
    if (brandPub.status !== 200 || brandPub.body.data.logo !== tinyPng || Object.keys(brandPub.body.data).sort().join(',') !== 'favicon,logo') {
      wrong.push(`site brand: ${brandPub.status} ${Object.keys(brandPub.body.data ?? {}).join(',')}`);
    }
    await erp.put('/api/storefront/brand/logo', { image: '', version: brandView.version + 1 });
    const missing = await site('/api/storefront/v1/products/no-such-item');
    if (missing.status !== 404) wrong.push(`an unknown address: ${missing.status}, not 404`);
    const facets = await site('/api/storefront/v1/facets');
    if (!(facets.body.data?.collections ?? []).some((f: Body) => f.name === `یلدا ${tag}` && f.count === 1)) wrong.push('facets left out the collection');
    const badMedia = await site(`/api/storefront/v1/media/${'a'.repeat(64)}.webp`);
    if (badMedia.status !== 404) wrong.push(`an unknown image: ${badMedia.status}, not 404`);

    // 5) shipping: a table method with its rows, a wrong province refused, a stale save 409, a delete
    const method = {
      code: `post-${tag}`, title: 'پست پیشتاز', description: '', pricing: 'table', flatRate: '', isActive: true, isFreeShippingEligible: true,
      sortOrder: 1, rates: [{ province: 'تهران', maxWeightGrams: 1000, rate: '۴۰۰٬۰۰۰' }, { province: '', maxWeightGrams: null, rate: '900000' }],
    };
    const created = await erp.post('/api/storefront/shipping-methods', method);
    if (created.status !== 201 || created.body.data.rates.length !== 2 || created.body.data.rates[0].rate !== '400000') {
      throw new Error(`create shipping: ${created.status} ${JSON.stringify(created.body)}`);
    }
    const methodId = Number(created.body.data.id);
    const badProvince = await erp.put(`/api/storefront/shipping-methods/${methodId}`, { ...method, version: 1, rates: [{ province: 'Tehran', maxWeightGrams: null, rate: '1' }] });
    if (badProvince.status !== 422) wrong.push(`a wrong province: ${badProvince.status}, not 422`);
    const updated = await erp.put(`/api/storefront/shipping-methods/${methodId}`, { ...method, version: 1, rates: [{ province: '', maxWeightGrams: null, rate: '650000' }] });
    if (updated.status !== 200 || updated.body.data.version !== 2 || updated.body.data.rates.length !== 1) wrong.push(`update shipping: ${updated.status}`);
    const staleMethod = await erp.put(`/api/storefront/shipping-methods/${methodId}`, { ...method, version: 1 });
    if (staleMethod.status !== 409) wrong.push(`a stale shipping save: ${staleMethod.status}, not 409`);
    const offered = await site('/api/storefront/v1/settings');
    if (!(offered.body.data?.shippingMethods ?? []).some((m: { code: string; rates: unknown[] }) => m.code === method.code && m.rates.length === 1)) wrong.push('the site settings left out the active method');
    const removed = await erp.del(`/api/storefront/shipping-methods/${methodId}?version=2`);
    if (removed.status !== 200) wrong.push(`delete shipping: ${removed.status}`);

    // 6) a holder of storefront.view reads but cannot write
    const role = await createTestRole({ permissions: ['storefront.view'] });
    const user = await createTestUser({ role: role.code });
    const viewer = as(await loginTestUserWithSession(app, user.username));
    const viewerRead = await viewer.get('/api/storefront/settings');
    const viewerWrite = await viewer.post('/api/storefront/api-key');
    if (viewerRead.status !== 200 || viewerWrite.status !== 403) wrong.push(`view only: read ${viewerRead.status}, key ${viewerWrite.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'settings saved under their version (wrong card 422, stale 409); the API answered 401 without or with a wrong key and 200 with the new one; publishing without a retail price was 422 and a taken address 409; the catalog answered only the priced item with its two prices and 100 units, then «تعداد کم» without the count after the threshold and display changed; a table method saved two rows, refused a wrong province and a stale version, and was deleted; a view-only holder could not make a key',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) {
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
    await orm.update(storefrontShippingMethods).set({ isDeleted: 1 })
      .where(and(like(storefrontShippingMethods.code, 'post-%'), eq(storefrontShippingMethods.isDeleted, 0), eq(storefrontShippingMethods.title, 'پست پیشتاز')))
      .catch(() => undefined);
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
