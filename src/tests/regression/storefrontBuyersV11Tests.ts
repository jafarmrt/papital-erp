import request from 'supertest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, appSettings, bankAccounts, customers, itemPrices, items, notifications, storefrontBuyerAccounts, storefrontBuyerGroups,
  storefrontBuyerSessions, storefrontPasswordTokens, storefrontProducts,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';

/**
 * v11 phase 8.2b (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6 and §8): buyer groups and buyer accounts of the new
 * site, on real Express routes and PostgreSQL. Accounts follow the orders switch. A retail buyer makes an account and is
 * signed in; the same phone cannot make a second one; a wrong phone and a wrong password are the same 401, and five wrong
 * passwords lock the account. The wholesale form makes a request without a password, and a phone with an account must
 * sign in first. A group's price list needs `products.edit_price` and cannot be the retail list. Approving makes the
 * customer, clears any password and ends the sessions, and answers a one-time set-password link; only an approved
 * account's session sees its group's prices, and only for the products the group may see. Suspending ends the sessions.
 * Each answer's exact fields are checked.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const RETAIL = '12500000';
const GROUP_PRICE = '9000000';
const PASSWORD = 'رمز-آزمون-1405';

const keysOf = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');
const ACCOUNT_KEYS = 'application,city,companyName,group,kind,name,phone,phoneVerified';
const SESSION_KEYS = 'account,expiresAt,sessionToken';

export async function runStorefrontBuyersV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_buyers_v11_8_2b';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'buyers', 'accounts', 'security')) return results;

  const name = 'v11 phase 8.2b: buyer accounts behind the orders switch, sign-up, sign-in lock, the wholesale form, buyer groups with the price key, approval with a one-time set-password link, group prices only for an approved session, and suspension';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const phoneKeys: string[] = [];
  const groupCodes: string[] = [];
  let bankId: number | null = null;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      delete: (url: string) => request(app).delete(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
    });
    const erp = as(await getAdminSession());
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];

    // the setup: a retail and a group list, two published items in two collections, a bank account for the orders switch
    const retailList = `تکی حساب ${tag}`;
    const groupList = `عمده حساب ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = [...('titles' in current ? current.titles : []), retailList, groupList];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify(strategies) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(strategies) } });
    invalidateSettingsCache();
    const colA = `کالکشن آ ${tag}`;
    const inScope = await createTestItem({ name: `دستبند حساب ${tag}`, code: `SFB-A-${tag}`, collections: [colA], stocks: { '': 3 } });
    const outOfScope = await createTestItem({ name: `گوشواره حساب ${tag}`, code: `SFB-B-${tag}`, collections: [`کالکشن ب ${tag}`], stocks: { '': 3 } });
    itemIds.push(inScope.id, outOfScope.id);
    await orm.insert(itemPrices).values([inScope.id, outOfScope.id].flatMap(itemId => [
      { itemId, title: retailList, price: money(RETAIL), currency: 'IRR' },
      { itemId, title: groupList, price: money(GROUP_PRICE), currency: 'IRR' },
    ]));
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFB-${tag}`, title: 'ERP-TEST-MARKER حساب دریافت سایت', type: 'bank', currency: 'IRR',
      accountId: ledger?.id ?? null, initialBalance: money(0), currentBalance: money(0),
    }).returning({ id: bankAccounts.id });
    bankId = bank.id;

    const read = await erp.get('/api/storefront/settings');
    if (read.status !== 200) throw new Error(`GET settings: ${read.status}`);
    let version = Number(read.body.data.version);
    const settings = {
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: '', lowStockThreshold: 0, stockDisplay: 'status',
      warehouseCode: '', whatsappNumber: '', whatsappEnabled: false, enabled: true, ordersEnabled: false, treasuryAccountId: bank.id, openOrdersPerPhone: 3,
    };
    const save = async (patch: Body) => {
      const res = await erp.put('/api/storefront/settings', { ...settings, ...patch, version });
      if (res.status !== 200) throw new Error(`save settings: ${res.status} ${JSON.stringify(res.body)}`);
      version = Number(res.body.data.version);
    };
    await save({});
    const made = await erp.post('/api/storefront/api-key');
    if (made.status !== 201) throw new Error(`POST api-key: ${made.status}`);
    const apiKey = String(made.body.data?.apiKey ?? '');
    const site = {
      get: (url: string, session = '') => request(app).get(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`).set('X-Buyer-Session', session),
      post: (url: string, body: Body, session = '') => request(app).post(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`)
        .set('X-Buyer-Session', session).set('X-Storefront-Client-IP', `10.${Number(tag.slice(0, 2))}.${Number(tag.slice(2, 4))}.${Math.floor(Math.random() * 250) + 1}`).send(body),
    };
    for (const [itemId, slug] of [[inScope.id, `bracelet-${tag}`], [outOfScope.id, `earring-${tag}`]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    const phone1 = `0912${tag}`;
    const phone2 = `0913${tag}`;
    const phone3 = `0914${tag}`;
    phoneKeys.push(...[phone1, phone2, phone3].map(phoneMatchKey));

    // 1) accounts follow the orders switch
    const off = await site.post('/auth/register', { name: 'خریدار آزمون', phone: phone1, password: PASSWORD });
    if (off.status !== 404) wrong.push(`register while ordering is off: ${off.status}, not 404`);
    await save({ ordersEnabled: true });

    // 2) a retail account: signed in at once, exact fields; the same phone again is 409; a weak password names its field
    const weak = await site.post('/auth/register', { name: 'خریدار آزمون', phone: phone1, password: '1234' });
    if (weak.status !== 422 || weak.body.details?.field !== 'password') wrong.push(`a weak password: ${weak.status} ${JSON.stringify(weak.body)}`);
    const reg = await site.post('/auth/register', { name: `خریدار تکی ${tag}`, phone: phone1, password: PASSWORD });
    const retailSession = String(reg.body.data?.sessionToken ?? '');
    if (reg.status !== 201 || !retailSession.startsWith('bs_') || keysOf(reg.body.data) !== SESSION_KEYS || keysOf(reg.body.data.account) !== ACCOUNT_KEYS
      || reg.body.data.account.kind !== 'retail' || reg.body.data.account.group !== null) wrong.push(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const again = await site.post('/auth/register', { name: 'دیگری', phone: phone1, password: PASSWORD });
    if (again.status !== 409 || again.body.code !== 'STOREFRONT_ACCOUNT_EXISTS') wrong.push(`the same phone again: ${again.status}`);
    const stored = await orm.select({ hash: storefrontBuyerAccounts.passwordHash }).from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneMatchKey(phone1)));
    if (!stored[0]?.hash.startsWith('scrypt$') || stored[0].hash.includes(PASSWORD)) wrong.push('the password is not kept as a scrypt hash');

    // 3) the session reads its own account; without one 401; a retail account has no group prices
    const me = await site.get('/account', retailSession);
    if (me.status !== 200 || keysOf(me.body.data) !== ACCOUNT_KEYS) wrong.push(`GET account: ${me.status} ${JSON.stringify(me.body)}`);
    if ((await site.get('/account')).status !== 401) wrong.push('GET account without a session is not 401');
    if ((await site.get('/account', 'bs_madeup')).status !== 401) wrong.push('GET account with a made-up session is not 401');
    if ((await site.get('/account/prices', retailSession)).status !== 403) wrong.push('a retail account read group prices');

    // 4) sign-in: an unknown phone and a wrong password are the same 401; five wrong passwords lock the account
    const unknown = await site.post('/auth/login', { phone: `0915${tag}`, password: PASSWORD });
    const badPassword = await site.post('/auth/login', { phone: phone1, password: 'نادرست-نادرست' });
    if (unknown.status !== 401 || badPassword.status !== 401 || unknown.body.code !== badPassword.body.code) {
      wrong.push(`unknown phone ${unknown.status}/${unknown.body.code} vs wrong password ${badPassword.status}/${badPassword.body.code}`);
    }
    const good = await site.post('/auth/login', { phone: phone1.replace(/^0/, '+98'), password: PASSWORD });
    if (good.status !== 200 || keysOf(good.body.data) !== SESSION_KEYS) wrong.push(`sign-in with +98: ${good.status} ${JSON.stringify(good.body)}`);
    const reg2 = await site.post('/auth/register', { name: `خریدار قفل ${tag}`, phone: phone2, password: PASSWORD });
    if (reg2.status !== 201) wrong.push(`register 2: ${reg2.status}`);
    for (let i = 0; i < 5; i++) await site.post('/auth/login', { phone: phone2, password: `wrong-${i}-password` });
    const locked = await site.post('/auth/login', { phone: phone2, password: PASSWORD });
    if (locked.status !== 429 || locked.body.code !== 'STOREFRONT_SIGN_IN_LOCKED') wrong.push(`after five wrong passwords: ${locked.status} ${locked.body.code}`);

    // 5) the wholesale form: a new phone makes a request without a password; a phone with an account must sign in
    const form = (phone: string): Body => ({
      name: `خریدار عمده ${tag}`, companyName: `فروشگاه آزمون ${tag}`, city: 'اصفهان', phone, nationalId: '۱۰۱۰۰۵۴۳۲۱۰', economicCode: '', note: 'آزمون',
    });
    const applied = await site.post('/wholesale/apply', form(phone3));
    if (applied.status !== 201 || keysOf(applied.body.data) !== ACCOUNT_KEYS || applied.body.data.application !== 'pending') {
      wrong.push(`wholesale form: ${applied.status} ${JSON.stringify(applied.body)}`);
    }
    const onTaken = await site.post('/wholesale/apply', form(phone1));
    if (onTaken.status !== 409 || onTaken.body.code !== 'STOREFRONT_ACCOUNT_EXISTS') wrong.push(`the form on a phone with an account: ${onTaken.status}`);
    if ((await site.post('/auth/login', { phone: phone3, password: PASSWORD })).status !== 401) wrong.push('a request without a password signed in');
    const [pending] = await orm.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneMatchKey(phone3)));
    if (pending?.status !== 'pending' || pending.nationalId !== '10100543210') wrong.push(`the stored request: ${JSON.stringify(pending)}`);
    const bell = await orm.select({ id: notifications.id }).from(notifications).where(eq(notifications.link, `/site-buyers?id=${pending?.id}`));
    if (bell.length === 0) wrong.push('no bell notice for the wholesale request');

    // 6) buyer groups: the retail list is refused; choosing a price list needs products.edit_price
    const groupCode = `wholesale-${tag}`;
    groupCodes.push(groupCode, `nokey-${tag}`);
    const groupBody = (patch: Body = {}): Body => ({
      code: groupCode, title: `عمده آزمون ${tag}`, description: '', priceList: groupList, minOrderAmount: '50000000', minLineQuantity: 2,
      allowCard: true, allowOnAccount: false, creditLimit: '0', catalogScope: 'collections', collections: [colA], acceptsDiscounts: false,
      isActive: true, sortOrder: 5, ...patch,
    });
    const retailAsGroup = await erp.post('/api/storefront/buyer-groups', groupBody({ priceList: retailList }));
    if (retailAsGroup.status !== 422) wrong.push(`the retail list as a group's list: ${retailAsGroup.status}`);
    const role = await createTestRole({ permissions: ['storefront.view', 'storefront.manage'] });
    const noPriceKey = as(await loginTestUserWithSession(app, (await createTestUser({ role: role.code })).username));
    const forbidden = await noPriceKey.post('/api/storefront/buyer-groups', groupBody({ code: `nokey-${tag}` }));
    if (forbidden.status !== 403) wrong.push(`a group's price list without products.edit_price: ${forbidden.status}`);
    const group = await erp.post('/api/storefront/buyer-groups', groupBody());
    if (group.status !== 201) throw new Error(`create group: ${group.status} ${JSON.stringify(group.body)}`);
    const groupId = Number(group.body.data.id);

    // 7) approve: a customer is made, any password cleared, sessions ended, and a one-time link answered
    const listed = await erp.get(`/api/storefront/buyers?filter=pending&q=${phone3}`);
    if (listed.status !== 200 || !(listed.body.data ?? []).some((r: Body) => r.id === pending.id)) wrong.push(`the pending list: ${listed.status}`);
    const approved = await erp.post(`/api/storefront/buyers/${pending.id}/approve`, { groupId, customerId: 0, version: pending.version });
    const link = String(approved.body.data?.token ?? '');
    if (approved.status !== 200 || !link.startsWith('pw_') || approved.body.data.account.applicationStatus !== 'approved' || !approved.body.data.account.customerId) {
      throw new Error(`approve: ${approved.status} ${JSON.stringify(approved.body)}`);
    }
    const [linkRow] = await orm.select({ hash: storefrontPasswordTokens.tokenHash }).from(storefrontPasswordTokens).where(eq(storefrontPasswordTokens.accountId, pending.id));
    if (!linkRow || linkRow.hash.includes(link)) wrong.push('the set-password link is not kept as a hash');
    const setPw = await site.post('/auth/set-password', { token: link, password: PASSWORD });
    const wholesaleSession = String(setPw.body.data?.sessionToken ?? '');
    if (setPw.status !== 200 || setPw.body.data.account.kind !== 'wholesale' || keysOf(setPw.body.data.account.group) !== 'code,minLineQuantity,minOrderAmount,paymentMethods,title') {
      wrong.push(`set-password: ${setPw.status} ${JSON.stringify(setPw.body)}`);
    }
    if ((await site.post('/auth/set-password', { token: link, password: PASSWORD })).status !== 404) wrong.push('a used set-password link worked again');

    // 8) group prices: only an approved session, only the products the group may see, in the group's list
    const prices = await site.get('/account/prices', wholesaleSession);
    const priceRows = (prices.body.data?.prices ?? []) as Body[];
    if (prices.status !== 200 || keysOf(prices.body.data) !== 'group,prices' || priceRows.length !== 1 || priceRows[0].slug !== `bracelet-${tag}`
      || priceRows[0].price !== GROUP_PRICE || keysOf(priceRows[0]) !== 'price,slug') wrong.push(`group prices: ${prices.status} ${JSON.stringify(prices.body)}`);
    if ((await site.get('/account/prices')).status !== 401) wrong.push('group prices without a session');

    // 9) suspend ends the session and unused links and refuses sign-in; reactivate lets the buyer in again
    const before = await erp.get(`/api/storefront/buyers/${pending.id}`);
    const unusedLink = await erp.post(`/api/storefront/buyers/${pending.id}/password-link`, { version: before.body.data.version });
    if (unusedLink.status !== 201) wrong.push(`a new set-password link: ${unusedLink.status}`);
    const detail = await erp.get(`/api/storefront/buyers/${pending.id}`);
    const suspended = await erp.post(`/api/storefront/buyers/${pending.id}/suspend`, { version: detail.body.data.version });
    if (suspended.status !== 200) wrong.push(`suspend: ${suspended.status}`);
    if ((await site.get('/account', wholesaleSession)).status !== 401) wrong.push('a suspended account kept its session');
    const signInSuspended = await site.post('/auth/login', { phone: phone3, password: PASSWORD });
    if (signInSuspended.status !== 403) wrong.push(`sign-in of a suspended account: ${signInSuspended.status}`);
    const stale = await erp.post(`/api/storefront/buyers/${pending.id}/reactivate`, { version: detail.body.data.version });
    if (stale.status !== 409) wrong.push(`reactivate with a stale version: ${stale.status}`);
    const reactivated = await erp.post(`/api/storefront/buyers/${pending.id}/reactivate`, { version: suspended.body.data.version });
    if (reactivated.status !== 200 || (await site.post('/auth/login', { phone: phone3, password: PASSWORD })).status !== 200) wrong.push('reactivate did not let the buyer in');
    const oldLink = await site.post('/auth/set-password', { token: String(unusedLink.body.data?.token ?? ''), password: PASSWORD });
    if (oldLink.status !== 404) wrong.push(`a link made before suspension worked after reactivation: ${oldLink.status}`);

    // 10) a signed-in retail buyer's request: approval clears the password they chose and ends their session
    const ownForm = await site.post('/wholesale/apply', form(phone1), retailSession);
    if (ownForm.status !== 201 || ownForm.body.data.application !== 'pending') wrong.push(`the form from an account: ${ownForm.status} ${JSON.stringify(ownForm.body)}`);
    const [own] = await orm.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneMatchKey(phone1)));
    const ownApproved = await erp.post(`/api/storefront/buyers/${own.id}/approve`, { groupId, customerId: 0, version: own.version });
    if (ownApproved.status !== 200) wrong.push(`approve the retail account: ${ownApproved.status} ${JSON.stringify(ownApproved.body)}`);
    if ((await site.get('/account', retailSession)).status !== 401) wrong.push('approval kept the old session');
    if ((await site.post('/auth/login', { phone: phone1, password: PASSWORD })).status !== 401) wrong.push('approval kept the old password');

    // 11) a group with approved accounts is not deleted
    const groupNow = (await erp.get('/api/storefront/buyer-groups')).body.data.groups.find((g: Body) => g.id === groupId);
    if (groupNow?.accountCount !== 2) wrong.push(`group account count: ${groupNow?.accountCount}`);
    const del = await erp.delete(`/api/storefront/buyer-groups/${groupId}?version=${groupNow?.version}`);
    if (del.status !== 409) wrong.push(`delete a group in use: ${del.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'account routes answered 404 while ordering was off; a retail account signed in at once with exact fields and a scrypt hash, the same phone again was 409; an unknown phone and a wrong password were the same 401 and five wrong passwords locked the account; the wholesale form made a request without a password and a phone with an account had to sign in; the retail list and a missing price key were refused for a group; approval made the customer and a one-time hashed link, the link set the password once; only the approved session saw its group prices for its collection; suspension ended the session; approval of a signed-in request cleared the old password and session; a group in use was not deleted',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
    if (phoneKeys.length > 0) {
      const rows = await orm.select({ id: storefrontBuyerAccounts.id, customerId: storefrontBuyerAccounts.customerId }).from(storefrontBuyerAccounts)
        .where(inArray(storefrontBuyerAccounts.phoneKey, phoneKeys)).catch(() => []);
      const ids = rows.map(r => r.id);
      if (ids.length > 0) {
        await orm.delete(storefrontBuyerSessions).where(inArray(storefrontBuyerSessions.accountId, ids)).catch(() => undefined);
        await orm.delete(storefrontPasswordTokens).where(inArray(storefrontPasswordTokens.accountId, ids)).catch(() => undefined);
        await orm.delete(storefrontBuyerAccounts).where(inArray(storefrontBuyerAccounts.id, ids)).catch(() => undefined);
        for (const r of ids) await orm.delete(notifications).where(eq(notifications.link, `/site-buyers?id=${r}`)).catch(() => undefined);
      }
      const customerIds = rows.map(r => r.customerId).filter((c): c is number => c !== null);
      if (customerIds.length > 0) await orm.update(customers).set({ isDeleted: 1 }).where(inArray(customers.id, customerIds)).catch(() => undefined);
    }
    if (groupCodes.length > 0) await orm.delete(storefrontBuyerGroups).where(inArray(storefrontBuyerGroups.code, groupCodes)).catch(() => undefined);
    if (itemIds.length > 0) {
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
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
