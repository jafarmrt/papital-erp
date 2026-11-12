import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, activityLogs, appSettings, bankAccounts, itemPrices, items, storefrontBuyerAccounts, storefrontBuyerSessions, storefrontEmailCodes, storefrontOrders,
  storefrontProducts, storefrontShippingMethods, storefrontSmsCodes, storefrontSmsMessages, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { EMAIL_TEST_SMTP_ENV } from '../../services/storefront/storefrontEmailClient.js';

/**
 * v12 phase 8e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, owner's decision 7): buyer accounts with an email, the
 * email code and its proof, the sign-in by email and a forgotten password by an SMS or an email code, on real Express
 * routes and PostgreSQL, against a fake SMS service and a fake mail server on this machine.
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

export async function runStorefrontEmailAccountsV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_email_accounts_v12_p8e';
  if (!shouldRun(id, 'v12', 'phase8', 'storefront', 'email', 'accounts', 'security')) return results;

  const name = 'v12 phase 8e: email codes stored as hashes with their limits and a single-use proof; email-only and two-way accounts; sign-in by email password and by email code; a forgotten password by email or SMS ends the old password and sessions; a proven phone and email added, another account\'s refused; no email in full in the audit; email off = 404';
  const emailKeys: string[] = [];
  const mail = await fakeMailServer();
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
    const [phoneA, phoneB, phoneD, phoneF] = ['0923', '0924', '0925', '0926'].map(p => `${p}${tag}`);
    phoneKeys.push(...[phoneA, phoneB, phoneD, phoneF].map(p => phoneMatchKey(p)));

    // the shop: a retail list, one item of two units and one of ten, a flat shipping method, the site on and ordering
    const retailList = `تکی ایمیل خریدار ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const two = await createTestItem({ name: `انگشتر ایمیل ${tag}`, code: `SFE-A-${tag}`, stocks: { '': 2 } });
    const ten = await createTestItem({ name: `دستبند ایمیل ${tag}`, code: `SFE-B-${tag}`, stocks: { '': 10 } });
    itemIds.push(two.id, ten.id);
    await orm.insert(itemPrices).values([
      { itemId: two.id, title: retailList, price: money(PRICE), currency: 'IRR' },
      { itemId: ten.id, title: retailList, price: money(PRICE), currency: 'IRR' },
    ]);
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFE-${tag}`, title: 'ERP-TEST-MARKER حساب ایمیل خریدار سایت', type: 'bank', currency: 'IRR',
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
      code: `sfe-${tag}`, title: 'پست آزمون ایمیل', description: '', pricing: 'flat', flatRate: '500000', isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slugTwo = `email-ring-${tag}`;
    const slugTen = `email-band-${tag}`;
    for (const [itemId, slug] of [[two.id, slugTwo], [ten.id, slugTen]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    let ipCount = 10;
    const site = (session = '') => {
      const ip = `10.54.0.${ipCount++}`;
      return {
        get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session),
        post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session).send(body),
      };
    };

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
    const savedEmailEnv = process.env[EMAIL_TEST_SMTP_ENV];
    process.env[EMAIL_TEST_SMTP_ENV] = `127.0.0.1:${mail.port}`;
    const emailView = (await erp.get('/api/storefront/email/settings')).body.data;
    const emailOn = await erp.put('/api/storefront/email/settings', {
      enabled: true, host: '127.0.0.1', port: mail.port, security: 'none', username: '', password: '', clearPassword: true,
      fromAddress: `shop.${tag}@papital-test.example`, fromName: 'پاپیتال', version: emailView.version,
    });
    if (emailOn.status !== 200 || emailOn.body.data?.ready !== true) throw new Error(`email settings: ${emailOn.status} ${JSON.stringify(emailOn.body)}`);
    const [mailA, mailB, mailC, mailD, mailE, mailF] = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => `Buyer.${x}.${tag}@Papital-Test.example`);
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

    // 1) a code by email: the mail carries the code and fixed words only; a second within the minute is 429; a wrong
    // code is 422 and counts; the right one gives a single-use proof
    const asked = await site().post('/api/storefront/v1/auth/email-code/request', { email: mailA });
    const firstMail = mail.received.at(-1);
    if (asked.status !== 200 || !firstMail || !firstMail.to.some(t => t.toLowerCase().includes(mailA.toLowerCase()))) wrong.push(`email code: ${asked.status} ${JSON.stringify(asked.body)}`);
    const text = firstMail ? decodeMail(firstMail.data) : '';
    if (!/کد تأیید شما: \d{6}/.test(text) || /ریال|تومان|خریدار ایمیل/.test(text)) wrong.push(`the mail text: ${text.slice(0, 200)}`);
    const again = await site().post('/api/storefront/v1/auth/email-code/request', { email: mailA });
    if (again.status !== 429) wrong.push(`a second code within the minute: ${again.status}`);
    const bad = await site().post('/api/storefront/v1/auth/email-code/verify', { email: mailA, code: '000000' === codeOf() ? '111111' : '000000' });
    if (bad.status !== 422 || bad.body.code !== 'STOREFRONT_EMAIL_CODE_INVALID') wrong.push(`a wrong code: ${bad.status} ${bad.body.code}`);
    const right = await site().post('/api/storefront/v1/auth/email-code/verify', { email: mailA.toLowerCase(), code: codeOf() });
    const proofA = String(right.body.data?.emailProof ?? '');
    if (right.status !== 200 || !proofA.startsWith('ep_')) wrong.push(`the right code: ${right.status} ${JSON.stringify(right.body)}`);
    const [stored] = await orm.select({ codeHash: storefrontEmailCodes.codeHash }).from(storefrontEmailCodes).where(eq(storefrontEmailCodes.emailKey, mailA.toLowerCase())).limit(1);
    if (!stored || stored.codeHash.includes(codeOf())) wrong.push('the code is stored in the clear');

    // 2) an email-only account: without the proof 422; with it 201 and signed in; the same email again is 409 and
    // leaves its proof good, which then signs in by email
    const noProof = await site().post('/api/storefront/v1/auth/register', { name: `خریدار ایمیل ${tag}`, email: mailA, password: PASSWORD });
    if (noProof.status !== 422 || noProof.body.code !== 'STOREFRONT_EMAIL_PROOF_REQUIRED') wrong.push(`an email without its proof: ${noProof.status} ${noProof.body.code}`);
    const made = await site().post('/api/storefront/v1/auth/register', { name: `خریدار ایمیل ${tag}`, email: mailA, password: PASSWORD, emailProof: proofA });
    const sessionA = String(made.body.data?.sessionToken ?? '');
    if (made.status !== 201 || made.body.data?.account?.email !== mailA.replace('Papital-Test', 'papital-test') || made.body.data?.account?.phone !== '' || made.body.data?.account?.emailVerified !== true) {
      wrong.push(`an email-only account: ${made.status} ${JSON.stringify(made.body)}`);
    }
    const proofTaken = await emailProofFor(mailA);
    const twice = await site().post('/api/storefront/v1/auth/register', { name: `دیگری ${tag}`, email: mailA.toUpperCase(), password: PASSWORD, emailProof: proofTaken });
    if (twice.status !== 409 || twice.body.code !== 'STOREFRONT_EMAIL_TAKEN') wrong.push(`the same email again: ${twice.status} ${twice.body.code}`);
    const byEmailCode = await site().post('/api/storefront/v1/auth/email-login', { email: mailA, emailProof: proofTaken });
    if (byEmailCode.status !== 200 || !byEmailCode.body.data?.sessionToken) wrong.push(`sign-in by email code with the proof the 409 left: ${byEmailCode.status}`);

    // 3) the password by email; a wrong password and an unknown email are the same 401
    const byPassword = await site().post('/api/storefront/v1/auth/login', { email: mailA.toLowerCase(), password: PASSWORD });
    if (byPassword.status !== 200) wrong.push(`sign-in by email and password: ${byPassword.status}`);
    const wrongPass = await site().post('/api/storefront/v1/auth/login', { email: mailA, password: 'not-the-password-1' });
    const unknown = await site().post('/api/storefront/v1/auth/login', { email: mailC, password: 'not-the-password-1' });
    if (wrongPass.status !== 401 || `${unknown.status} ${unknown.body.error}` !== `${wrongPass.status} ${wrongPass.body.error}`) wrong.push(`a wrong password ${wrongPass.status} and an unknown email ${unknown.status}`);

    // 4) an email with no account: the email sign-in is 404 and leaves the proof for the sign-up
    const proofB = await emailProofFor(mailB);
    const noAccount = await site().post('/api/storefront/v1/auth/email-login', { email: mailB, emailProof: proofB });
    if (noAccount.status !== 404) wrong.push(`an email sign-in with no account: ${noAccount.status}`);
    const madeB = await site().post('/api/storefront/v1/auth/register', { name: `خریدار ب ${tag}`, email: mailB, phone: phoneB, password: PASSWORD, emailProof: proofB, phoneProof: await proofFor(phoneB) });
    if (madeB.status !== 201 || madeB.body.data?.account?.phone !== phoneB || madeB.body.data?.account?.phoneVerified !== true) wrong.push(`an account with both: ${madeB.status} ${JSON.stringify(madeB.body)}`);
    const sessionB = String(madeB.body.data?.sessionToken ?? '');

    // 5) a forgotten password by email: the new one signs in, the old one and every old session stop
    const reset = await site().post('/api/storefront/v1/auth/reset-password', { email: mailA, emailProof: await emailProofFor(mailA), password: `${PASSWORD}-new` });
    if (reset.status !== 200 || !reset.body.data?.sessionToken) wrong.push(`reset by email: ${reset.status} ${JSON.stringify(reset.body)}`);
    const oldPass = await site().post('/api/storefront/v1/auth/login', { email: mailA, password: PASSWORD });
    const newPass = await site().post('/api/storefront/v1/auth/login', { email: mailA, password: `${PASSWORD}-new` });
    const oldSession = await site(sessionA).get('/api/storefront/v1/account');
    if (oldPass.status !== 401 || newPass.status !== 200 || oldSession.status !== 401) wrong.push(`after the reset: old password ${oldPass.status}, new ${newPass.status}, old session ${oldSession.status}`);
    const sessionA2 = String(newPass.body.data?.sessionToken ?? '');

    // 6) a forgotten password by SMS for an account with a phone
    await ageCodes(phoneB);
    const resetSms = await site().post('/api/storefront/v1/auth/reset-password', { phone: phoneB, phoneProof: await proofFor(phoneB), password: `${PASSWORD}-sms` });
    if (resetSms.status !== 200) wrong.push(`reset by SMS: ${resetSms.status} ${JSON.stringify(resetSms.body)}`);
    const smsPass = await site().post('/api/storefront/v1/auth/login', { phone: phoneB, password: `${PASSWORD}-sms` });
    if (smsPass.status !== 200) wrong.push(`the password set by SMS: ${smsPass.status}`);
    const sessionB2 = String(smsPass.body.data?.sessionToken ?? '');
    if ((await site(sessionB).get('/api/storefront/v1/account')).status !== 401) wrong.push('a session before the SMS reset still works');

    // 7) an email-only account asks for wholesale only once it has a phone; a phone or email held by another account
    // is 409; a proven phone and email are added
    const noPhone = await site(sessionA2).post('/api/storefront/v1/wholesale/apply', {
      name: `خریدار ایمیل ${tag}`, companyName: 'گالری آزمون', city: 'تهران', phone: phoneA, nationalId: '', economicCode: '', note: '',
    });
    if (noPhone.status !== 422 || noPhone.body.code !== 'STOREFRONT_ACCOUNT_PHONE_NEEDED') wrong.push(`wholesale without a phone: ${noPhone.status} ${noPhone.body.code}`);
    await ageCodes(phoneB);
    const heldPhone = await site(sessionA2).post('/api/storefront/v1/account/phone', { phone: phoneB, phoneProof: await proofFor(phoneB) });
    if (heldPhone.status !== 409) wrong.push(`another account's phone: ${heldPhone.status}`);
    await ageCodes(phoneA);
    const addPhone = await site(sessionA2).post('/api/storefront/v1/account/phone', { phone: phoneA, phoneProof: await proofFor(phoneA) });
    if (addPhone.status !== 200 || addPhone.body.data?.phone !== phoneA || addPhone.body.data?.phoneVerified !== true) wrong.push(`a phone added: ${addPhone.status} ${JSON.stringify(addPhone.body)}`);
    const heldEmail = await site(sessionB2).post('/api/storefront/v1/account/email', { email: mailA, emailProof: await emailProofFor(mailA) });
    if (heldEmail.status !== 409 || heldEmail.body.code !== 'STOREFRONT_EMAIL_TAKEN') wrong.push(`another account's email: ${heldEmail.status} ${heldEmail.body.code}`);
    // account B has mailB since its sign-up: replacing it takes the password (7b checks the refusals)
    const addEmail = await site(sessionB2).post('/api/storefront/v1/account/email', { email: mailC, emailProof: await emailProofFor(mailC), password: `${PASSWORD}-sms` });
    if (addEmail.status !== 200 || addEmail.body.data?.email?.toLowerCase() !== mailC.toLowerCase()) wrong.push(`an email added: ${addEmail.status} ${JSON.stringify(addEmail.body)}`);

    // 7b) review: replacing an email the account has needs its password and ends the other sessions (a first one did not)
    const otherB = String((await site().post('/api/storefront/v1/auth/login', { phone: phoneB, password: `${PASSWORD}-sms` })).body.data?.sessionToken ?? '');
    const noPassword = await site(sessionB2).post('/api/storefront/v1/account/email', { email: mailD, emailProof: await emailProofFor(mailD) });
    const badPassword = await site(sessionB2).post('/api/storefront/v1/account/email', { email: mailD, emailProof: await emailProofFor(mailD), password: 'not-the-password' });
    if (noPassword.status !== 422 || badPassword.status !== 422) wrong.push(`replacing an email without the password: ${noPassword.status}, with a wrong one: ${badPassword.status}`);
    const replaced = await site(sessionB2).post('/api/storefront/v1/account/email', { email: mailD, emailProof: await emailProofFor(mailD), password: `${PASSWORD}-sms` });
    if (replaced.status !== 200 || replaced.body.data?.email?.toLowerCase() !== mailD.toLowerCase()) wrong.push(`replacing with the password: ${replaced.status} ${JSON.stringify(replaced.body)}`);
    const keptB = await site(sessionB2).get('/api/storefront/v1/account');
    const endedB = await site(otherB).get('/api/storefront/v1/account');
    if (keptB.status !== 200 || endedB.status !== 401) wrong.push(`after replacing: this session ${keptB.status}, the other ${endedB.status}`);

    // 7c) review: a squatter makes an account with someone's phone (texts off, nobody proves it) and their own email;
    // the phone's owner signs in by SMS and takes it over: the email goes with the password, and the squatter's email
    // signs in nowhere
    const squat = async (phone: string, address: string): Promise<void> => {
      await smsSwitch(false);
      const made = await site().post('/api/storefront/v1/auth/register', { name: `ساکن ${tag}`, phone, email: address, emailProof: await emailProofFor(address), password: PASSWORD });
      await smsSwitch(true);
      if (made.status !== 201) throw new Error(`squat ${phone}: ${made.status} ${JSON.stringify(made.body)}`);
    };
    await squat(phoneD, mailE);
    await ageCodes(phoneD);
    const owner = await site().post('/api/storefront/v1/auth/sms-login', { phone: phoneD, phoneProof: await proofFor(phoneD) });
    const ownerView = await site(String(owner.body.data?.sessionToken ?? '')).get('/api/storefront/v1/account');
    if (owner.status !== 200 || ownerView.body.data?.email !== '') wrong.push(`the SMS takeover: ${owner.status}, email after it '${ownerView.body.data?.email}'`);
    const squatterIn = await site().post('/api/storefront/v1/auth/email-login', { email: mailE, emailProof: await emailProofFor(mailE) });
    if (squatterIn.status !== 404) wrong.push(`the squatter's email after the SMS takeover: ${squatterIn.status}`);

    // 7d) review: the same through a forgotten password by SMS
    await squat(phoneF, mailF);
    await ageCodes(phoneF);
    const ownerReset = await site().post('/api/storefront/v1/auth/reset-password', { phone: phoneF, phoneProof: await proofFor(phoneF), password: `${PASSWORD}-own` });
    if (ownerReset.status !== 200) wrong.push(`the owner's SMS reset: ${ownerReset.status} ${JSON.stringify(ownerReset.body)}`);
    const squatterReset = await site().post('/api/storefront/v1/auth/reset-password', { email: mailF, emailProof: await emailProofFor(mailF), password: `${PASSWORD}-steal` });
    if (squatterReset.status !== 404) wrong.push(`the squatter's email reset after the SMS reset: ${squatterReset.status}`);

    // 8) the audit rows name no email in full
    const logs = await orm.select({ description: activityLogs.description, details: activityLogs.details }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'حساب خریدار سایت'), sql`${activityLogs.timestamp} > now() - interval '10 minutes'`));
    if (logs.some(l => [mailA, mailB, mailC, mailD, mailE, mailF].some(m => `${l.description} ${JSON.stringify(l.details)}`.toLowerCase().includes(m.toLowerCase())))) wrong.push('an audit row names an email in full');

    // 9) with the email off, the email routes are 404
    const offView = (await erp.get('/api/storefront/email/settings')).body.data;
    await erp.put('/api/storefront/email/settings', { ...offView, enabled: false, password: '', clearPassword: false, ready: undefined, secretsKeyConfigured: undefined, version: offView.version });
    const off = await site().post('/api/storefront/v1/auth/email-code/request', { email: mailC });
    if (off.status !== 404) wrong.push(`an email code with the email off: ${off.status}`);
    if (savedEmailEnv === undefined) delete process.env[EMAIL_TEST_SMTP_ENV];
    else process.env[EMAIL_TEST_SMTP_ENV] = savedEmailEnv;

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'an email code came with the code and fixed words only and was stored as a hash; a second within the minute was 429; a wrong code 422; the right one gave a single-use proof; an email without its proof was 422; an email-only account was made and signed in; the same email in other letters was 409 and left its proof, which signed in by email; the password signed in by email and a wrong password and an unknown email were the same 401; an email sign-in with no account was 404 and left the proof for the sign-up; a forgotten password by email and by SMS set a new one and ended the old password and sessions; an email-only account was refused wholesale until it had a phone; another account\'s phone and email were 409; a proven phone and email were added; replacing an email needed the password of the account and ended its other sessions; an email a squatter added to an unproven phone went with the SMS sign-in of the phone owner and SMS reset, after which it signed in and reset nowhere; no audit row named an email in full; with the email off its routes were 404',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
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
