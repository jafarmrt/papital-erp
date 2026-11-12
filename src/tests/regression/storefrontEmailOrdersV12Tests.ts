import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, appSettings, bankAccounts, customers, itemPrices, items, storefrontBuyerAccounts, storefrontBuyerSessions, storefrontEmailCodes, storefrontOrders,
  storefrontProducts, storefrontShippingMethods, storefrontSmsCodes, storefrontSmsMessages, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { SMS_FAILURE_PAUSE_COUNT, SMS_FAILURE_PAUSE_MINUTES } from '../../lib/storefront/storefrontSmsRules.js';
import { EMAIL_TEST_SMTP_ENV } from '../../services/storefront/storefrontEmailClient.js';

/**
 * v12 phase 8e, part 3 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, owner's decision of 21 Aban 1405): a guest order
 * proven by an email code, on real Express routes and PostgreSQL, against a fake SMS service and a fake mail server:
 *
 * - With the texts off and the email on, a guest order without a proof is 422 and with an email proof is 201; the order
 *   keeps the proven email, its customer is found or made by the email (a customer with the same phone is not used, and
 *   a new one keeps no phone), and the open-orders limit counts by the email.
 * - No text is queued for such an order's phone, even with the texts on.
 * - The order opens on another device with its email and a new email code; another email is the same 404.
 * - «حالت بی پیامک»: the owner's switch, or the latest login texts all failing, turns the SMS sign-in off for the site
 *   (`smsLogin` false, `emailLogin` true) and refuses SMS codes with 503; the switch off brings them back.
 * - A signed-in email-only account orders without a proof.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;
interface Received { auth: string; from: string; to: string[]; data: string }

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

/** A mail server that speaks just enough SMTP for one mail per connection, signing in with PLAIN */
async function fakeMailServer() {
  const received: Received[] = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    const current: Received = { auth: '', from: '', to: [], data: '' };
    socket.write('220 fake.mail ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (true) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          received.push({ ...current, to: [...current.to] });
          socket.write('250 2.0.0 queued\r\n');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-fake.mail\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (verb === 'AUTH') {
          const plain = Buffer.from(line.split(' ')[2] ?? '', 'base64').toString('utf8');
          current.auth = plain;
          socket.write('235 2.7.0 ok\r\n');
        } else if (verb === 'MAIL') { current.from = line; socket.write('250 ok\r\n'); }
        else if (verb === 'RCPT') { current.to.push(line); socket.write('250 ok\r\n'); }
        else if (verb === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (verb === 'QUIT') { socket.end('221 bye\r\n'); return; }
        else if (verb === 'RSET' || verb === 'NOOP') socket.write('250 ok\r\n');
        else socket.write('502 no\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return { received, port, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

/** The text of a mail as the fake server got it: its body, with quoted-printable or base64 undone */
function decodeMail(raw: string): string {
  const [headers, ...rest] = raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) {
    const soft = body.replace(/=\r?\n/g, '');
    return Buffer.from(soft.replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
  }
  return body;
}

export async function runStorefrontEmailOrdersV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_email_orders_v12_p8e';
  if (!shouldRun(id, 'v12', 'phase8', 'storefront', 'email', 'orders', 'security')) return results;

  const name = 'v12 phase 8e: a guest order proven by an email code goes on the customer with that email (never one found by the unproven phone), counts its open orders by the email, sends no text, and opens elsewhere with the email and a new code; «حالت بی پیامک» by the owner or by failing login texts turns the site to email; an email-only account orders without a proof';
  const emailKeys: string[] = [];
  const mail = await fakeMailServer();
  const tStart = Date.now();
  const itemIds: number[] = [];
  const phoneKeys: string[] = [];
  const customerIds: number[] = [];
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
    const [phoneA, phoneB, phoneD, phoneF] = ['0931', '0932', '0933', '0934'].map(p => `${p}${tag}`);
    phoneKeys.push(...[phoneA, phoneB, phoneD, phoneF].map(p => phoneMatchKey(p)));

    // the shop: a retail list, one item of two units and one of ten, a flat shipping method, the site on and ordering
    const retailList = `تکی ایمیل خریدار ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const two = await createTestItem({ name: `انگشتر ایمیل ${tag}`, code: `SFO-A-${tag}`, stocks: { '': 2 } });
    const ten = await createTestItem({ name: `دستبند ایمیل ${tag}`, code: `SFO-B-${tag}`, stocks: { '': 10 } });
    itemIds.push(two.id, ten.id);
    await orm.insert(itemPrices).values([
      { itemId: two.id, title: retailList, price: money(PRICE), currency: 'IRR' },
      { itemId: ten.id, title: retailList, price: money(PRICE), currency: 'IRR' },
    ]);
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFO-${tag}`, title: 'ERP-TEST-MARKER حساب ایمیل خریدار سایت', type: 'bank', currency: 'IRR',
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
      code: `sfo-${tag}`, title: 'پست آزمون ایمیل', description: '', pricing: 'flat', flatRate: '500000', isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slugTwo = `email-order-ring-${tag}`;
    const slugTen = `email-order-band-${tag}`;
    for (const [itemId, slug] of [[two.id, slugTwo], [ten.id, slugTen]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    let ipCount = 10;
    const site = (session = '') => {
      const ip = `10.55.0.${ipCount++}`;
      return {
        get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session),
        post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session).send(body),
      };
    };

    let smsVersion = Number((await erp.get('/api/storefront/sms/settings')).body.data?.version ?? 0);
    const smsSwitch = async (enabled: boolean, templates: Body = { otp: '111' }) => {
      const res = await erp.put('/api/storefront/sms/settings', {
        enabled, provider: 'smsir', apiKey: smsVersion === 0 ? SMS_KEY : '', clearApiKey: false, templates, hourlyCap: 200, version: smsVersion,
      });
      if (res.status !== 200) throw new Error(`sms settings: ${res.status} ${JSON.stringify(res.body)}`);
      smsVersion = Number(res.body.data.version);
    };
    // a phone gets a new code only after the resend wait: the test moves its last code back in time instead of waiting
    const ageCodes = (phone: string) => orm.update(storefrontSmsCodes).set({ createdAt: new Date(Date.now() - 120_000).toISOString() })
      .where(eq(storefrontSmsCodes.phoneKey, phoneMatchKey(phone)));


    await smsSwitch(true);
    const savedEmailEnv = process.env[EMAIL_TEST_SMTP_ENV];
    process.env[EMAIL_TEST_SMTP_ENV] = `127.0.0.1:${mail.port}`;
    const emailView = (await erp.get('/api/storefront/email/settings')).body.data;
    const emailOn = await erp.put('/api/storefront/email/settings', {
      enabled: true, host: '127.0.0.1', port: mail.port, security: 'none', username: '', password: '', clearPassword: true,
      fromAddress: `shop.${tag}@papital-test.example`, fromName: 'پاپیتال', version: emailView.version,
    });
    if (emailOn.status !== 200 || emailOn.body.data?.ready !== true) throw new Error(`email settings: ${emailOn.status} ${JSON.stringify(emailOn.body)}`);
    const [mailA, mailB, mailC, mailD, mailE, mailF] = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => `Order.${x}.${tag}@Papital-Test.example`);
    emailKeys.push(...[mailA, mailB, mailC, mailD, mailE, mailF].map(m => m.toLowerCase()));
    const codeOf = () => /کد تأیید شما: (\d{6})/.exec(mail.received.at(-1)?.data ? decodeMail(mail.received.at(-1)!.data) : '')?.[1] ?? '';
    const ageEmail = (address: string) => orm.update(storefrontEmailCodes).set({ createdAt: new Date(Date.now() - 120_000).toISOString() })
      .where(eq(storefrontEmailCodes.emailKey, address.toLowerCase()));
    const emailProofFor = async (address: string): Promise<string> => {
      await ageEmail(address);
      const buyer = site();
      const asked = await buyer.post('/api/storefront/v1/auth/email-code/request', { email: address });
      if (asked.status !== 200) throw new Error(`email code request: ${asked.status} ${JSON.stringify(asked.body)}`);
      const verified = await buyer.post('/api/storefront/v1/auth/email-code/verify', { email: address, code: codeOf() });
      if (verified.status !== 200) throw new Error(`email code verify: ${verified.status} ${JSON.stringify(verified.body)}`);
      return String(verified.body.data.emailProof);
    };
    const PASSWORD = `Pass-${tag}-word`;
    const order = (phone: string, requestKey: string, extra: Body = {}): Body => ({
      requestKey, recipientName: `خریدار ایمیلی ${tag}`, phone, province: 'تهران', city: 'تهران', address: 'خیابان آزمون، پلاک ۸',
      postalCode: '1234567890', note: '', shippingMethod: `sfo-${tag}`, lines: [{ slug: slugTen, quantity: 1 }], ...extra,
    });
    // the settings form as saved at the start, with another open-orders limit
    const settingsBody = (view: Body, openOrdersPerPhone: number): Body => ({
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: '', lowStockThreshold: 0, stockDisplay: 'count',
      warehouseCode: warehouse.code, whatsappNumber: '', whatsappEnabled: false, enabled: true, ordersEnabled: true, treasuryAccountId: bankId,
      openOrdersPerPhone, version: Number(view.version),
    });
    const orderRow = async (number: string) => (await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, number)))[0];
    const publicFlags = async () => {
      invalidateSettingsCache();
      const res = await site().get('/api/storefront/v1/settings');
      return `${res.body.data?.smsLogin}/${res.body.data?.emailLogin}`;
    };

    // 1) the texts off, the email on: a guest order needs an email proof
    await smsSwitch(false);
    if (await publicFlags() !== 'false/true') wrong.push(`the public flags with the texts off: ${await publicFlags()}`);
    const bare = await site().post('/api/storefront/v1/orders', order(phoneA, `rk-mail-a-${tag}`));
    if (bare.status !== 422 || bare.body.code !== 'STOREFRONT_EMAIL_PROOF_REQUIRED') wrong.push(`a guest order without a proof: ${bare.status} ${bare.body.code}`);

    // ... and a sign-up with a phone alone, which nobody could prove now, is asked for an email
    const phoneOnly = await site().post('/api/storefront/v1/auth/register', { name: `فقط شماره ${tag}`, phone: phoneB, password: PASSWORD });
    if (phoneOnly.status !== 422 || phoneOnly.body.details?.field !== 'email') wrong.push(`a phone-only sign-up with the texts off: ${phoneOnly.status} ${JSON.stringify(phoneOnly.body.details)}`);

    // 2) a customer already has the phone the stranger types: the order goes on a new customer by the email, not on it
    const [phoneOwner] = await orm.insert(customers).values({ name: `صاحب شماره ${tag}`, phone: phoneA, notes: 'ERP-TEST-MARKER' }).returning({ id: customers.id });
    customerIds.push(phoneOwner.id);
    const placed = await site().post('/api/storefront/v1/orders', order(phoneA, `rk-mail-b-${tag}`, { email: mailA, emailProof: await emailProofFor(mailA) }));
    if (placed.status !== 201) throw new Error(`an email-proven order: ${placed.status} ${JSON.stringify(placed.body)}`);
    const first = await orderRow(String(placed.body.data.order.number));
    customerIds.push(first.customerId);
    const [firstCustomer] = await orm.select().from(customers).where(eq(customers.id, first.customerId));
    if (first.customerId === phoneOwner.id) wrong.push('the email-proven order went on the customer with the typed phone');
    if (firstCustomer?.email?.toLowerCase() !== mailA.toLowerCase() || firstCustomer?.phone) wrong.push(`the new customer: email '${firstCustomer?.email}', phone '${firstCustomer?.phone}'`);
    if (first.emailKey !== mailA.toLowerCase() || first.phoneProven !== 0) wrong.push(`the order keeps email_key '${first.emailKey}', phone_proven ${first.phoneProven}`);
    if (placed.body.data.order.orderedBy?.email?.toLowerCase() !== mailA.toLowerCase()) wrong.push(`the order view's email: ${JSON.stringify(placed.body.data.order.orderedBy)}`);

    // 3) a second order with the same email (another typed phone) finds the same customer
    const again = await site().post('/api/storefront/v1/orders', order(phoneB, `rk-mail-c-${tag}`, { email: mailA, emailProof: await emailProofFor(mailA) }));
    const second = again.status === 201 ? await orderRow(String(again.body.data.order.number)) : null;
    if (!second || second.customerId !== first.customerId) wrong.push(`the same email's second order: ${again.status}, customer ${second?.customerId} not ${first.customerId}`);

    // 4) the open-orders limit counts by the email
    const limitRead = await erp.get('/api/storefront/settings');
    const limitSet = await erp.put('/api/storefront/settings', settingsBody(limitRead.body.data, 2));
    if (limitSet.status !== 200) throw new Error(`the open-orders limit: ${limitSet.status} ${JSON.stringify(limitSet.body)}`);
    invalidateSettingsCache();
    const third = await site().post('/api/storefront/v1/orders', order(phoneD, `rk-mail-d-${tag}`, { email: mailA, emailProof: await emailProofFor(mailA) }));
    if (third.status !== 409 || third.body.code !== 'STOREFRONT_TOO_MANY_OPEN_ORDERS') wrong.push(`a third open order of one email: ${third.status} ${third.body.code}`);
    const limitBack = await erp.get('/api/storefront/settings');
    await erp.put('/api/storefront/settings', settingsBody(limitBack.body.data, 20));
    invalidateSettingsCache();

    // 5) the texts on: an email-proven order still sends no text to its unproven phone
    await smsSwitch(true, { otp: '111', order_placed: '222' });
    const textsBefore = sms.bodies.length;
    const withTexts = await site().post('/api/storefront/v1/orders', order(phoneF, `rk-mail-e-${tag}`, { email: mailB, emailProof: await emailProofFor(mailB) }));
    if (withTexts.status !== 201) wrong.push(`an email-proven order with the texts on: ${withTexts.status} ${JSON.stringify(withTexts.body)}`);
    else {
      const row = await orderRow(String(withTexts.body.data.order.number));
      const queued = await orm.select({ id: storefrontSmsMessages.id }).from(storefrontSmsMessages).where(eq(storefrontSmsMessages.orderId, row.id));
      if (queued.length !== 0 || sms.bodies.length !== textsBefore) wrong.push(`${queued.length} texts queued for an email-proven order`);
      customerIds.push(row.customerId);
    }

    // 6) the order opens elsewhere with its email and a new email code; another email is the same 404
    const firstNumber = String(placed.body.data.order.number);
    const wrongMail = await site().post(`/api/storefront/v1/orders/${firstNumber}/access`, { email: mailB, emailProof: await emailProofFor(mailB) });
    const opened = await site().post(`/api/storefront/v1/orders/${firstNumber}/access`, { email: mailA, emailProof: await emailProofFor(mailA) });
    if (wrongMail.status !== 404) wrong.push(`another email on the order: ${wrongMail.status}`);
    if (opened.status !== 200 || opened.body.data?.accessKey !== placed.body.data.accessKey) wrong.push(`its own email: ${opened.status} ${JSON.stringify(opened.body)}`);

    // 7) «حالت بی پیامک» by the owner's switch: the site's flags turn to email and an SMS code is 503; off again, back
    const pause = async (loginPaused: boolean) => {
      const view = (await erp.get('/api/storefront/sms/settings')).body.data;
      const res = await erp.put('/api/storefront/sms/settings', {
        enabled: view.enabled, provider: view.provider, apiKey: '', clearApiKey: false, templates: view.templates, hourlyCap: view.hourlyCap,
        orderHourlyCap: view.orderHourlyCap, loginPaused, version: view.version,
      });
      if (res.status !== 200 || res.body.data?.loginPaused !== loginPaused) throw new Error(`pause ${loginPaused}: ${res.status} ${JSON.stringify(res.body)}`);
      smsVersion = Number(res.body.data.version);
    };
    await pause(true);
    const pausedFlags = await publicFlags();
    await ageCodes(phoneD);
    const pausedCode = await site().post('/api/storefront/v1/auth/otp/request', { phone: phoneD });
    if (pausedFlags !== 'false/true' || pausedCode.status !== 503 || pausedCode.body.code !== 'STOREFRONT_SMS_PAUSED') wrong.push(`paused by hand: flags ${pausedFlags}, a code ${pausedCode.status} ${pausedCode.body.code}`);
    await pause(false);
    if (await publicFlags() !== 'true/true') wrong.push(`unpaused: flags ${await publicFlags()}`);

    // 8) the latest login texts all failing pause the SMS sign-in the same way, and the owner's screen says so
    await orm.insert(storefrontSmsMessages).values(Array.from({ length: SMS_FAILURE_PAUSE_COUNT }, () => ({
      kind: 'otp', phone: phoneD, phoneKey: phoneMatchKey(phoneD), status: 'failed', error: 'test failure',
    })));
    const failingFlags = await publicFlags();
    const failingView = (await erp.get('/api/storefront/sms/settings')).body.data;
    if (failingFlags !== 'false/true' || failingView?.autoPaused !== true) wrong.push(`failing texts: flags ${failingFlags}, autoPaused ${failingView?.autoPaused}`);
    await orm.update(storefrontSmsMessages).set({ createdAt: new Date(Date.now() - (SMS_FAILURE_PAUSE_MINUTES + 1) * 60_000).toISOString() })
      .where(eq(storefrontSmsMessages.phoneKey, phoneMatchKey(phoneD)));
    if (await publicFlags() !== 'true/true') wrong.push(`after the failures aged out: flags ${await publicFlags()}`);

    // 9) a signed-in email-only account orders without a proof, with its own email
    const made = await site().post('/api/storefront/v1/auth/register', { name: `حساب ایمیلی ${tag}`, email: mailC, emailProof: await emailProofFor(mailC), password: PASSWORD });
    const session = String(made.body.data?.sessionToken ?? '');
    const accountOrder = await site(session).post('/api/storefront/v1/orders', order(phoneD, `rk-mail-f-${tag}`));
    if (made.status !== 201 || accountOrder.status !== 201) wrong.push(`an email-only account's order: ${made.status} ${accountOrder.status} ${JSON.stringify(accountOrder.body)}`);
    else {
      const row = await orderRow(String(accountOrder.body.data.order.number));
      customerIds.push(row.customerId);
      if (row.emailKey !== mailC.toLowerCase()) wrong.push(`the account's order email_key '${row.emailKey}'`);
    }

    if (savedEmailEnv === undefined) delete process.env[EMAIL_TEST_SMTP_ENV];
    else process.env[EMAIL_TEST_SMTP_ENV] = savedEmailEnv;
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'with the texts off a guest order without a proof was 422, a phone-only sign-up was asked for an email, and an order with an email proof was 201; it went on a new customer with the email and no phone, not on the customer with the typed phone, and kept the email; the same email found the same customer; a third open order of one email was 409; with the texts on such an order queued no text; it opened elsewhere with its email and a new code while another email was 404; the owner\'s «حالت بی پیامک» and failing login texts each turned the public flags to email and refused SMS codes, and both came back; an email-only account ordered without a proof',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
    if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
    await sms.close().catch(() => undefined);
    await mail.close().catch(() => undefined);
    if (emailKeys.length > 0) {
      await orm.delete(storefrontEmailCodes).where(inArray(storefrontEmailCodes.emailKey, emailKeys)).catch(() => undefined);
      const ids = (await orm.select({ id: storefrontBuyerAccounts.id }).from(storefrontBuyerAccounts).where(inArray(storefrontBuyerAccounts.emailKey, emailKeys))).map(r => r.id);
      if (ids.length > 0) {
        await orm.delete(storefrontBuyerSessions).where(inArray(storefrontBuyerSessions.accountId, ids)).catch(() => undefined);
        await orm.delete(storefrontBuyerAccounts).where(inArray(storefrontBuyerAccounts.id, ids)).catch(() => undefined);
      }
    }
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
