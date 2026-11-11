import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { and, asc, desc, eq, inArray, like, ne, or, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, activityLogs, appSettings, bankAccounts, itemPrices, items, notifications, storefrontOrders, storefrontPaymentReceipts, storefrontProducts,
  storefrontShippingMethods, storefrontSmsCodes, storefrontSmsMessages, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v11 phase 8.4a (docs/roadmap/V11_STOREFRONT_8_4_SMS_START_PLAN.md): the site's texts on real Express routes and
 * PostgreSQL, against a fake SMS service on this machine (`ERP_SMS_TEST_API_BASE`). The provider key is stored encrypted
 * and never answered or audited; while texts are off an order queues nothing; once on, an order and its cancel each
 * queue one message in their own transaction, the sender sends it with the template and the order number only, and a
 * 503 is tried again later. A login code is sent with its digits but stored only as a keyed hash; a second code within the
 * minute is 429; a wrong code counts a try; the right code gives a single-use phone proof for that phone alone; a code
 * whose text failed is closed; a phone's wrong tries of the day stop even a right code; the site's hourly budget holds for
 * login codes and order texts alike; without a login template the route is 404. A test text is logged with the phone masked.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;
interface Captured { path: string; headers: http.IncomingHttpHeaders; body: string }

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const PRICE = '9000000';
const SMS_KEY = 'TestSmsKey0123456789abcdefXYZ';

async function fakeSmsServer() {
  const captured: Captured[] = [];
  const state = { mode: 'ok' as 'ok' | 'down' };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      captured.push({ path: req.url ?? '', headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      if (state.mode === 'down') {
        res.statusCode = 503;
        res.end('{}');
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 1, message: 'موفق', data: { messageId: captured.length, cost: 1 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { captured, state, base: `http://127.0.0.1:${port}`, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

export async function runStorefrontSmsV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_sms_v11_8_4a';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'sms', 'otp', 'security')) return results;

  const name = 'v11 phase 8.4a: site texts: an encrypted write-only provider key, nothing queued while off, an order and its cancel queued in their transaction and sent with the template and order number, a 503 retried, a login code stored as a hash with its limits, a single-use phone proof, the hourly budget, 404 without a template, and a masked test log';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const orderIds: number[] = [];
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
    const { sendDueMessagesOnce } = await import('../../services/storefront/storefrontSms.service.js');
    const { consumePhoneProof } = await import('../../services/storefront/storefrontSmsOtp.service.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const erp = {
      get: (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
    };
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const phoneA = `0915${tag}`;
    const phoneB = `0916${tag}`;
    const phoneC = `0917${tag}`;
    const phoneD = `0918${tag}`;
    const phoneE = `0919${tag}`;
    // v12 phase 8b: fresh phones for the two budgets (the others have used up their own hourly codes by step 7)
    const phoneF = `0910${tag}`;
    const phoneG = `0911${tag}`;
    phoneKeys.push(...[phoneA, phoneB, phoneC, phoneD, phoneE, phoneF, phoneG].map(p => p.slice(1)));

    // the shop: a retail list, one item of 3 units, a flat method, a bank account, the site on and taking orders
    const retailList = `تکی پیامک ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const item = await createTestItem({ name: `دستبند پیامک ${tag}`, code: `SFS-A-${tag}`, stocks: { '': 3 } });
    itemIds.push(item.id);
    await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money(PRICE), currency: 'IRR' });
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFS-${tag}`, title: 'ERP-TEST-MARKER حساب پیامک سایت', type: 'bank', currency: 'IRR',
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
    const site = (ip: string) => ({
      post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).send(body),
    });
    const method = await erp.post('/api/storefront/shipping-methods', {
      code: `sfs-${tag}`, title: 'پست آزمون پیامک', description: '', pricing: 'flat', flatRate: '500000', isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slug = `bracelet-sms-${tag}`;
    const pub = await erp.put(`/api/storefront/products/${item.id}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
    if (pub.status !== 200) throw new Error(`publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    // v12 phase 7d: while the site signs in by SMS, a guest order carries a phone proof for its own phone
    const order = async (phone: string, n: number, phoneProof = '') => {
      const res = await site('10.20.0.1').post('/api/storefront/v1/orders', {
        requestKey: `rk-sms-${n}-${tag}-checkout`, recipientName: `خریدار پیامک ${tag}`, phone, province: 'تهران', city: 'تهران',
        address: 'خیابان آزمون، پلاک ۲', postalCode: '1234567890', note: '', shippingMethod: `sfs-${tag}`, lines: [{ slug, quantity: 1 }],
        ...(phoneProof ? { phoneProof } : {}),
      });
      if (res.status !== 201) throw new Error(`place: ${res.status} ${JSON.stringify(res.body)}`);
      const [row] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, res.body.data.order.number));
      orderIds.push(row.id);
      return row;
    };
    const proofFor = async (phone: string): Promise<string> => {
      const asked = await site('10.20.0.8').post('/api/storefront/v1/auth/otp/request', { phone });
      if (asked.status !== 202) throw new Error(`otp request for an order: ${asked.status} ${JSON.stringify(asked.body)}`);
      const code = String((JSON.parse(sms.captured.at(-1)?.body ?? '{}') as { parameters?: Array<{ value: string }> }).parameters?.[0]?.value ?? '');
      const verified = await site('10.20.0.8').post('/api/storefront/v1/auth/otp/verify', { phone, code });
      if (verified.status !== 200) throw new Error(`otp verify for an order: ${verified.status} ${JSON.stringify(verified.body)}`);
      return String(verified.body.data.phoneProof);
    };
    const messagesOf = (orderId: number) => orm.select().from(storefrontSmsMessages).where(eq(storefrontSmsMessages.orderId, orderId)).orderBy(asc(storefrontSmsMessages.id));

    // 1) the settings: on needs a key; the key is stored encrypted and never answered or audited
    let smsView = (await erp.get('/api/storefront/sms/settings')).body.data;
    if (smsView?.enabled !== false || smsView?.apiKey?.configured !== false) wrong.push(`sms default: ${JSON.stringify(smsView)}`);
    const base = { provider: 'smsir', apiKey: '', clearApiKey: false, hourlyCap: 200 };
    const noKey = await erp.put('/api/storefront/sms/settings', { ...base, enabled: true, templates: {}, version: smsView.version });
    if (noKey.status !== 422 || noKey.body.code !== 'STOREFRONT_SMS_NEEDS_KEY') wrong.push(`on without a key: ${noKey.status} ${noKey.body.code}`);
    const badTemplate = await erp.put('/api/storefront/sms/settings', { ...base, enabled: false, apiKey: SMS_KEY, templates: { otp: 'login' }, version: smsView.version });
    if (badTemplate.status !== 422 || badTemplate.body.code !== 'STOREFRONT_SMS_TEMPLATE_INVALID') wrong.push(`a word as an sms.ir template: ${badTemplate.status} ${badTemplate.body.code}`);
    const templates = { otp: '111', order_placed: '222', order_shipped: '333', order_cancelled: '444' };
    const stored = await erp.put('/api/storefront/sms/settings', { ...base, enabled: false, apiKey: SMS_KEY, templates, version: smsView.version });
    if (stored.status !== 200) throw new Error(`save sms: ${stored.status} ${JSON.stringify(stored.body)}`);
    smsView = stored.body.data;
    const [sealed] = await orm.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'sf_sms_api_key'));
    if (!String(sealed?.value ?? '').startsWith('enc:v1:')) wrong.push('the SMS key is not stored encrypted');
    if (JSON.stringify(stored.body).includes(SMS_KEY) || JSON.stringify((await erp.get('/api/storefront/sms/settings')).body).includes(SMS_KEY)) wrong.push('an answer carries the SMS key');
    if (smsView?.apiKey?.hint !== SMS_KEY.slice(-4) || smsView?.apiKey?.readable !== true) wrong.push(`the key hint: ${JSON.stringify(smsView?.apiKey)}`);
    const [audit] = await orm.select({ details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'فروشگاه سایت'), eq(activityLogs.entityId, 'sms'))).orderBy(desc(activityLogs.id)).limit(1);
    if (!audit || JSON.stringify(audit.details).includes(SMS_KEY)) wrong.push('the settings audit row is missing or carries the key');
    // a key belongs to its provider: another provider with the stored key is refused
    const otherProvider = await erp.put('/api/storefront/sms/settings', { ...base, provider: 'kavenegar', enabled: false, templates: {}, version: smsView.version });
    if (otherProvider.status !== 422 || otherProvider.body.code !== 'STOREFRONT_SMS_KEY_FOR_OTHER_PROVIDER') wrong.push(`another provider with the stored key: ${otherProvider.status} ${otherProvider.body.code}`);

    // 2) texts off: an order queues nothing
    const quiet = await order(phoneA, 1);
    if ((await messagesOf(quiet.id)).length !== 0) wrong.push('an order queued a text while texts were off');

    // 3) texts on (the stored key kept): an order queues one text in its transaction; the sender sends the template
    const on = await erp.put('/api/storefront/sms/settings', { ...base, enabled: true, templates, version: smsView.version });
    if (on.status !== 200) throw new Error(`sms on: ${on.status} ${JSON.stringify(on.body)}`);
    smsView = on.body.data;
    // the proof of step 7's order is taken now: past the hourly budget no code can be asked for
    const proofOverBudget = await proofFor(phoneE);
    const loud = await order(phoneB, 2, await proofFor(phoneB));
    const queued = await messagesOf(loud.id);
    if (queued.length !== 1 || queued[0].kind !== 'order_placed' || queued[0].status !== 'queued' || queued[0].params !== JSON.stringify({ ORDER: loud.orderNumber }) || queued[0].phone !== phoneB) {
      wrong.push(`the order text: ${JSON.stringify(queued.map(q => ({ k: q.kind, s: q.status, p: q.params, ph: q.phone })))}`);
    }
    await sendDueMessagesOnce();
    const [sentRow] = await messagesOf(loud.id);
    const call = sms.captured.at(-1);
    const sentBody = call ? JSON.parse(call.body) as Body : {};
    if (sentRow?.status !== 'sent' || !sentRow.sentAt) wrong.push(`after the sender: ${sentRow?.status} ${sentRow?.error}`);
    if (call?.path !== '/smsir/v1/send/verify' || call.headers['x-api-key'] !== SMS_KEY || sentBody.templateId !== 222 || sentBody.mobile !== phoneB
      || JSON.stringify(sentBody.parameters) !== JSON.stringify([{ name: 'ORDER', value: loud.orderNumber }])) {
      wrong.push(`the provider call: ${call?.path} ${call?.body}`);
    }

    // 4) a cancel queues its text; a 503 leaves it queued for later, and the next pass sends it
    const detail = (await erp.get(`/api/storefront/orders/${loud.id}`)).body.data;
    const cancelled = await erp.post(`/api/storefront/orders/${loud.id}/cancel`, { version: detail.version });
    if (cancelled.status !== 200) wrong.push(`cancel: ${cancelled.status} ${JSON.stringify(cancelled.body)}`);
    sms.state.mode = 'down';
    await sendDueMessagesOnce();
    let cancelText = (await messagesOf(loud.id)).find(m => m.kind === 'order_cancelled');
    if (cancelText?.status !== 'queued' || cancelText.attempts !== 1) wrong.push(`a 503: ${cancelText?.status} ${cancelText?.attempts}`);
    sms.state.mode = 'ok';
    await orm.update(storefrontSmsMessages).set({ nextAttemptAt: new Date(Date.now() - 60_000).toISOString() }).where(eq(storefrontSmsMessages.id, cancelText!.id));
    await sendDueMessagesOnce();
    cancelText = (await messagesOf(loud.id)).find(m => m.kind === 'order_cancelled');
    if (cancelText?.status !== 'sent' || cancelText.attempts !== 2) wrong.push(`the retry: ${cancelText?.status} ${cancelText?.attempts}`);

    // 5) a login code: sent with its digits, stored only as a hash; a second within the minute is 429
    const asked = await site('10.20.0.2').post('/api/storefront/v1/auth/otp/request', { phone: phoneC });
    if (asked.status !== 202 || asked.body.data?.expiresIn !== 180) wrong.push(`otp request: ${asked.status} ${JSON.stringify(asked.body)}`);
    const otpCall = JSON.parse(sms.captured.at(-1)?.body ?? '{}') as { templateId?: number; parameters?: Array<{ name: string; value: string }> };
    const code = String(otpCall.parameters?.[0]?.value ?? '');
    if (otpCall.templateId !== 111 || !/^\d{6}$/.test(code)) wrong.push(`the code text: ${JSON.stringify(otpCall)}`);
    const [codeRow] = await orm.select().from(storefrontSmsCodes).where(eq(storefrontSmsCodes.phoneKey, phoneC.slice(1))).orderBy(desc(storefrontSmsCodes.id)).limit(1);
    const [otpText] = await orm.select().from(storefrontSmsMessages).where(eq(storefrontSmsMessages.id, codeRow?.messageId ?? 0));
    if (!codeRow || JSON.stringify(codeRow).includes(code) || otpText?.params !== '{}' || otpText?.status !== 'sent') wrong.push('the code is stored in clear or its text was not sent');
    const again = await site('10.20.0.2').post('/api/storefront/v1/auth/otp/request', { phone: phoneC });
    if (again.status !== 429 || again.body.code !== 'STOREFRONT_OTP_TOO_MANY') wrong.push(`a second code at once: ${again.status} ${again.body.code}`);

    // 6) a wrong code counts a try; the right one gives a proof once; the proof is single-use and for this phone only
    const wrongCode = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const miss = await site('10.20.0.3').post('/api/storefront/v1/auth/otp/verify', { phone: phoneC, code: wrongCode });
    if (miss.status !== 422 || miss.body.code !== 'STOREFRONT_OTP_INVALID') wrong.push(`a wrong code: ${miss.status} ${miss.body.code}`);
    const persianCode = code.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
    const hit = await site('10.20.0.3').post('/api/storefront/v1/auth/otp/verify', { phone: phoneC, code: persianCode });
    const proof = String(hit.body.data?.phoneProof ?? '');
    if (hit.status !== 200 || !proof.startsWith('pp_')) wrong.push(`the right code: ${hit.status} ${JSON.stringify(hit.body)}`);
    const reuse = await site('10.20.0.3').post('/api/storefront/v1/auth/otp/verify', { phone: phoneC, code });
    if (reuse.status !== 422) wrong.push(`the same code twice: ${reuse.status}`);
    const [tries] = await orm.select({ attempts: storefrontSmsCodes.attempts, proofHash: storefrontSmsCodes.proofHash }).from(storefrontSmsCodes).where(eq(storefrontSmsCodes.id, codeRow!.id));
    if (tries?.attempts !== 2 || !tries.proofHash || tries.proofHash.includes(proof)) wrong.push(`the code row after verify: ${JSON.stringify(tries)}`);
    const otherPhone = await orm.transaction(tx => consumePhoneProof(tx, phoneA, proof));
    const first = await orm.transaction(tx => consumePhoneProof(tx, phoneC, proof));
    const second = await orm.transaction(tx => consumePhoneProof(tx, phoneC, proof));
    if (otherPhone || !first || second) wrong.push(`the phone proof: other ${otherPhone}, first ${first}, second ${second}`);

    // 6b) a code whose text failed is closed and holds no resend wait; a phone's wrong tries of the day stop even a right code
    sms.state.mode = 'down';
    const unsent = await site('10.20.0.6').post('/api/storefront/v1/auth/otp/request', { phone: phoneD });
    sms.state.mode = 'ok';
    if (unsent.status !== 503 || unsent.body.code !== 'STOREFRONT_OTP_NOT_SENT') wrong.push(`a code not sent: ${unsent.status} ${unsent.body.code}`);
    const [closed] = await orm.select({ live: sql<boolean>`${storefrontSmsCodes.expiresAt} > now()` }).from(storefrontSmsCodes)
      .where(eq(storefrontSmsCodes.phoneKey, phoneD.slice(1))).orderBy(desc(storefrontSmsCodes.id)).limit(1);
    if (closed?.live !== false) wrong.push('a code whose text failed stayed open');
    const resent = await site('10.20.0.7').post('/api/storefront/v1/auth/otp/request', { phone: phoneD });
    if (resent.status !== 202) wrong.push(`a new code after a failed text: ${resent.status} ${resent.body.code}`);
    const codeD = String((JSON.parse(sms.captured.at(-1)?.body ?? '{}') as { parameters?: Array<{ value: string }> }).parameters?.[0]?.value ?? '');
    const [liveD] = await orm.select().from(storefrontSmsCodes).where(eq(storefrontSmsCodes.phoneKey, phoneD.slice(1))).orderBy(desc(storefrontSmsCodes.id)).limit(1);
    // an earlier code of the day that took the day's wrong tries
    await orm.insert(storefrontSmsCodes).values({
      phoneKey: phoneD.slice(1), codeHash: liveD.codeHash, addressKey: liveD.addressKey, attempts: 10,
      expiresAt: sql`now() - interval '1 hour'`, createdAt: sql`now() - interval '2 hours'`,
    });
    const capWrong = await site('10.20.0.7').post('/api/storefront/v1/auth/otp/verify', { phone: phoneD, code: codeD });
    if (capWrong.status !== 422 || capWrong.body.code !== 'STOREFRONT_OTP_INVALID') wrong.push(`a right code past the day's wrong tries: ${capWrong.status} ${capWrong.body.code}`);

    // 7) v12 phase 8b (site review 2.11): login codes and order texts each have their own hourly budget, with a bell at
    //    80% of it; and no login template = the route is 404
    const spentOf = async (codes: boolean) => (await orm.select({ total: sql<number>`count(*)::int` }).from(storefrontSmsMessages)
      .where(and(eq(storefrontSmsMessages.isTest, 0), sql`${storefrontSmsMessages.status} <> 'skipped'`, sql`${storefrontSmsMessages.createdAt} > now() - interval '1 hour'`,
        codes ? eq(storefrontSmsMessages.kind, 'otp') : ne(storefrontSmsMessages.kind, 'otp'))))[0].total;
    const codesBefore = await spentOf(true);
    // the order texts' budget spent and one code left in the codes' budget
    const capped = await erp.put('/api/storefront/sms/settings', {
      ...base, enabled: true, templates, hourlyCap: codesBefore + 1, orderHourlyCap: Math.max(1, await spentOf(false)), version: smsView.version,
    });
    if (capped.status !== 200 || capped.body.data.orderHourlyCap !== Math.max(1, await spentOf(false))) throw new Error(`cap: ${capped.status} ${JSON.stringify(capped.body)}`);
    smsView = capped.body.data;
    // an order's text over its budget is written `skipped` and never sent
    const overOrder = await order(phoneE, 3, proofOverBudget);
    const [skippedText] = await messagesOf(overOrder.id);
    if (skippedText?.status !== 'skipped' || !skippedText.error) wrong.push(`an order text over its budget: ${skippedText?.status} ${skippedText?.error}`);
    // the codes' budget is apart: a code still goes, and that last one of the hour rings the codes' bell
    const codeTitle = 'سقف ساعتی کد ورود سایت نزدیک است';
    const bellsOf = async (title: string) => (await orm.select({ id: notifications.id }).from(notifications).where(eq(notifications.title, title))).length;
    const codeStillGoes = await site('10.20.0.9').post('/api/storefront/v1/auth/otp/request', { phone: phoneF });
    if (codeStillGoes.status !== 202) wrong.push(`a code while the order texts are spent: ${codeStillGoes.status} ${codeStillGoes.body.code}`);
    const codeBells = await bellsOf(codeTitle);
    if (codeBells < 1) wrong.push('no bell at 80% of the codes\' budget');
    if (await bellsOf('سقف ساعتی پیامک سفارش سایت نزدیک است') !== 0) wrong.push('a bell for the order texts, none of which was sent');
    const { warnIfBudgetNearlySpent } = await import('../../services/storefront/storefrontSmsBudget.js');
    await warnIfBudgetNearlySpent(orm, codesBefore + 1, 'codes');
    if (await bellsOf(codeTitle) !== codeBells) wrong.push('the codes\' bell rang twice in an hour');
    const overBudget = await site('10.20.0.4').post('/api/storefront/v1/auth/otp/request', { phone: phoneG });
    if (overBudget.status !== 429) wrong.push(`over the codes' hourly budget: ${overBudget.status} ${overBudget.body.code}`);
    const { otp: _otp, ...noOtp } = templates;
    const offOtp = await erp.put('/api/storefront/sms/settings', { ...base, enabled: true, templates: noOtp, version: smsView.version });
    smsView = offOtp.body.data;
    const missing = await site('10.20.0.5').post('/api/storefront/v1/auth/otp/request', { phone: phoneA });
    if (missing.status !== 404) wrong.push(`a code without its template: ${missing.status}`);

    // 8) a test text with sample values, logged as a test with the phone masked
    const test = await erp.post('/api/storefront/sms/test', { phone: phoneA, kind: 'order_shipped' });
    const testCall = JSON.parse(sms.captured.at(-1)?.body ?? '{}') as { templateId?: number; parameters?: Array<{ name: string; value: string }> };
    if (test.status !== 200 || test.body.data?.sent !== true || testCall.templateId !== 333 || testCall.parameters?.length !== 2) wrong.push(`a test text: ${test.status} ${JSON.stringify(test.body)} ${JSON.stringify(testCall)}`);
    const log = await erp.get('/api/storefront/sms/messages?limit=50');
    const testRow = (log.body.data ?? []).find((r: Body) => r.isTest === true && r.kind === 'order_shipped');
    if (log.status !== 200 || !testRow || testRow.phone !== `${phoneA.slice(0, 4)}***${phoneA.slice(-4)}` || JSON.stringify(log.body).includes(phoneA)) {
      wrong.push(`the log: ${log.status} ${JSON.stringify(testRow)}`);
    }
    if (Object.keys(testRow ?? {}).sort().join(',') !== 'attempts,createdAt,error,id,isTest,kind,orderNumber,phone,sentAt,status') wrong.push(`log fields: ${Object.keys(testRow ?? {}).join(',')}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'texts on without a key was 422 and a word as an sms.ir template 422; the key was stored encrypted, answered only as its last four letters and kept out of the audit row; an order queued nothing while texts were off; once on, an order queued one text with its number only and the sender sent template 222 with the key in X-API-KEY; a cancel queued its text, a 503 left it queued and the next pass sent it; another provider with the stored key was 422; a login code was sent with six digits and stored only as a keyed hash, a second within the minute was 429; a wrong code counted a try, the right one in Persian digits gave a proof and the same code again was 422; the proof was refused for another phone, taken once and refused the second time; a code whose text failed was 503, closed and held no resend wait; the wrong tries of the day stopped a right code; the order texts budget skipped an order text while a code still went (and rang the codes bell once at 80%), then the codes budget answered 429; without a login template the route was 404; a test text used the shipped template with two values and the log masked the phone',
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
    await orm.delete(storefrontSmsCodes).where(inArray(storefrontSmsCodes.phoneKey, phoneKeys)).catch(() => undefined);
    const conditions = [inArray(storefrontSmsMessages.phoneKey, phoneKeys)];
    if (orderIds.length > 0) conditions.push(inArray(storefrontSmsMessages.orderId, orderIds));
    await orm.delete(storefrontSmsMessages).where(or(...conditions)).catch(() => undefined);
    if (orderIds.length > 0) {
      await orm.delete(storefrontPaymentReceipts).where(inArray(storefrontPaymentReceipts.orderId, orderIds)).catch(() => undefined);
      await orm.delete(storefrontOrders).where(inArray(storefrontOrders.id, orderIds)).catch(() => undefined);
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
