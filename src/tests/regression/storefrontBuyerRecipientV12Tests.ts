import request from 'supertest';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, activityLogs, appSettings, bankAccounts, customers, documents, itemPrices, items, storefrontBuyerAccounts, storefrontBuyerAddresses,
  storefrontBuyerSessions, storefrontOrders, storefrontProducts, storefrontShippingMethods, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { BUYER_ADDRESSES_MAX, GIFT_MESSAGE_MAX } from '../../lib/storefront/storefrontOrderRules.js';

/**
 * v12 phase 8c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, site review 2.5, owner's decision 13): the buyer apart from
 * the recipient, the free gift and the address book, on real Express routes and PostgreSQL (the texts off):
 *
 * - A gift for someone else makes the ERP's customer of the buyer (name and phone; red before: the recipient's name and
 *   the phone given), never of the recipient; the order keeps the buyer, the recipient's own phone, the gift and its card;
 *   the proforma's shipping address names the recipient and its notes say «هدیه است»; the buyer's and the colleagues'
 *   views show both people and the gift.
 * - A wrong recipient phone and a card longer than the limit are 422 on their fields; a card without a gift is dropped.
 * - An order without the new fields is the recipient's own, as before; a replay answers the same order, the same key with
 *   another card is refused.
 * - The address book: an order keeps the address as the default (the same address again is only made the default), «حساب
 *   من» makes another the default and removes one (the next becomes the default), with audit rows; another account reads
 *   and removes none of it; a guest keeps none; a full book keeps its addresses and the order still goes.
 */
interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const PASSWORD = 'رمز-آزمون-1405';
const PRICE = '9000000';

export async function runStorefrontBuyerRecipientV12Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_buyer_recipient_v12_p8c';
  if (!shouldRun(id, 'v12', 'phase8', 'storefront', 'orders', 'customers')) return results;

  const name = 'v12 phase 8c: a gift for someone else makes the customer of the buyer and keeps the recipient, the gift and its card on the order and proforma; wrong fields are 422; the address book keeps, defaults and removes addresses per account only';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const phoneKeys: string[] = [];
  let bankId: number | null = null;
  let methodId: number | null = null;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
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
    const [phoneBuyer, phoneRecipient, phoneSelf, phoneA, phoneB] = ['0910', '0911', '0912', '0913', '0914'].map(p => `${p}${tag}`);
    phoneKeys.push(...[phoneBuyer, phoneRecipient, phoneSelf, phoneA, phoneB].map(p => phoneMatchKey(p)));

    // the shop: a retail list, one item of two units and one of ten, a flat shipping method, the site on and ordering
    const retailList = `تکی خریدار و گیرنده ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const two = await createTestItem({ name: `انگشتر گیرنده ${tag}`, code: `SFB-A-${tag}`, stocks: { '': 2 } });
    const ten = await createTestItem({ name: `دستبند گیرنده ${tag}`, code: `SFB-B-${tag}`, stocks: { '': 10 } });
    itemIds.push(two.id, ten.id);
    await orm.insert(itemPrices).values([
      { itemId: two.id, title: retailList, price: money(PRICE), currency: 'IRR' },
      { itemId: ten.id, title: retailList, price: money(PRICE), currency: 'IRR' },
    ]);
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFB-${tag}`, title: 'ERP-TEST-MARKER حساب خریدار و گیرنده سایت', type: 'bank', currency: 'IRR',
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
      code: `sfb-${tag}`, title: 'پست آزمون گیرنده', description: '', pricing: 'flat', flatRate: '500000', isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slugTwo = `buyer-ring-${tag}`;
    const slugTen = `buyer-band-${tag}`;
    for (const [itemId, slug] of [[two.id, slugTwo], [ten.id, slugTen]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    let ipCount = 10;
    const site = (session = '') => {
      const ip = `10.41.0.${ipCount++}`;
      return {
        get: (url: string, key = '') => request(app).get(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session).set('X-Order-Key', key),
        post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session).send(body),
        del: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${apiKey}`).set('X-Storefront-Client-IP', ip).set('X-Buyer-Session', session),
      };
    };
    const order = (phone: string, requestKey: string, extra: Body = {}): Body => ({
      requestKey, recipientName: `گیرندهٔ هدیه ${tag}`, phone, province: 'تهران', city: 'تهران', address: 'خیابان آزمون، کوچهٔ هدیه، پلاک ۸',
      postalCode: '1234567890', note: '', shippingMethod: `sfb-${tag}`, lines: [{ slug: slugTen, quantity: 1 }], ...extra,
    });
    const customerOf = async (phone: string) => (await orm.select().from(customers).where(and(eq(customers.phone, phone), eq(customers.isDeleted, 0))))[0];

    // 1) a gift for someone else: the customer is the buyer; the order and its proforma keep the recipient and the gift
    const buyerName = `خریدار هدیه ${tag}`;
    const giftBody = order(phoneBuyer, `rk-gift-${tag}-buyer-recipient`, { buyerName, recipientPhone: phoneRecipient, gift: true, giftMessage: 'تولدت مبارک' });
    const gift = await site().post('/api/storefront/v1/orders', giftBody);
    if (gift.status !== 201) throw new Error(`gift order: ${gift.status} ${JSON.stringify(gift.body)}`);
    const giftNumber = String(gift.body.data.order.number);
    const [giftRow] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, giftNumber));
    const buyerCustomer = await customerOf(phoneBuyer);
    if (!buyerCustomer || buyerCustomer.id !== giftRow.customerId || buyerCustomer.name !== buyerName || (buyerCustomer.address ?? '') !== '') {
      wrong.push(`the gift's customer: ${JSON.stringify({ id: buyerCustomer?.id, name: buyerCustomer?.name, address: buyerCustomer?.address, order: giftRow.customerId })}`);
    }
    if (await customerOf(phoneRecipient)) wrong.push('a customer was made of the recipient');
    if (giftRow.buyerName !== buyerName || giftRow.recipientPhone !== phoneRecipient || giftRow.isGift !== 1 || giftRow.giftMessage !== 'تولدت مبارک' || giftRow.phone !== phoneBuyer) {
      wrong.push(`the gift's row: ${JSON.stringify({ b: giftRow.buyerName, rp: giftRow.recipientPhone, g: giftRow.isGift, m: giftRow.giftMessage, p: giftRow.phone })}`);
    }
    const [giftDoc] = await orm.select({ buyerName: documents.buyerName, buyerAddress: documents.buyerAddress, notes: documents.notes, partyId: documents.partyId })
      .from(documents).where(eq(documents.id, giftRow.documentId));
    if (giftDoc?.partyId !== buyerCustomer?.id || giftDoc?.buyerName !== buyerName || !String(giftDoc?.buyerAddress ?? '').startsWith(`گیرنده: گیرندهٔ هدیه ${tag} (${phoneRecipient})، `)
      || !String(giftDoc?.notes ?? '').includes('هدیه است (بی قیمت روی بسته)')) {
      wrong.push(`the gift's proforma: ${JSON.stringify(giftDoc)}`);
    }
    const seen = gift.body.data.order;
    if (seen.orderedBy?.name !== buyerName || seen.orderedBy?.phone !== phoneBuyer || seen.recipient?.phone !== phoneRecipient || seen.gift?.message !== 'تولدت مبارک') {
      wrong.push(`the buyer's view: ${JSON.stringify({ orderedBy: seen.orderedBy, recipient: seen.recipient, gift: seen.gift })}`);
    }
    const detail = await erp.get(`/api/storefront/orders/${giftRow.id}`);
    if (detail.status !== 200 || detail.body.data.orderedBy?.name !== buyerName || detail.body.data.gift?.message !== 'تولدت مبارک') {
      wrong.push(`the colleagues' view: ${detail.status} ${JSON.stringify({ orderedBy: detail.body.data?.orderedBy, gift: detail.body.data?.gift })}`);
    }
    // a replay is the same order; the same key with another card is another request
    const replay = await site().post('/api/storefront/v1/orders', giftBody);
    if (replay.status !== 201 || String(replay.body.data?.order?.number) !== giftNumber) wrong.push(`the replay: ${replay.status} ${replay.body.data?.order?.number}`);
    const reused = await site().post('/api/storefront/v1/orders', { ...giftBody, giftMessage: 'پیام دیگر' });
    if (reused.status !== 422 || reused.body.code !== 'STOREFRONT_REQUEST_KEY_REUSED') wrong.push(`the same key with another card: ${reused.status} ${reused.body.code}`);

    // 2) wrong fields; a card without a gift is dropped; an order without the new fields is the recipient's own
    const badPhone = await site().post('/api/storefront/v1/orders', order(phoneBuyer, `rk-bad-${tag}-recipient-phone`, { recipientPhone: '123' }));
    if (badPhone.status !== 422 || badPhone.body.details?.field !== 'recipientPhone') wrong.push(`a wrong recipient phone: ${badPhone.status} ${JSON.stringify(badPhone.body.details)}`);
    const longCard = await site().post('/api/storefront/v1/orders', order(phoneBuyer, `rk-bad-${tag}-long-gift-card`, { gift: true, giftMessage: 'م'.repeat(GIFT_MESSAGE_MAX + 1) }));
    if (longCard.status !== 422 || longCard.body.details?.field !== 'giftMessage') wrong.push(`a long card: ${longCard.status} ${JSON.stringify(longCard.body.details)}`);
    const own = await site().post('/api/storefront/v1/orders', order(phoneSelf, `rk-own-${tag}-recipient-order`, { giftMessage: 'بی هدیه' }));
    if (own.status !== 201) throw new Error(`own order: ${own.status} ${JSON.stringify(own.body)}`);
    const [ownRow] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, String(own.body.data.order.number)));
    const selfCustomer = await customerOf(phoneSelf);
    if (ownRow.buyerName !== '' || ownRow.isGift !== 0 || ownRow.giftMessage !== '' || selfCustomer?.name !== `گیرندهٔ هدیه ${tag}` || own.body.data.order.gift !== null) {
      wrong.push(`an own order: ${JSON.stringify({ b: ownRow.buyerName, g: ownRow.isGift, m: ownRow.giftMessage, customer: selfCustomer?.name, gift: own.body.data.order.gift })}`);
    }

    // 3) the address book
    const register = async (phone: string) => {
      const made = await site().post('/api/storefront/v1/auth/register', { name: `حساب دفترچه ${tag}`, phone, password: PASSWORD });
      const token = String(made.body.data?.sessionToken ?? '');
      if (made.status !== 201 || !token) throw new Error(`register ${phone}: ${made.status} ${JSON.stringify(made.body)}`);
      return token;
    };
    const tokenA = await register(phoneA);
    const tokenB = await register(phoneB);
    const [accountA] = await orm.select({ id: storefrontBuyerAccounts.id }).from(storefrontBuyerAccounts).where(eq(storefrontBuyerAccounts.phoneKey, phoneMatchKey(phoneA)));
    const bookOf = async (token: string) => (await site(token).get('/api/storefront/v1/account/addresses')).body.data as { data: Array<{ id: number; recipientName: string; city: string; isDefault: boolean }>; max: number };
    let n = 0;
    const placeKept = (token: string, extra: Body) => site(token).post('/api/storefront/v1/orders', order(token === tokenA ? phoneA : phoneB, `rk-book-${tag}-${String(n++).padStart(3, '0')}-x`, { saveAddress: true, ...extra }));
    if ((await placeKept(tokenA, {})).status !== 201) throw new Error('first kept order');
    let book = await bookOf(tokenA);
    if (book.data.length !== 1 || !book.data[0].isDefault || book.data[0].recipientName !== `گیرندهٔ هدیه ${tag}` || book.max !== BUYER_ADDRESSES_MAX) wrong.push(`one kept address: ${JSON.stringify(book)}`);
    await placeKept(tokenA, {});
    book = await bookOf(tokenA);
    if (book.data.length !== 1) wrong.push(`the same address twice: ${book.data.length}`);
    await placeKept(tokenA, { recipientName: `گیرندهٔ دوم ${tag}`, city: 'کرج', province: 'البرز' });
    book = await bookOf(tokenA);
    const first = book.data.find(a => a.recipientName === `گیرندهٔ هدیه ${tag}`);
    if (book.data.length !== 2 || book.data[0].recipientName !== `گیرندهٔ دوم ${tag}` || !book.data[0].isDefault || first?.isDefault !== false) wrong.push(`a second address: ${JSON.stringify(book.data)}`);
    const madeDefault = await site(tokenA).post(`/api/storefront/v1/account/addresses/${first?.id}/default`, {});
    if (madeDefault.status !== 200 || madeDefault.body.data.data[0].id !== first?.id) wrong.push(`make the default: ${madeDefault.status} ${JSON.stringify(madeDefault.body)}`);
    // another account reads and removes none of it
    if ((await bookOf(tokenB)).data.length !== 0) wrong.push('another account read the book');
    const stolen = await site(tokenB).del(`/api/storefront/v1/account/addresses/${first?.id}`);
    if (stolen.status !== 404) wrong.push(`another account removed an address: ${stolen.status}`);
    const removed = await site(tokenA).del(`/api/storefront/v1/account/addresses/${first?.id}`);
    if (removed.status !== 200 || removed.body.data.data.length !== 1 || !removed.body.data.data[0].isDefault) wrong.push(`remove the default: ${removed.status} ${JSON.stringify(removed.body.data)}`);
    if ((await site().get('/api/storefront/v1/account/addresses')).status !== 401) wrong.push('a guest read an address book');
    const [{ audits }] = (await orm.select({ audits: sql<number>`count(*)::int` }).from(activityLogs)
      .where(and(eq(activityLogs.entity, 'نشانی خریدار سایت'), sql`${activityLogs.details}::text ~ ${`"accountId": ?${accountA.id}[,}]`}`)));
    if (audits < 4) wrong.push(`the book's audit rows: ${audits}`);
    // a guest keeps none; a full book keeps its addresses and the order still goes
    const guestKept = await site().post('/api/storefront/v1/orders', order(phoneSelf, `rk-guest-${tag}-keeps-nothing`, { saveAddress: true }));
    if (guestKept.status !== 201) wrong.push(`a guest's order with the box: ${guestKept.status}`);
    const live = await orm.select({ id: storefrontBuyerAddresses.id }).from(storefrontBuyerAddresses)
      .where(and(eq(storefrontBuyerAddresses.accountId, accountA.id), eq(storefrontBuyerAddresses.isDeleted, 0)));
    await orm.insert(storefrontBuyerAddresses).values(Array.from({ length: BUYER_ADDRESSES_MAX - live.length }, (_, i) => ({
      accountId: accountA.id, recipientName: `پر ${i}`, province: 'تهران', city: 'تهران', address: `پلاک ${i}`, postalCode: '1234567890',
    })));
    const full = await placeKept(tokenA, { recipientName: `گیرندهٔ تازه ${tag}` });
    if (full.status !== 201) wrong.push(`an order with a full book: ${full.status}`);
    if ((await bookOf(tokenA)).data.length !== BUYER_ADDRESSES_MAX) wrong.push('a full book grew');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a gift for someone else made the customer of the buyer (name, phone, no address) and none of the recipient; the order kept the buyer, the recipient phone, the gift and its card; the proforma named the recipient in its shipping address and said «هدیه است» in its notes; the buyer and the colleagues saw both people and the gift; a replay answered the order and the same key with another card was refused; a wrong recipient phone and a long card were 422 on their fields; a card without a gift was dropped and an order without the new fields was the recipient own as before; the address book kept an address once as the default, a second became the default, another was made the default and removing it made the next one the default, with audit rows; another account read and removed none of it, a guest read none and kept none; a full book kept its addresses and the order still went',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
    if (phoneKeys.length > 0) {
      await orm.delete(storefrontOrders).where(inArray(storefrontOrders.phoneKey, phoneKeys)).catch(() => undefined);
      const ids = (await orm.select({ id: storefrontBuyerAccounts.id }).from(storefrontBuyerAccounts)
        .where(inArray(storefrontBuyerAccounts.phoneKey, phoneKeys)).catch(() => [])).map(r => r.id);
      if (ids.length > 0) {
        await orm.delete(storefrontBuyerAddresses).where(inArray(storefrontBuyerAddresses.accountId, ids)).catch(() => undefined);
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
