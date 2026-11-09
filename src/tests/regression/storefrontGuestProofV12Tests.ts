import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, appSettings, bankAccounts, customers, itemPrices, items, storefrontBuyerAccounts, storefrontBuyerSessions, storefrontOrders,
  storefrontProducts, storefrontShippingMethods, storefrontSmsCodes, storefrontSmsMessages, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';

/**
 * v12 phase 7 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §4, site review 1.3 and 2.10): fake orders that hold stock.
 * On real Express routes and PostgreSQL, against a fake SMS service on this machine:
 *
 * - A retail buyer orders at most five of an item, at the quote and at the order (red before: 99 were taken).
 * - With the texts off a guest orders as before, without a proof.
 * - With the texts on a guest's order without a proof, or with another phone's, is 422 and leaves no order, no customer
 *   and no reservation behind (red before: any phone number ordered and made a customer).
 * - A proof used by an order that was then refused (an item short) is still good: the order's transaction rolled it back.
 * - A placed order's proof is used up: a new order with it is 422, while a repeat of the same request replays the order.
 * - A signed-in account orders without a proof.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const SMS_KEY = 'TestSmsKey0123456789abcdefXYZ';
const PASSWORD = 'رمز-آزمون-1405';
const PRICE = '9000000';

async function fakeSmsServer() {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      bodies.push(body);
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 1, message: 'موفق', data: { messageId: bodies.length } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { bodies, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

export async function runStorefrontGuestProofV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_guest_proof_v12_p7d';
  if (!shouldRun(id, 'v12', 'phase7', 'storefront', 'orders', 'sms', 'reservation', 'security')) return results;

  const name = 'v12 phase 7d and 7e: the retail cap of five at the quote and the order; with the texts on a guest order needs its own phone proof, a refused order leaves no customer or reservation and keeps the proof, a used proof is refused but a replay answers the order, a signed-in account needs none; with the texts off nothing changes; a per-visitor limit on catalog reads';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const phoneKeys: string[] = [];
  let bankId: number | null = null;
  let methodId: number | null = null;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const savedBase = process.env.ERP_SMS_TEST_API_BASE;
  const sms = await fakeSmsServer();
  try {
    process.env.ERP_SMS_TEST_API_BASE = sms.base;
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
    const [phoneOff, phoneGuest, phoneOther, phoneMember] = ['0915', '0916', '0917', '0918'].map(p => `${p}${tag}`);
    phoneKeys.push(...[phoneOff, phoneGuest, phoneOther, phoneMember].map(p => phoneMatchKey(p)));

    // the shop: a retail list, one item of two units and one of ten, a flat shipping method, the site on and ordering
    const retailList = `تکی اثبات مهمان ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const two = await createTestItem({ name: `انگشتر اثبات ${tag}`, code: `SFP-A-${tag}`, stocks: { '': 2 } });
    const ten = await createTestItem({ name: `دستبند اثبات ${tag}`, code: `SFP-B-${tag}`, stocks: { '': 10 } });
    itemIds.push(two.id, ten.id);
    await orm.insert(itemPrices).values([
      { itemId: two.id, title: retailList, price: money(PRICE), currency: 'IRR' },
      { itemId: ten.id, title: retailList, price: money(PRICE), currency: 'IRR' },
    ]);
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFP-${tag}`, title: 'ERP-TEST-MARKER حساب اثبات مهمان سایت', type: 'bank', currency: 'IRR',
      accountId: ledger?.id ?? null, initialBalance: money(0), currentBalance: money(0),
    }).returning({ id: bankAccounts.id });
    bankId = bank.id;
    const read = await erp.get('/api/storefront/settings');
    const saved = await erp.put('/api/storefront/settings', {
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: '', lowStockThreshold: 0, stockDisplay: 'count',
      warehouseCode: warehouse.code, whatsappNumber: '', whatsappEnabled: false, enabled: true, ordersEnabled: true, treasuryAccountId: bank.id,
      openOrdersPerPhone: 3, version: Number(read.body.data.version),
    });
    if (saved.status !== 200) throw new Error(`save settings: ${saved.status} ${JSON.stringify(saved.body)}`);
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    const method = await erp.post('/api/storefront/shipping-methods', {
      code: `sfp-${tag}`, title: 'پست آزمون اثبات', description: '', pricing: 'flat', flatRate: '500000', isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slugTwo = `proof-ring-${tag}`;
    const slugTen = `proof-band-${tag}`;
    for (const [itemId, slug] of [[two.id, slugTwo], [ten.id, slugTen]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    let ipCount = 10;
    const site = (session = '') => {
      const ip = `10.31.0.${ipCount++}`;
      return {
        get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session),
        post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session).send(body),
      };
    };
    const stockOf = async (slug: string) => (await site().get(`/api/storefront/v1/products/${slug}`)).body.data?.stock?.quantity;
    const order = (phone: string, requestKey: string, lines: Array<{ slug: string; quantity: number }>, extra: Body = {}): Body => ({
      requestKey, recipientName: `خریدار اثبات ${tag}`, phone, province: 'تهران', city: 'تهران', address: 'خیابان آزمون، پلاک ۲',
      postalCode: '1234567890', note: '', shippingMethod: `sfp-${tag}`, lines, ...extra,
    });
    const ordersOf = async (phone: string) => orm.select({ id: storefrontOrders.id, number: storefrontOrders.orderNumber })
      .from(storefrontOrders).where(eq(storefrontOrders.phoneKey, phoneMatchKey(phone)));
    const customersOf = async (phone: string) => (await orm.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.phone, phone), eq(customers.isDeleted, 0)))).length;

    let smsVersion = Number((await erp.get('/api/storefront/sms/settings')).body.data?.version ?? 0);
    const smsSwitch = async (enabled: boolean) => {
      const res = await erp.put('/api/storefront/sms/settings', {
        enabled, provider: 'smsir', apiKey: smsVersion === 0 ? SMS_KEY : '', clearApiKey: false, templates: { otp: '111' }, hourlyCap: 200, version: smsVersion,
      });
      if (res.status !== 200) throw new Error(`sms settings: ${res.status} ${JSON.stringify(res.body)}`);
      smsVersion = Number(res.body.data.version);
    };
    const proofFor = async (phone: string): Promise<string> => {
      const buyer = site();
      const asked = await buyer.post('/api/storefront/v1/auth/otp/request', { phone });
      if (asked.status !== 202) throw new Error(`otp request: ${asked.status} ${JSON.stringify(asked.body)}`);
      const code = String((JSON.parse(sms.bodies.at(-1) ?? '{}') as { parameters?: Array<{ value: string }> }).parameters?.[0]?.value ?? '');
      const verified = await buyer.post('/api/storefront/v1/auth/otp/verify', { phone, code });
      if (verified.status !== 200) throw new Error(`otp verify: ${verified.status} ${JSON.stringify(verified.body)}`);
      return String(verified.body.data.phoneProof);
    };
    // a phone gets a new code only after the resend wait: the test moves its last code back in time instead of waiting
    const ageCodes = (phone: string) => orm.update(storefrontSmsCodes).set({ createdAt: new Date(Date.now() - 120_000).toISOString() })
      .where(eq(storefrontSmsCodes.phoneKey, phoneMatchKey(phone)));

    // 1) the retail cap (texts off): six of an item is refused at the quote and at the order, five is taken
    await smsSwitch(false);
    const quoteSix = await site().post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug: slugTen, quantity: 6 }] });
    if (quoteSix.status !== 422 || quoteSix.body.code !== 'STOREFRONT_RETAIL_LINE_CAP' || quoteSix.body.details?.field !== 'lines') {
      wrong.push(`a quote of six: ${quoteSix.status} ${quoteSix.body.code}`);
    }
    const orderSix = await site().post('/api/storefront/v1/orders', order(phoneOff, `rk-six-${tag}-proof-check`, [{ slug: slugTen, quantity: 6 }]));
    if (orderSix.status !== 422 || orderSix.body.code !== 'STOREFRONT_RETAIL_LINE_CAP') wrong.push(`an order of six: ${orderSix.status} ${orderSix.body.code}`);
    if ((await stockOf(slugTen)) !== 10) wrong.push('an order of six reserved stock');
    const quoteFive = await site().post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug: slugTen, quantity: 5 }] });
    if (quoteFive.status !== 200) wrong.push(`a quote of five: ${quoteFive.status} ${quoteFive.body.code}`);

    // 2) texts off: a guest orders without a proof, as before
    const offPlaced = await site().post('/api/storefront/v1/orders', order(phoneOff, `rk-off-${tag}-proof-check`, [{ slug: slugTwo, quantity: 1 }]));
    if (offPlaced.status !== 201) wrong.push(`a guest order with the texts off: ${offPlaced.status} ${JSON.stringify(offPlaced.body)}`);
    if ((await stockOf(slugTwo)) !== 1) wrong.push(`stock after the texts-off order: ${await stockOf(slugTwo)}, not 1`);

    // 3) texts on: no proof, then another phone's proof: 422, and nothing is made
    await smsSwitch(true);
    const customersBefore = await customersOf(phoneGuest);
    const noProof = await site().post('/api/storefront/v1/orders', order(phoneGuest, `rk-none-${tag}-proof-check`, [{ slug: slugTen, quantity: 1 }]));
    if (noProof.status !== 422 || noProof.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`a guest order without a proof: ${noProof.status} ${noProof.body.code}`);
    const otherProof = await proofFor(phoneOther);
    const foreign = await site().post('/api/storefront/v1/orders', order(phoneGuest, `rk-foreign-${tag}-proof-check`, [{ slug: slugTen, quantity: 1 }], { phoneProof: otherProof }));
    if (foreign.status !== 422 || foreign.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`another phone's proof: ${foreign.status} ${foreign.body.code}`);
    if ((await ordersOf(phoneGuest)).length !== 0) wrong.push('a refused guest order left an order row');
    if ((await customersOf(phoneGuest)) !== customersBefore) wrong.push('a refused guest order made a customer');
    if ((await stockOf(slugTen)) !== 10) wrong.push('a refused guest order reserved stock');

    // 4) the guest's own proof on an order that is short (two asked, one left): 409, and the proof is still good after
    const proof = await proofFor(phoneGuest);
    const short = await site().post('/api/storefront/v1/orders', order(phoneGuest, `rk-short-${tag}-proof-check`, [{ slug: slugTwo, quantity: 2 }], { phoneProof: proof }));
    if (short.status !== 409 || short.body.code !== 'STOREFRONT_OUT_OF_STOCK') wrong.push(`a short order with a proof: ${short.status} ${short.body.code}`);
    const body = order(phoneGuest, `rk-own-${tag}-proof-check`, [{ slug: slugTwo, quantity: 1 }], { phoneProof: proof });
    const placed = await site().post('/api/storefront/v1/orders', body);
    if (placed.status !== 201) wrong.push(`the guest's order with its own proof after a refusal: ${placed.status} ${JSON.stringify(placed.body)}`);
    if ((await stockOf(slugTwo)) !== 0) wrong.push(`stock after the proven order: ${await stockOf(slugTwo)}, not 0`);

    // 5) the used proof: a repeat of the same request answers the same order; a new order with it is refused
    const replay = await site().post('/api/storefront/v1/orders', body);
    if (replay.status !== 201 || replay.body.data?.order?.number !== placed.body.data?.order?.number || replay.body.data?.accessKey !== placed.body.data?.accessKey) {
      wrong.push(`a replay with the used proof: ${replay.status} ${replay.body.code ?? ''}`);
    }
    const reused = await site().post('/api/storefront/v1/orders', order(phoneGuest, `rk-reuse-${tag}-proof-check`, [{ slug: slugTen, quantity: 1 }], { phoneProof: proof }));
    if (reused.status !== 422 || reused.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`a used proof on a new order: ${reused.status} ${reused.body.code}`);
    if ((await ordersOf(phoneGuest)).length !== 1) wrong.push(`the guest phone has ${(await ordersOf(phoneGuest)).length} orders, not 1`);

    // 6) a signed-in account (made with its proof) orders without one
    await ageCodes(phoneMember);
    const memberProof = await proofFor(phoneMember);
    const registered = await site().post('/api/storefront/v1/auth/register', { name: `عضو اثبات ${tag}`, phone: phoneMember, password: PASSWORD, phoneProof: memberProof });
    const token = String(registered.body.data?.sessionToken ?? '');
    if (registered.status !== 201 || !token) throw new Error(`register: ${registered.status} ${JSON.stringify(registered.body)}`);
    const member = await site(token).post('/api/storefront/v1/orders', order(phoneMember, `rk-member-${tag}-proof-check`, [{ slug: slugTen, quantity: 1 }]));
    if (member.status !== 201) wrong.push(`a signed-in order without a proof: ${member.status} ${JSON.stringify(member.body)}`);

    // 7) v12 phase 7e (site review 1.4): a visitor's catalog reads have a limit of their own; another visitor and the
    // site's shared reads (no visitor named) still read
    const { STOREFRONT_VISITOR_READS_PER_MINUTE } = await import('../../routes/storefrontApi.routes.js');
    const visitorRead = (ip: string, q: string) => request(app).get(`/api/storefront/v1/products?q=${encodeURIComponent(q)}`)
      .set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip);
    const reader = `10.32.${Number(tag.slice(-2)) % 250}.7`;
    let lastStatus = 0;
    for (let i = 0; i <= STOREFRONT_VISITOR_READS_PER_MINUTE; i++) lastStatus = (await visitorRead(reader, `proof-${i}`)).status;
    if (lastStatus !== 429) wrong.push(`read ${STOREFRONT_VISITOR_READS_PER_MINUTE + 1} of one visitor: ${lastStatus}, not 429`);
    const otherReader = await visitorRead(`10.33.${Number(tag.slice(-2)) % 250}.8`, 'proof');
    if (otherReader.status !== 200) wrong.push(`another visitor after one was limited: ${otherReader.status}`);
    const shared = await request(app).get('/api/storefront/v1/products?q=proof').set('Authorization', `Bearer ${apiKey}`);
    if (shared.status !== 200) wrong.push(`a shared read after one visitor was limited: ${shared.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'six of an item was 422 STOREFRONT_RETAIL_LINE_CAP at the quote and the order and reserved nothing, five was quoted; with the texts off a guest ordered without a proof; with the texts on a guest order without a proof and with another phone\'s proof was 422 and left no order, customer or reservation; the own proof survived a 409 short order and then placed the order; a replay with the used proof answered the same order and key, a new order with it was 422; a signed-in account ordered without a proof; one visitor\'s catalog read past the per-visitor limit was 429 while another visitor and the site\'s shared reads still read',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
    await sms.close().catch(() => undefined);
    if (savedBase === undefined) delete process.env.ERP_SMS_TEST_API_BASE;
    else process.env.ERP_SMS_TEST_API_BASE = savedBase;
    if (phoneKeys.length > 0) {
      await orm.delete(storefrontSmsMessages).where(inArray(storefrontSmsMessages.phoneKey, phoneKeys)).catch(() => undefined);
      await orm.delete(storefrontSmsCodes).where(inArray(storefrontSmsCodes.phoneKey, phoneKeys)).catch(() => undefined);
      await orm.delete(storefrontOrders).where(inArray(storefrontOrders.phoneKey, phoneKeys)).catch(() => undefined);
      const ids = (await orm.select({ id: storefrontBuyerAccounts.id }).from(storefrontBuyerAccounts)
        .where(inArray(storefrontBuyerAccounts.phoneKey, phoneKeys)).catch(() => [])).map(r => r.id);
      if (ids.length > 0) {
        await orm.delete(storefrontBuyerSessions).where(inArray(storefrontBuyerSessions.accountId, ids)).catch(() => undefined);
        await orm.delete(storefrontBuyerAccounts).where(inArray(storefrontBuyerAccounts.id, ids)).catch(() => undefined);
      }
    }
    if (itemIds.length > 0) {
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
    if (methodId !== null) await orm.update(storefrontShippingMethods).set({ isDeleted: 1 }).where(eq(storefrontShippingMethods.id, methodId)).catch(() => undefined);
    if (bankId !== null) await orm.update(bankAccounts).set({ isActive: 0, isDeleted: 1 }).where(eq(bankAccounts.id, bankId)).catch(() => undefined);
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
