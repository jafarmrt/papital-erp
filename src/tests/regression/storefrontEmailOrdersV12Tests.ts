import { createHash } from 'crypto';
import request from 'supertest';
import { and, asc, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { decodeMail, fakeMailServer, fakeSmsServer } from './storefrontEmailTestServers.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, appSettings, bankAccounts, customers, itemPrices, notifications, items, storefrontBuyerAccounts, storefrontBuyerSessions, storefrontEmailCodes, storefrontOrders,
  storefrontProducts, storefrontShippingMethods, storefrontSmsCodes, storefrontSmsMessages, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { SMS_FAILURE_PAUSE_COUNT, SMS_FAILURE_PAUSE_MINUTES, SMS_FAILURE_PAUSE_VISITORS } from '../../lib/storefront/storefrontSmsRules.js';
import { warnIfSmsLoginPaused } from '../../services/storefront/storefrontSmsBudget.js';
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

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const SMS_KEY = 'TestSmsKey0123456789abcdefXYZ';
const PRICE = '9000000';

export async function runStorefrontEmailOrdersV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_email_orders_v12_p8e';
  if (!shouldRun(id, 'v12', 'phase8', 'storefront', 'email', 'orders', 'security')) return results;

  const name = 'v12 phase 8e: a guest order proven by an email code goes on the customer with that email (never one found by the unproven phone), counts its open orders by the email, sends no text, and opens elsewhere with the email and a new code; the no-SMS mode, by the owner or by failing login texts, turns the site to email; an email-only account orders without a proof';
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
    const failTexts = async (visitors: number) => {
      const rows = await orm.insert(storefrontSmsMessages).values(Array.from({ length: SMS_FAILURE_PAUSE_COUNT }, () => ({
        kind: 'otp', phone: phoneD, phoneKey: phoneMatchKey(phoneD), status: 'failed', error: 'test failure',
      }))).returning({ id: storefrontSmsMessages.id });
      await orm.insert(storefrontSmsCodes).values(rows.map((r, i) => ({
        phoneKey: phoneMatchKey(phoneD), codeHash: createHash('sha256').update(`code-${tag}-${r.id}`).digest('hex'),
        addressKey: createHash('sha256').update(`visitor-${tag}-${i % visitors}`).digest('hex'), messageId: r.id,
        expiresAt: new Date().toISOString(),
      })));
    };
    const ageFailures = () => orm.update(storefrontSmsMessages).set({ createdAt: new Date(Date.now() - (SMS_FAILURE_PAUSE_MINUTES + 1) * 60_000).toISOString() })
      .where(eq(storefrontSmsMessages.phoneKey, phoneMatchKey(phoneD)));
    // review: one visitor's failures (a script asking codes for numbers that get no text) pause nothing
    await failTexts(1);
    if (await publicFlags() !== 'true/true') wrong.push(`one visitor's failed texts paused the SMS: ${await publicFlags()}`);
    await ageFailures();
    await failTexts(SMS_FAILURE_PAUSE_VISITORS);
    const failingFlags = await publicFlags();
    // review: the colleagues hear of it with one bell
    const bellsNow = async () => (await orm.select({ id: notifications.id }).from(notifications)
      .where(and(eq(notifications.title, 'پیامک‌های ورود سایت فرستاده نمی‌شوند'), gt(notifications.createdAt, sql`now() - interval '5 minutes'`)))).length;
    await warnIfSmsLoginPaused();
    const firstBells = await bellsNow();
    await warnIfSmsLoginPaused();
    if (firstBells === 0 || await bellsNow() !== firstBells) wrong.push(`bells for the paused SMS sign-in: ${firstBells}, then ${await bellsNow()}`);
    const failingView = (await erp.get('/api/storefront/sms/settings')).body.data;
    if (failingFlags !== 'false/true' || failingView?.autoPaused !== true) wrong.push(`failing texts: flags ${failingFlags}, autoPaused ${failingView?.autoPaused}`);
    await ageFailures();
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

    // 10) review: an email-proven order typed with someone's phone does not count against that phone's open orders
    const limitAgain = await erp.get('/api/storefront/settings');
    await erp.put('/api/storefront/settings', settingsBody(limitAgain.body.data, 1));
    invalidateSettingsCache();
    await smsSwitch(false, { otp: '111', order_placed: '222' });
    const phoneVictim = `0935${tag}`;
    phoneKeys.push(phoneMatchKey(phoneVictim));
    const stranger = await site().post('/api/storefront/v1/orders', order(phoneVictim, `rk-mail-g-${tag}`, { email: mailD, emailProof: await emailProofFor(mailD) }));
    // a plus alias of the same mailbox is the same mailbox for the limit
    const alias = mailD.replace('@', '+x@');
    emailKeys.push(alias.toLowerCase());
    const aliased = await site().post('/api/storefront/v1/orders', order(phoneVictim, `rk-mail-h-${tag}`, { email: alias, emailProof: await emailProofFor(alias) }));
    await smsSwitch(true, { otp: '111', order_placed: '222' });
    await ageCodes(phoneVictim);
    const victimOwn = await site().post('/api/storefront/v1/orders', order(phoneVictim, `rk-mail-i-${tag}`, { phoneProof: await proofFor(phoneVictim) }));
    if (stranger.status !== 201 || aliased.status !== 409 || victimOwn.status !== 201) {
      wrong.push(`the limits: a stranger's email order ${stranger.status}, its plus alias ${aliased.status}, the phone owner's own ${victimOwn.status}`);
    }
    for (const placedRes of [stranger, victimOwn]) if (placedRes.status === 201) customerIds.push((await orderRow(String(placedRes.body.data.order.number))).customerId);

    // 11) review: the texts set up but paused, the email off: a guest order and a phone-only sign-up wait for a proof
    await pause(true);
    const emailOff = (await erp.get('/api/storefront/email/settings')).body.data;
    await erp.put('/api/storefront/email/settings', { ...emailOff, enabled: false, password: '', clearPassword: false, ready: undefined, secretsKeyConfigured: undefined, version: emailOff.version });
    invalidateSettingsCache();
    // delta review: with the email off, failing texts pause nothing (the pause would only stop buyers)
    await pause(false);
    await failTexts(SMS_FAILURE_PAUSE_VISITORS);
    if (await publicFlags() !== 'true/false') wrong.push(`failing texts with the email off: flags ${await publicFlags()}`);
    await ageFailures();
    await pause(true);
    const lockedOrder = await site().post('/api/storefront/v1/orders', order(phoneVictim, `rk-mail-j-${tag}`));
    const lockedSignUp = await site().post('/api/storefront/v1/auth/register', { name: `در مکث ${tag}`, phone: `0936${tag}`, password: PASSWORD });
    phoneKeys.push(phoneMatchKey(`0936${tag}`));
    if (await publicFlags() !== 'false/false' || lockedOrder.status !== 422 || lockedSignUp.status !== 422) {
      wrong.push(`paused with the email off: flags ${await publicFlags()}, a guest order ${lockedOrder.status} ${lockedOrder.body.code}, a phone-only sign-up ${lockedSignUp.status}`);
    }
    const emailBack = (await erp.get('/api/storefront/email/settings')).body.data;
    await erp.put('/api/storefront/email/settings', { ...emailBack, enabled: true, password: '', clearPassword: false, ready: undefined, secretsKeyConfigured: undefined, version: emailBack.version });
    invalidateSettingsCache();

    // 12) review: an account made in the pause with someone's phone beside its own proven email orders by the email:
    // not on the phone's customer, and no text to that phone, also once the texts are back
    const squatPhone = `0937${tag}`;
    phoneKeys.push(phoneMatchKey(squatPhone));
    const [squatOwner] = await orm.insert(customers).values({ name: `صاحب شماره دوم ${tag}`, phone: squatPhone, notes: 'ERP-TEST-MARKER' }).returning({ id: customers.id });
    customerIds.push(squatOwner.id);
    const squatter = await site().post('/api/storefront/v1/auth/register', { name: `ساکن ${tag}`, phone: squatPhone, email: mailF, emailProof: await emailProofFor(mailF), password: PASSWORD });
    await pause(false);
    const squatSession = String(squatter.body.data?.sessionToken ?? '');
    const squatOrder = await site(squatSession).post('/api/storefront/v1/orders', order(squatPhone, `rk-mail-k-${tag}`));
    if (squatter.status !== 201 || squatOrder.status !== 201) wrong.push(`the squatter's account and order: ${squatter.status} ${squatOrder.status} ${JSON.stringify(squatOrder.body)}`);
    else {
      const row = await orderRow(String(squatOrder.body.data.order.number));
      customerIds.push(row.customerId);
      const texts = await orm.select({ id: storefrontSmsMessages.id }).from(storefrontSmsMessages).where(eq(storefrontSmsMessages.orderId, row.id));
      if (row.customerId === squatOwner.id || row.emailKey !== mailF.toLowerCase() || texts.length !== 0) {
        wrong.push(`the squatter's order: customer ${row.customerId === squatOwner.id ? 'the phone owner' : 'by email'}, email_key '${row.emailKey}', ${texts.length} texts`);
      }
    }
    await erp.put('/api/storefront/settings', settingsBody((await erp.get('/api/storefront/settings')).body.data, 20));
    invalidateSettingsCache();

    if (savedEmailEnv === undefined) delete process.env[EMAIL_TEST_SMTP_ENV];
    else process.env[EMAIL_TEST_SMTP_ENV] = savedEmailEnv;
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'with the texts off a guest order without a proof was 422, a phone-only sign-up was asked for an email, and an order with an email proof was 201; it went on a new customer with the email and no phone, not on the customer with the typed phone, and kept the email; the same email found the same customer; a third open order of one email was 409; with the texts on such an order queued no text; it opened elsewhere with its email and a new code while another email was 404; the no-SMS mode by the owner and by failing login texts each turned the public flags to email and refused SMS codes, and both came back; an email-only account ordered without a proof; one visitor\'s failed texts paused nothing and several rang one bell; an email-proven order typed with a phone did not use that phone\'s limit while a plus alias of its mailbox did; paused with the email off a guest order and a phone-only sign-up waited for a proof; an account with someone\'s phone beside its proven email ordered by the email with no text',
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
