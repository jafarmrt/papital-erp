import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, activityLogs, appSettings, bankAccounts, itemPrices, items, storefrontBuyerAccounts, storefrontBuyerSessions, storefrontOrders,
  storefrontProducts, storefrontShippingMethods, storefrontSmsCodes, storefrontSmsMessages, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { ORDER_TRACK_TRIES_PER_ORDER_HOUR, ORDER_TRACK_TRIES_PER_VISITOR_HOUR } from '../../lib/storefront/storefrontOrderRules.js';

/**
 * v12 phase 8d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, site review 2.2): a guest order opened on another phone with
 * its buyer's phone and a code, on real Express routes and PostgreSQL, against a fake SMS service on this machine:
 *
 * - The buyer's phone and a live proof of it answer the order's own tracking key, which then reads the order; the proof is
 *   used up (red before: no way in without the key typed by hand).
 * - Another phone with its own proof, the buyer's phone with another phone's proof, a number that is no order and a used
 *   proof are each the same 404 with the same words; a refused try leaves the proof good for the right number.
 * - Opening the order writes an audit row that names the order, never the phone.
 * - Failed tries are limited per order (from any visitor) and per visitor (over any order), each per hour; a try that
 *   opens the order does not count.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const SMS_KEY = 'TestSmsKey0123456789abcdefXYZ';
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

export async function runStorefrontGuestTrackingV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_guest_tracking_v12_p8d';
  if (!shouldRun(id, 'v12', 'phase8', 'storefront', 'orders', 'sms', 'security')) return results;

  const name = 'v12 phase 8d: a guest order opens on another phone with its buyer\'s phone and a proof, answering its own key and using the proof; another phone, another phone\'s proof, no such order and a used proof are the same 404; failed tries are limited per order and per visitor';
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
    const [phoneBuyer, phoneOther, phoneThird] = ['0919', '0920', '0921'].map(p => `${p}${tag}`);
    phoneKeys.push(...[phoneBuyer, phoneOther, phoneThird].map(p => phoneMatchKey(p)));

    // the shop: a retail list, one item of two units and one of ten, a flat shipping method, the site on and ordering
    const retailList = `تکی پیگیری مهمان ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const two = await createTestItem({ name: `انگشتر پیگیری ${tag}`, code: `SFT-A-${tag}`, stocks: { '': 2 } });
    const ten = await createTestItem({ name: `دستبند پیگیری ${tag}`, code: `SFT-B-${tag}`, stocks: { '': 10 } });
    itemIds.push(two.id, ten.id);
    await orm.insert(itemPrices).values([
      { itemId: two.id, title: retailList, price: money(PRICE), currency: 'IRR' },
      { itemId: ten.id, title: retailList, price: money(PRICE), currency: 'IRR' },
    ]);
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFT-${tag}`, title: 'ERP-TEST-MARKER حساب پیگیری مهمان سایت', type: 'bank', currency: 'IRR',
      accountId: ledger?.id ?? null, initialBalance: money(0), currentBalance: money(0),
    }).returning({ id: bankAccounts.id });
    bankId = bank.id;
    const read = await erp.get('/api/storefront/settings');
    const saved = await erp.put('/api/storefront/settings', {
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: '', lowStockThreshold: 0, stockDisplay: 'count',
      warehouseCode: warehouse.code, whatsappNumber: '', whatsappEnabled: false, enabled: true, ordersEnabled: true, treasuryAccountId: bank.id,
      openOrdersPerPhone: 20, version: Number(read.body.data.version),
    });
    if (saved.status !== 200) throw new Error(`save settings: ${saved.status} ${JSON.stringify(saved.body)}`);
    const apiKey = String((await erp.post('/api/storefront/api-key')).body.data?.apiKey ?? '');
    const method = await erp.post('/api/storefront/shipping-methods', {
      code: `sft-${tag}`, title: 'پست آزمون پیگیری', description: '', pricing: 'flat', flatRate: '500000', isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slugTwo = `track-ring-${tag}`;
    const slugTen = `track-band-${tag}`;
    for (const [itemId, slug] of [[two.id, slugTwo], [ten.id, slugTen]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    let ipCount = 10;
    const site = (session = '') => {
      const ip = `10.51.0.${ipCount++}`;
      return {
        get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session),
        post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session).send(body),
      };
    };
    const order = (phone: string, requestKey: string, lines: Array<{ slug: string; quantity: number }>, extra: Body = {}): Body => ({
      requestKey, recipientName: `خریدار پیگیری ${tag}`, phone, province: 'تهران', city: 'تهران', address: 'خیابان آزمون، پلاک ۲',
      postalCode: '1234567890', note: '', shippingMethod: `sft-${tag}`, lines, ...extra,
    });

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

    await smsSwitch(true);
    const access = (number: string, body: Body, ip?: string) => {
      const call = site().post(`/api/storefront/v1/orders/${number}/access`, body);
      return ip ? call.set('X-Storefront-Client-IP', ip) : call;
    };
    const refusal = (res: { status: number; body: { code?: string; error?: string; message?: string } }) =>
      `${res.status} ${res.body.code ?? ''} ${res.body.error ?? res.body.message ?? ''}`;

    // 1) two guests order with their own proofs (the texts on)
    const placedOf = async (phone: string, key: string) => {
      const placed = await site().post('/api/storefront/v1/orders', order(phone, key, [{ slug: slugTen, quantity: 1 }], { phoneProof: await proofFor(phone) }));
      if (placed.status !== 201) throw new Error(`place ${key}: ${placed.status} ${JSON.stringify(placed.body)}`);
      return { number: String(placed.body.data.order.number), key: String(placed.body.data.accessKey) };
    };
    const mine = await placedOf(phoneBuyer, `rk-track-a-${tag}`);
    await ageCodes(phoneOther);
    const others = await placedOf(phoneOther, `rk-track-b-${tag}`);

    // 2) the refusals, each the same 404 with the same words
    await ageCodes(phoneBuyer);
    await ageCodes(phoneOther);
    const otherProof = await proofFor(phoneOther);
    const buyerProof = await proofFor(phoneBuyer);
    const anotherPhone = await access(mine.number, { phone: phoneOther, phoneProof: otherProof });
    const anotherProof = await access(mine.number, { phone: phoneBuyer, phoneProof: otherProof });
    const noOrder = await access(`9${tag}42`, { phone: phoneBuyer, phoneProof: buyerProof });
    const badProof = await access(mine.number, { phone: phoneBuyer, phoneProof: 'pp_not-a-real-proof-of-this-phone' });
    const first = refusal(anotherPhone);
    if (anotherPhone.status !== 404 || anotherPhone.body.code !== 'STOREFRONT_ORDER_NOT_FOUND') wrong.push(`another phone on the order: ${first}`);
    for (const [label, res] of [['the buyer with another phone\'s proof', anotherProof], ['a number that is no order', noOrder], ['a wrong proof', badProof]] as const) {
      if (refusal(res) !== first) wrong.push(`${label}: ${refusal(res)}, not the same as ${first}`);
    }

    // 3) the right number with the proof the refusal left good: the order's own key, which reads it; the proof is used up
    const opened = await access(mine.number, { phone: phoneBuyer, phoneProof: buyerProof });
    if (opened.status !== 200 || opened.body.data?.accessKey !== mine.key) wrong.push(`the buyer's own phone and proof: ${opened.status} ${JSON.stringify(opened.body)}`);
    const keys = Object.keys(opened.body.data ?? {}).sort().join(',');
    if (keys !== 'accessKey') wrong.push(`the answer carries ${keys}, not only accessKey`);
    const readBack = await site().get(`/api/storefront/v1/orders/${mine.number}`).set('X-Order-Key', String(opened.body.data?.accessKey ?? ''));
    if (readBack.status !== 200 || readBack.body.data?.number !== mine.number) wrong.push(`the order read with the answered key: ${readBack.status}`);
    const again = await access(mine.number, { phone: phoneBuyer, phoneProof: buyerProof });
    if (refusal(again) !== first) wrong.push(`the used proof again: ${refusal(again)}`);

    // 4) the audit row names the order, never the phone
    const [row] = await orm.select({ id: storefrontOrders.id }).from(storefrontOrders).where(eq(storefrontOrders.orderNumber, mine.number));
    const logs = await orm.select({ action: activityLogs.action, description: activityLogs.description, details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'سفارش سایت'), eq(activityLogs.entityId, String(row.id)), eq(activityLogs.action, 'VIEW')));
    if (logs.length !== 1) wrong.push(`${logs.length} audit rows for the opened order, not 1`);
    if (logs.some(l => `${l.description} ${JSON.stringify(l.details)}`.includes(phoneBuyer.slice(-7)))) wrong.push('the audit row names the phone');

    // 5) the per-order limit: failed tries from many visitors close the order to everyone for the hour, the right proof too
    for (let i = 0; i < ORDER_TRACK_TRIES_PER_ORDER_HOUR; i++) {
      const res = await access(others.number, { phone: phoneOther, phoneProof: `pp_wrong-try-${i}-of-this-order-${tag}` });
      if (res.status !== 404) wrong.push(`failed try ${i + 1} on one order: ${res.status}`);
    }
    await ageCodes(phoneOther);
    const lockedOut = await access(others.number, { phone: phoneOther, phoneProof: await proofFor(phoneOther) });
    if (lockedOut.status !== 429) wrong.push(`a try past ${ORDER_TRACK_TRIES_PER_ORDER_HOUR} failures on one order: ${lockedOut.status}, not 429`);

    // 6) the per-visitor limit: one visitor's failed tries over many numbers; another visitor still tries; a try that
    // opens an order does not count
    const visitor = `10.52.${Number(tag.slice(-2)) % 250}.9`;
    await ageCodes(phoneThird);
    const third = await placedOf(phoneThird, `rk-track-c-${tag}`);
    // 8d review: an order whose phone was not proven when placed (before 8c its phone was the recipient's) never opens
    const [placedRow] = await orm.select({ phoneProven: storefrontOrders.phoneProven }).from(storefrontOrders).where(eq(storefrontOrders.orderNumber, third.number));
    if (placedRow?.phoneProven !== 1) wrong.push(`an order placed with a proof is phone_proven ${placedRow?.phoneProven}`);
    await orm.update(storefrontOrders).set({ phoneProven: 0 }).where(eq(storefrontOrders.orderNumber, third.number));
    await ageCodes(phoneThird);
    const unprovenProof = await proofFor(phoneThird);
    const unproven = await access(third.number, { phone: phoneThird, phoneProof: unprovenProof });
    if (refusal(unproven) !== first) wrong.push(`an order with an unproven phone: ${refusal(unproven)}`);
    await orm.update(storefrontOrders).set({ phoneProven: 1 }).where(eq(storefrontOrders.orderNumber, third.number));
    const openedFirst = await access(third.number, { phone: phoneThird, phoneProof: unprovenProof }, visitor);
    if (openedFirst.status !== 200) wrong.push(`the visitor's own order: ${openedFirst.status}`);
    for (let i = 0; i < ORDER_TRACK_TRIES_PER_VISITOR_HOUR; i++) {
      const res = await access(`8${tag}${String(i).padStart(2, '0')}`, { phone: phoneThird, phoneProof: `pp_wrong-visitor-try-${i}-${tag}` }, visitor);
      if (res.status !== 404) wrong.push(`the visitor's failed try ${i + 1}: ${res.status}`);
    }
    const tooMany = await access(`8${tag}99`, { phone: phoneThird, phoneProof: `pp_wrong-visitor-try-last-${tag}` }, visitor);
    if (tooMany.status !== 429) wrong.push(`the visitor's try past ${ORDER_TRACK_TRIES_PER_VISITOR_HOUR} failures: ${tooMany.status}, not 429`);
    const otherVisitor = await access(`8${tag}98`, { phone: phoneThird, phoneProof: `pp_wrong-other-visitor-${tag}` }, `10.53.${Number(tag.slice(-2)) % 250}.9`);
    if (otherVisitor.status !== 404) wrong.push(`another visitor after one was limited: ${otherVisitor.status}`);

    // 7) a request that names no visitor (the site without STOREFRONT_TRUST_PROXY) shares no visitor budget with others.
    // These requests come from a loopback address of their own, so the shared write limit of this test process (every
    // other test's unnamed requests come from 127.0.0.1) cannot answer before the visitor limit would
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const from = `127.0.${(Number(tag.slice(-3)) % 250) + 2}.${(Number(tag.slice(-6, -3)) % 250) + 2}`;
    const unnamed = (number: string, body: Body) => new Promise<{ status: number; policy: string }>((resolve, reject) => {
      const payload = JSON.stringify(body);
      const call = http.request({
        host: '127.0.0.1', port: (server.address() as AddressInfo).port, localAddress: from, method: 'POST',
        path: `/api/storefront/v1/orders/${number}/access`,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, policy: String(res.headers['ratelimit-policy'] ?? '') }));
      });
      call.on('error', reject);
      call.end(payload);
    });
    try {
      for (let i = 0; i <= ORDER_TRACK_TRIES_PER_VISITOR_HOUR; i++) {
        const res = await unnamed(`7${tag}${String(i).padStart(2, '0')}`, { phone: phoneThird, phoneProof: `pp_wrong-unnamed-try-${i}-${tag}` });
        if (res.status !== 404) { wrong.push(`unnamed failed try ${i + 1}: ${res.status} ${res.policy}, not 404`); break; }
      }
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }

    // 8) 8d delta review: an order placed with the texts off keeps an unproven phone
    await smsSwitch(false);
    const phoneOff = `0922${tag}`;
    phoneKeys.push(phoneMatchKey(phoneOff));
    const offPlaced = await site().post('/api/storefront/v1/orders', order(phoneOff, `rk-track-d-${tag}`, [{ slug: slugTen, quantity: 1 }]));
    if (offPlaced.status !== 201) wrong.push(`an order with the texts off: ${offPlaced.status}`);
    else {
      const [offRow] = await orm.select({ phoneProven: storefrontOrders.phoneProven }).from(storefrontOrders)
        .where(eq(storefrontOrders.orderNumber, String(offPlaced.body.data.order.number)));
      if (offRow?.phoneProven !== 0) wrong.push(`an order with the texts off is phone_proven ${offRow?.phoneProven}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'the buyer\'s phone and its proof answered the order\'s own key, which read the order, and used the proof; another phone, another phone\'s proof, a number that is no order, a wrong proof and the used proof were the same 404 with the same words; a refused try left the proof good; one audit row named the order without the phone; failed tries closed one order to everyone and one visitor to every order for the hour, while another visitor still tried and a try that opened an order did not count; an order whose phone was not proven when placed did not open and left the proof good; requests naming no visitor shared no visitor budget; an order placed with the texts off kept phone_proven 0',
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
