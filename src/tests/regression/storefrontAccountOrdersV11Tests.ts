import request from 'supertest';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, appSettings, bankAccounts, customers, documentItems, documents, itemPrices, items, notifications, storefrontBuyerAccounts,
  storefrontBuyerGroups, storefrontBuyerSessions, storefrontOrders, storefrontPasswordTokens, storefrontPaymentReceipts, storefrontProducts,
  storefrontShippingMethods, storefrontSmsMessages,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';

/**
 * v11 phase 8.2b part 2 (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6): orders of signed-in buyers, on real Express
 * routes and PostgreSQL. A retail account's order belongs to it and only it reads it; a guest order joins an account only
 * with its tracking key, never twice. An approved buyer orders with its group's prices, collections, minimums and payment
 * methods; «به حساب» waits for a colleague, goes on the customer linked at approval, needs the finalize key to confirm
 * and then ships; an unconfirmed on-account order expires like an unpaid one.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const RETAIL = '12500000';
const GROUP_PRICE = '9000000';
const PASSWORD = 'رمز-آزمون-1405';
const keysOf = (value: unknown) => Object.keys((value ?? {}) as Body).sort().join(',');

export async function runStorefrontAccountOrdersV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_account_orders_v11_8_2b2';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'buyers', 'orders', 'security')) return results;

  const name = 'v11 phase 8.2b part 2: account order history, claiming a guest order by its key, group prices, scope and minimums at checkout, on-account orders confirmed with the finalize key, and their expiry';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const phoneKeys: string[] = [];
  const groupCodes: string[] = [];
  let bankId: number | null = null;
  let methodId: number | null = null;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { expireDueOrdersOnce, remindDueApprovalsOnce } = await import('../../services/storefront/storefrontOrderExpiry.service.js');
    const app = await getTestApp();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    });
    const erp = as(await getAdminSession());
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];

    // the setup: a retail and a group list, two published items in two collections, shipping, a bank, ordering on
    const retailList = `تکی سفارش حساب ${tag}`;
    const groupList = `عمده سفارش حساب ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = [...('titles' in current ? current.titles : []), retailList, groupList];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify(strategies) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(strategies) } });
    invalidateSettingsCache();
    const colA = `کالکشن سفارش آ ${tag}`;
    const inScope = await createTestItem({ name: `دستبند سفارش حساب ${tag}`, code: `SFAO-A-${tag}`, collections: [colA], stocks: { '': 10 } });
    const outOfScope = await createTestItem({ name: `گوشواره سفارش حساب ${tag}`, code: `SFAO-B-${tag}`, collections: [`کالکشن سفارش ب ${tag}`], stocks: { '': 10 } });
    itemIds.push(inScope.id, outOfScope.id);
    await orm.insert(itemPrices).values([inScope.id, outOfScope.id].flatMap(itemId => [
      { itemId, title: retailList, price: money(RETAIL), currency: 'IRR' },
      { itemId, title: groupList, price: money(GROUP_PRICE), currency: 'IRR' },
    ]));
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFAO-${tag}`, title: 'ERP-TEST-MARKER حساب دریافت سایت', type: 'bank', currency: 'IRR',
      accountId: ledger?.id ?? null, initialBalance: money(0), currentBalance: money(0),
    }).returning({ id: bankAccounts.id });
    bankId = bank.id;
    const read = await erp.get('/api/storefront/settings');
    if (read.status !== 200) throw new Error(`GET settings: ${read.status}`);
    const saved = await erp.put('/api/storefront/settings', {
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: '', lowStockThreshold: 0, stockDisplay: 'status',
      warehouseCode: '', whatsappNumber: '', whatsappEnabled: false, enabled: true, ordersEnabled: true, treasuryAccountId: bank.id,
      openOrdersPerPhone: 10, version: Number(read.body.data.version),
    });
    if (saved.status !== 200) throw new Error(`save settings: ${saved.status} ${JSON.stringify(saved.body)}`);
    const made = await erp.post('/api/storefront/api-key');
    const apiKey = String(made.body.data?.apiKey ?? '');
    const address = () => `10.${Number(tag.slice(0, 2))}.${Number(tag.slice(2, 4))}.${Math.floor(Math.random() * 250) + 1}`;
    const site = {
      get: (url: string, session = '') => request(app).get(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`).set('X-Buyer-Session', session),
      post: (url: string, body: Body, session = '', orderKey = '') => request(app).post(`/api/storefront/v1${url}`).set('Authorization', `Bearer ${apiKey}`)
        .set('X-Buyer-Session', session).set('X-Order-Key', orderKey).set('X-Storefront-Client-IP', address()).send(body),
    };
    const method = await erp.post('/api/storefront/shipping-methods', {
      code: `sfao-${tag}`, title: 'پست آزمون حساب', description: '', pricing: 'flat', flatRate: '500000', isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slugA = `bracelet-ao-${tag}`;
    const slugB = `earring-ao-${tag}`;
    for (const [itemId, slug] of [[inScope.id, slugA], [outOfScope.id, slugB]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    const phoneR = `0915${tag}`;
    const phoneG = `0916${tag}`;
    const phoneW = `0917${tag}`;
    const phoneO = `0918${tag}`;
    phoneKeys.push(...[phoneR, phoneG, phoneW, phoneO].map(phoneMatchKey));
    let rk = 0;
    const order = (phone: string, slug: string, quantity: number, extra: Body = {}): Body => ({
      requestKey: `rk-ao-${tag}-${++rk}-checkout`, recipientName: `خریدار حساب ${tag}`, phone, province: 'تهران', city: 'تهران',
      address: 'خیابان آزمون، پلاک ۱', postalCode: '1234567890', note: '', shippingMethod: `sfao-${tag}`, lines: [{ slug, quantity }], ...extra,
    });

    // 1) a retail account's order is its own: listed, read by number, and the same 404 for any other session
    const reg = await site.post('/auth/register', { name: `خریدار تکی ${tag}`, phone: phoneR, password: PASSWORD });
    const retail = String(reg.body.data?.sessionToken ?? '');
    if (reg.status !== 201) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const placedR = await site.post('/orders', order(phoneR, slugA, 1), retail);
    if (placedR.status !== 201 || placedR.body.data.order.itemsAmount !== RETAIL || placedR.body.data.order.wholesale !== false) {
      throw new Error(`retail account order: ${placedR.status} ${JSON.stringify(placedR.body)}`);
    }
    const numberR = String(placedR.body.data.order.number);
    const list = await site.get('/account/orders', retail);
    if (list.status !== 200 || list.body.data.total !== 1 || list.body.data.data[0]?.number !== numberR
      || keysOf(list.body.data.data[0]) !== 'createdAt,itemCount,number,payableAmount,payableToman,paymentMethod,status,statusTitle') {
      wrong.push(`account orders: ${list.status} ${JSON.stringify(list.body)}`);
    }
    if ((await site.get(`/account/orders/${numberR}`, retail)).status !== 200) wrong.push('the account could not read its own order');
    if ((await site.get('/account/orders')).status !== 401) wrong.push('account orders without a session are not 401');

    // 2) a guest order joins an account only with its key; a wrong key is 404; another account then gets 409
    const guest = await site.post('/orders', order(phoneG, slugA, 1));
    if (guest.status !== 201) throw new Error(`guest order: ${guest.status} ${JSON.stringify(guest.body)}`);
    const numberG = String(guest.body.data.order.number);
    const keyG = String(guest.body.data.accessKey);
    if ((await site.get(`/account/orders/${numberG}`, retail)).status !== 404) wrong.push('an unclaimed guest order was readable from an account');
    if ((await site.post('/account/orders/claim', { number: numberG, accessKey: `${keyG.slice(0, -2)}xx` }, retail)).status !== 404) wrong.push('a wrong key claimed an order');
    const claimed = await site.post('/account/orders/claim', { number: numberG, accessKey: keyG }, retail);
    if (claimed.status !== 200 || claimed.body.data.number !== numberG) wrong.push(`claim: ${claimed.status} ${JSON.stringify(claimed.body)}`);
    if ((await site.get('/account/orders', retail)).body.data?.total !== 2) wrong.push('the claimed order is not in the history');
    const other = await site.post('/auth/register', { name: `خریدار دیگر ${tag}`, phone: phoneO, password: PASSWORD });
    const otherSession = String(other.body.data?.sessionToken ?? '');
    const stolen = await site.post('/account/orders/claim', { number: numberG, accessKey: keyG }, otherSession);
    if (stolen.status !== 409 || stolen.body.code !== 'STOREFRONT_ORDER_CLAIMED') wrong.push(`a second claim: ${stolen.status}`);
    if ((await site.get(`/account/orders/${numberR}`, otherSession)).status !== 404) wrong.push('another account read an order');
    // 2b) an account sends a receipt for its own order without the key; another account's session is the same 404
    const receipt = (amount: string) => ({ reference: `RF${tag}`, paidAt: new Date(Date.now() - 60_000).toISOString(), cardLast4: '1234', amount });
    if ((await site.post(`/account/orders/${numberR}/receipts`, receipt(String(placedR.body.data.order.payableAmount)), otherSession)).status !== 404) {
      wrong.push('another account sent a receipt for an order');
    }
    if ((await site.post(`/account/orders/${numberR}/receipts`, receipt(String(placedR.body.data.order.payableAmount)))).status !== 401) {
      wrong.push('an account receipt without a session is not 401');
    }
    const paidR = await site.post(`/account/orders/${numberR}/receipts`, receipt(String(placedR.body.data.order.payableAmount)), retail);
    if (paidR.status !== 201 || paidR.body.data.status !== 'payment_submitted' || paidR.body.data.receipts?.length !== 1) {
      wrong.push(`an account receipt: ${paidR.status} ${JSON.stringify(paidR.body)}`);
    }
    const retailOnAccount = await site.post('/orders', order(phoneR, slugA, 1, { paymentMethod: 'on_account' }), retail);
    if (retailOnAccount.status !== 422 || retailOnAccount.body.details?.field !== 'paymentMethod') wrong.push(`a retail on-account order: ${retailOnAccount.status}`);

    // 3) an approved wholesale buyer: on-account only, collection A, at least 2 of each line and more than two units' amount
    groupCodes.push(`ao-${tag}`);
    const minimum = (BigInt(GROUP_PRICE) * 2n + 1n).toString();
    const group = await erp.post('/api/storefront/buyer-groups', {
      code: `ao-${tag}`, title: `عمده به حساب ${tag}`, description: '', priceList: groupList, minOrderAmount: minimum, minLineQuantity: 2,
      allowCard: false, allowOnAccount: true, creditLimit: '0', catalogScope: 'collections', collections: [colA], acceptsDiscounts: false,
      isActive: true, sortOrder: 5,
    });
    if (group.status !== 201) throw new Error(`create group: ${group.status} ${JSON.stringify(group.body)}`);
    const applied = await site.post('/wholesale/apply', {
      name: `خریدار عمده ${tag}`, companyName: `فروشگاه حساب ${tag}`, city: 'شیراز', phone: phoneW, nationalId: '', economicCode: '', note: '',
    });
    if (applied.status !== 201) throw new Error(`apply: ${applied.status} ${JSON.stringify(applied.body)}`);
    const [pending] = await orm.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneMatchKey(phoneW)));
    const approved = await erp.post(`/api/storefront/buyers/${pending.id}/approve`, { groupId: Number(group.body.data.id), customerId: 0, version: pending.version });
    if (approved.status !== 200) throw new Error(`approve: ${approved.status} ${JSON.stringify(approved.body)}`);
    const setPw = await site.post('/auth/set-password', { token: String(approved.body.data.token), password: PASSWORD });
    const wholesale = String(setPw.body.data?.sessionToken ?? '');
    const quote = await site.post('/shipping/quote', { province: 'تهران', lines: [{ slug: slugA, quantity: 3 }] }, wholesale);
    if (quote.status !== 200 || quote.body.data.itemsAmount !== (BigInt(GROUP_PRICE) * 3n).toString()) wrong.push(`group quote: ${quote.status} ${JSON.stringify(quote.body)}`);
    const expectCode = async (body: Body, code: string, what: string) => {
      const res = await site.post('/orders', body, wholesale);
      if (res.status !== 422 || (res.body.code !== code && res.body.details?.field !== code)) wrong.push(`${what}: ${res.status} ${JSON.stringify(res.body)}`);
    };
    await expectCode(order(phoneW, slugB, 3, { paymentMethod: 'on_account' }), 'STOREFRONT_ITEM_NOT_ON_SALE', 'an item outside the group');
    await expectCode(order(phoneW, slugA, 1, { paymentMethod: 'on_account' }), 'STOREFRONT_GROUP_MIN_LINE', 'below the line minimum');
    await expectCode(order(phoneW, slugA, 2, { paymentMethod: 'on_account' }), 'STOREFRONT_GROUP_MIN_ORDER', 'below the order minimum');
    await expectCode(order(phoneW, slugA, 3), 'paymentMethod', 'card for a group without card');
    const placedW = await site.post('/orders', order(phoneW, slugA, 3, { paymentMethod: 'on_account' }), wholesale);
    const w = placedW.body.data?.order;
    if (placedW.status !== 201 || w.status !== 'awaiting_approval' || w.payment !== null || w.paymentMethod !== 'on_account' || w.wholesale !== true
      || w.lines[0]?.unitPrice !== GROUP_PRICE) throw new Error(`on-account order: ${placedW.status} ${JSON.stringify(placedW.body)}`);
    const [rowW] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, String(w.number)));
    const [account] = await orm.select().from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.id, pending.id));
    if (rowW.customerId !== account.customerId || rowW.buyerAccountId !== account.id || rowW.buyerGroupId !== Number(group.body.data.id)) {
      wrong.push(`the on-account order's links: ${JSON.stringify({ customer: rowW.customerId, account: rowW.buyerAccountId, group: rowW.buyerGroupId })}`);
    }

    // 4) the ERP: approve-on-account only, needs the finalize key; then the invoice is final and the order ships
    const detail = await erp.get(`/api/storefront/orders/${rowW.id}`);
    if (detail.status !== 200 || !detail.body.data.actions.approveOnAccount || detail.body.data.actions.confirm || detail.body.data.group?.title !== `عمده به حساب ${tag}`) {
      wrong.push(`ERP detail: ${detail.status} ${JSON.stringify(detail.body.data?.actions)}`);
    }
    const role = await createTestRole({ permissions: ['site_orders.view', 'site_orders.manage'] });
    const noFinalize = as(await loginTestUserWithSession(app, (await createTestUser({ role: role.code })).username));
    const forbidden = await noFinalize.post(`/api/storefront/orders/${rowW.id}/approve-on-account`, { version: rowW.version });
    if (forbidden.status !== 403) wrong.push(`approve without the finalize key: ${forbidden.status}`);
    const ok = await erp.post(`/api/storefront/orders/${rowW.id}/approve-on-account`, { version: rowW.version });
    if (ok.status !== 200 || ok.body.data.status !== 'confirmed' || ok.body.data.actions.fulfil !== 'shipped') wrong.push(`approve: ${ok.status} ${JSON.stringify(ok.body)}`);
    const [doc] = await orm.select({ status: documents.status }).from(documents).where(eq(documents.id, rowW.documentId));
    if (doc?.status === 'proforma') wrong.push('the approved order is still a proforma');
    const shipped = await erp.post(`/api/storefront/orders/${rowW.id}/fulfil`, { status: 'shipped', trackingCode: '', version: ok.body.data.version });
    if (shipped.status !== 200 || shipped.body.data.status !== 'shipped') wrong.push(`ship a confirmed order: ${shipped.status}`);

    // 5) an on-account order no colleague confirmed expires like an unpaid one
    const late = await site.post('/orders', order(phoneW, slugA, 3, { paymentMethod: 'on_account' }), wholesale);
    if (late.status !== 201) throw new Error(`second on-account order: ${late.status} ${JSON.stringify(late.body)}`);
    const lateNumber = String(late.body.data.order.number);
    // v12 phase 8b (site review 2.7): it waits 72 hours for a colleague (a card order waits the 24-hour reservation)
    const [wait] = (await orm.execute(sql`SELECT round(extract(epoch FROM reserve_until - created_at) / 3600)::int AS hours FROM storefront_orders WHERE order_number = ${lateNumber}`)).rows as Array<{ hours: number }>;
    if (wait?.hours !== 72) wrong.push(`the on-account wait: ${wait?.hours} hours`);
    // twelve hours before its wait runs out the colleagues get one bell, and only one, with its audit row
    await orm.update(storefrontOrders).set({ reserveUntil: sql`now() + interval '6 hours'` }).where(eq(storefrontOrders.orderNumber, lateNumber));
    const reminderTitle = `مهلت تأیید سفارش به حساب ${lateNumber} نزدیک است`;
    const bells = async () => (await orm.select({ id: notifications.id }).from(notifications).where(eq(notifications.title, reminderTitle))).length;
    if (await remindDueApprovalsOnce() < 1) wrong.push('the approval reminder did not ring');
    const [reminded] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, lateNumber));
    const rang = await bells();
    if (!reminded?.approvalRemindedAt || rang < 1) wrong.push(`the approval reminder: ${reminded?.approvalRemindedAt} ${rang}`);
    await remindDueApprovalsOnce();
    if (await bells() !== rang) wrong.push(`the approval reminder rang twice: ${await bells()} after ${rang}`);
    const [{ audits }] = (await orm.execute(sql`SELECT count(*)::int AS audits FROM activity_logs WHERE description = ${`یادآوری مهلت تأیید سفارش به حساب ${lateNumber} به همکاران رفت`}`)).rows as Array<{ audits: number }>;
    if (audits !== 1) wrong.push(`the reminder's audit rows: ${audits}`);
    await orm.update(storefrontOrders).set({ reserveUntil: sql`now() - interval '1 minute'` }).where(eq(storefrontOrders.orderNumber, lateNumber));
    await expireDueOrdersOnce();
    const [gone] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, String(late.body.data.order.number)));
    if (gone?.status !== 'cancelled' || gone.cancelReason !== 'expired') wrong.push(`on-account expiry: ${gone?.status} ${gone?.cancelReason}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a retail account listed and read only its own orders with exact fields; a guest order joined only with its key and could not be claimed twice; the account sent a receipt for its own order without the key (another session 404, none 401); a retail account could not pay on account; the approved buyer was quoted and charged its group price, and an item outside its collections, a line below its minimum, an order below its minimum and card payment were refused by field; the on-account order waited for approval on the linked customer, needed the finalize key, became final and shipped; an on-account order waited 72 hours, rang one reminder bell with one audit row twelve hours before its end however often the sweep ran, and expired unconfirmed',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
    if (phoneKeys.length > 0) {
      const orderRows = await orm.select({ id: storefrontOrders.id, documentId: storefrontOrders.documentId }).from(storefrontOrders)
        .where(inArray(storefrontOrders.phoneKey, phoneKeys)).catch(() => []);
      const orderIds = orderRows.map(o => o.id);
      if (orderIds.length > 0) {
        await orm.delete(storefrontSmsMessages).where(inArray(storefrontSmsMessages.orderId, orderIds)).catch(() => undefined);
        await orm.delete(storefrontPaymentReceipts).where(inArray(storefrontPaymentReceipts.orderId, orderIds)).catch(() => undefined);
        await orm.delete(storefrontOrders).where(inArray(storefrontOrders.id, orderIds)).catch(() => undefined);
        const docIds = orderRows.map(o => o.documentId);
        await orm.update(documentItems).set({ isDeleted: 1 }).where(inArray(documentItems.documentId, docIds)).catch(() => undefined);
      }
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
