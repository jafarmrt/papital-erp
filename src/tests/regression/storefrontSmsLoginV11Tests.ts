import { createHash } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { and, asc, desc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, activityLogs, appSettings, bankAccounts, storefrontBuyerAccounts, storefrontBuyerSessions, storefrontPasswordTokens,
  storefrontSmsCodes, storefrontSmsMessages, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v11 phase 8.4b (docs/roadmap/V11_STOREFRONT_8_4B_SMS_LOGIN_START_PLAN.md): the SMS sign-in of buyer accounts on real
 * Express routes and PostgreSQL, against a fake SMS service on this machine. While the site signs in by SMS the settings
 * answer says so, a sign-up and an anonymous wholesale form need a phone proof and mark the phone proven, and a proof is
 * for its own phone only. An SMS sign-in without an account is 404 and leaves the proof for the sign-up; one for an
 * account nobody proved takes it (its password and sessions end, with an audit row); a pending request is 403; a wrong
 * proof is 422. With the texts off the route is 404 and sign-up needs no proof.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const SMS_KEY = 'TestSmsKey0123456789abcdefXYZ';
const PASSWORD = 'رمز-آزمون-1405';

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

export async function runStorefrontSmsLoginV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_sms_login_v11_8_4b';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'sms', 'buyers', 'accounts', 'security')) return results;

  const name = 'v11 phase 8.4b: SMS sign-in of buyer accounts: the settings flag, a phone proof for sign-up and the wholesale form, a proof for its own phone only, 404 without an account that keeps the proof, taking an account nobody proved, a pending request refused, and nothing changed with the texts off';
  const tStart = Date.now();
  const phoneKeys: string[] = [];
  let bankId: number | null = null;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  const savedBase = process.env.ERP_SMS_TEST_API_BASE;
  const sms = await fakeSmsServer();
  try {
    process.env.ERP_SMS_TEST_API_BASE = sms.base;
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const erp = {
      get: (url: string) => request(app).get(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken).send(body),
    };
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];
    const [phoneA, phoneB, phoneC, phoneD] = ['0911', '0912', '0913', '0914'].map(p => `${p}${tag}`);
    phoneKeys.push(...[phoneA, phoneB, phoneC, phoneD].map(p => p.slice(1)));

    // the shop: the site on and taking orders (accounts follow the orders switch)
    const retailList = `تکی ورود پیامکی ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFL-${tag}`, title: 'ERP-TEST-MARKER حساب ورود پیامکی سایت', type: 'bank', currency: 'IRR',
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
    const site = (ip: string, session = '') => ({
      get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session),
      post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session).send(body),
    });
    let smsVersion = Number((await erp.get('/api/storefront/sms/settings')).body.data?.version ?? 0);
    const smsSwitch = async (enabled: boolean) => {
      const res = await erp.put('/api/storefront/sms/settings', {
        enabled, provider: 'smsir', apiKey: smsVersion === 0 ? SMS_KEY : '', clearApiKey: false, templates: { otp: '111' }, hourlyCap: 200, version: smsVersion,
      });
      if (res.status !== 200) throw new Error(`sms settings: ${res.status} ${JSON.stringify(res.body)}`);
      smsVersion = Number(res.body.data.version);
    };
    let ipCount = 10;
    const proofFor = async (phone: string): Promise<string> => {
      const ip = `10.30.0.${ipCount++}`;
      const asked = await site(ip).post('/api/storefront/v1/auth/otp/request', { phone });
      if (asked.status !== 202) throw new Error(`otp request: ${asked.status} ${JSON.stringify(asked.body)}`);
      const code = String((JSON.parse(sms.bodies.at(-1) ?? '{}') as { parameters?: Array<{ value: string }> }).parameters?.[0]?.value ?? '');
      const verified = await site(ip).post('/api/storefront/v1/auth/otp/verify', { phone, code });
      if (verified.status !== 200) throw new Error(`otp verify: ${verified.status} ${JSON.stringify(verified.body)}`);
      return String(verified.body.data.phoneProof);
    };

    // 1) texts off: no SMS sign-in, and a sign-up needs no proof (the 8.2b behaviour); this account nobody proved
    await smsSwitch(false);
    let pub = await site('10.30.1.1').get('/api/storefront/v1/settings');
    if (pub.body.data?.smsLogin !== false) wrong.push(`smsLogin while off: ${pub.body.data?.smsLogin}`);
    const offLogin = await site('10.30.1.1').post('/api/storefront/v1/auth/sms-login', { phone: phoneC, phoneProof: 'pp_x' });
    if (offLogin.status !== 404) wrong.push(`sms sign-in while off: ${offLogin.status}`);
    const early = await site('10.30.1.1').post('/api/storefront/v1/auth/register', { name: 'خریدار پیش از پیامک', phone: phoneC, password: PASSWORD });
    const earlySession = String(early.body.data?.sessionToken ?? '');
    if (early.status !== 201 || early.body.data?.account?.phoneVerified !== false) wrong.push(`sign-up while off: ${early.status} ${JSON.stringify(early.body)}`);

    // 2) texts on: the settings say so; a sign-up without a proof is refused, with one it marks the phone proven
    await smsSwitch(true);
    pub = await site('10.30.1.2').get('/api/storefront/v1/settings');
    if (pub.body.data?.smsLogin !== true) wrong.push(`smsLogin while on: ${pub.body.data?.smsLogin}`);
    const noProof = await site('10.30.1.2').post('/api/storefront/v1/auth/register', { name: 'خریدار پیامکی', phone: phoneA, password: PASSWORD });
    if (noProof.status !== 422 || noProof.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`sign-up without a proof: ${noProof.status} ${noProof.body.code}`);
    const proofA = await proofFor(phoneA);
    const otherPhone = await site('10.30.1.2').post('/api/storefront/v1/auth/register', { name: 'خریدار دیگر', phone: phoneB, password: PASSWORD, phoneProof: proofA });
    if (otherPhone.status !== 422 || otherPhone.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`another phone's proof: ${otherPhone.status} ${otherPhone.body.code}`);
    const regA = await site('10.30.1.2').post('/api/storefront/v1/auth/register', { name: 'خریدار پیامکی', phone: phoneA, password: PASSWORD, phoneProof: proofA });
    if (regA.status !== 201 || regA.body.data?.account?.phoneVerified !== true) wrong.push(`sign-up with a proof: ${regA.status} ${JSON.stringify(regA.body)}`);
    // a made-up proof on a phone with an account is the same 422 as on one without: no answer tells which phones have accounts
    const probe = await site('10.30.1.3').post('/api/storefront/v1/auth/register', { name: 'کاوشگر', phone: phoneA, password: PASSWORD, phoneProof: 'pp_notaproof' });
    if (probe.status !== 422 || probe.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`a made-up proof on a phone with an account: ${probe.status} ${probe.body.code}`);
    const again = await site('10.30.1.3').post('/api/storefront/v1/auth/sms-login', { phone: phoneA, phoneProof: proofA });
    if (again.status !== 422) wrong.push(`a used proof: ${again.status} ${again.body.code}`);

    // 3) SMS sign-in without an account: 404, and the same proof still makes the account
    const proofB = await proofFor(phoneB);
    const none = await site('10.30.1.4').post('/api/storefront/v1/auth/sms-login', { phone: phoneB, phoneProof: proofB });
    if (none.status !== 404 || none.body.code !== 'STOREFRONT_ACCOUNT_NOT_FOUND') wrong.push(`sms sign-in without an account: ${none.status} ${none.body.code}`);
    const regB = await site('10.30.1.4').post('/api/storefront/v1/auth/register', { name: 'خریدار دوم', phone: phoneB, password: PASSWORD, phoneProof: proofB });
    if (regB.status !== 201) wrong.push(`the proof kept for the sign-up: ${regB.status} ${regB.body.code}`);
    const bogus = await site('10.30.1.4').post('/api/storefront/v1/auth/sms-login', { phone: phoneB, phoneProof: 'pp_notaproof' });
    if (bogus.status !== 422 || bogus.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`a wrong proof: ${bogus.status} ${bogus.body.code}`);

    // 4) the account nobody proved is taken by its SMS sign-in: the old password, session and set-password links end
    const [earlyAccount] = await orm.select({ id: storefrontBuyerAccounts.id }).from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneC.slice(1)));
    const [link] = await orm.insert(storefrontPasswordTokens).values({
      accountId: earlyAccount.id, tokenHash: createHash('sha256').update(`erp-test-sfl-${tag}`).digest('hex'), createdBy: 'ERP-TEST-MARKER', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }).returning({ id: storefrontPasswordTokens.id });
    const proofC = await proofFor(phoneC);
    const taken = await site('10.30.1.5').post('/api/storefront/v1/auth/sms-login', { phone: phoneC, phoneProof: proofC });
    if (taken.status !== 200 || !String(taken.body.data?.sessionToken ?? '').startsWith('bs_') || taken.body.data?.account?.phoneVerified !== true) {
      wrong.push(`taking the account: ${taken.status} ${JSON.stringify(taken.body)}`);
    }
    const oldSession = await site('10.30.1.5', earlySession).get('/api/storefront/v1/account');
    if (oldSession.status !== 401) wrong.push(`the old session after the take: ${oldSession.status}`);
    const oldPassword = await site('10.30.1.6').post('/api/storefront/v1/auth/login', { phone: phoneC, password: PASSWORD });
    if (oldPassword.status !== 401) wrong.push(`the old password after the take: ${oldPassword.status}`);
    const newSession = await site('10.30.1.5', String(taken.body.data?.sessionToken ?? '')).get('/api/storefront/v1/account');
    if (newSession.status !== 200 || newSession.body.data?.phone !== phoneC) wrong.push(`the new session: ${newSession.status}`);
    const [accountC] = await orm.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneC.slice(1)));
    const [audit] = await orm.select({ description: activityLogs.description }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'حساب خریدار سایت'), eq(activityLogs.entityId, String(accountC?.id ?? 0)))).orderBy(desc(activityLogs.id)).limit(1);
    const [linkAfter] = await orm.select({ usedAt: storefrontPasswordTokens.usedAt }).from(storefrontPasswordTokens).where(eq(storefrontPasswordTokens.id, link.id));
    if (!linkAfter?.usedAt) wrong.push('a set-password link still open after the take');
    if (!accountC?.phoneVerifiedAt || accountC.passwordHash !== '' || !audit?.description.includes('با پیامک تأیید شد')) wrong.push(`the taken account: ${JSON.stringify({ v: accountC?.phoneVerifiedAt, p: Boolean(accountC?.passwordHash), a: audit?.description })}`);

    // 5) the wholesale form without a session needs a proof; the request it makes is pending and cannot sign in yet
    const form = { name: 'خریدار عمدهٔ پیامکی', companyName: `گالری آزمون ${tag}`, city: 'تهران', phone: phoneD, nationalId: '', economicCode: '', note: '' };
    const formNoProof = await site('10.30.1.7').post('/api/storefront/v1/wholesale/apply', form);
    if (formNoProof.status !== 422 || formNoProof.body.code !== 'STOREFRONT_PHONE_PROOF_REQUIRED') wrong.push(`the form without a proof: ${formNoProof.status} ${formNoProof.body.code}`);
    const proofD = await proofFor(phoneD);
    const applied = await site('10.30.1.7').post('/api/storefront/v1/wholesale/apply', { ...form, phoneProof: proofD });
    if (applied.status !== 201 || applied.body.data?.phoneVerified !== true || applied.body.data?.application !== 'pending') wrong.push(`the form with a proof: ${applied.status} ${JSON.stringify(applied.body)}`);
    const proofD2 = await orm.update(storefrontSmsCodes).set({ createdAt: new Date(Date.now() - 120_000).toISOString() })
      .where(eq(storefrontSmsCodes.phoneKey, phoneD.slice(1))).then(() => proofFor(phoneD));
    const pending = await site('10.30.1.8').post('/api/storefront/v1/auth/sms-login', { phone: phoneD, phoneProof: proofD2 });
    if (pending.status !== 403 || pending.body.code !== 'STOREFRONT_ACCOUNT_PENDING') wrong.push(`a pending request signing in: ${pending.status} ${pending.body.code}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'texts off: smsLogin false, the SMS sign-in 404 and a sign-up without a proof made an unproven account; texts on: smsLogin true, a sign-up without a proof and with another phone\'s proof was 422, with its own proof it marked the phone proven, a made-up proof on that phone was 422 (not 409) and the used proof was refused; an SMS sign-in without an account was 404 and the same proof then made the account; a wrong proof was 422; the unproven account was taken by its SMS sign-in, its old session, password and set-password link stopped working and an audit row was written; the wholesale form needed a proof, made a proven pending request, and its SMS sign-in was 403',
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
      const ids = (await orm.select({ id: storefrontBuyerAccounts.id }).from(storefrontBuyerAccounts)
        .where(inArray(storefrontBuyerAccounts.phoneKey, phoneKeys)).catch(() => [])).map(r => r.id);
      if (ids.length > 0) {
        await orm.delete(storefrontBuyerSessions).where(inArray(storefrontBuyerSessions.accountId, ids)).catch(() => undefined);
        await orm.delete(storefrontPasswordTokens).where(inArray(storefrontPasswordTokens.accountId, ids)).catch(() => undefined);
        await orm.delete(storefrontBuyerAccounts).where(inArray(storefrontBuyerAccounts.id, ids)).catch(() => undefined);
      }
      await orm.delete(storefrontSmsCodes).where(inArray(storefrontSmsCodes.phoneKey, phoneKeys)).catch(() => undefined);
      await orm.delete(storefrontSmsMessages).where(inArray(storefrontSmsMessages.phoneKey, phoneKeys)).catch(() => undefined);
    }
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
