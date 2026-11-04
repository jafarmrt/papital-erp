import request from 'supertest';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, appSettings, bankAccounts, crmActivities, crmLeadStageHistory, crmLeads, documentItems, notifications, itemPrices, items, storefrontDiscountCodes, storefrontDiscountRedemptions, storefrontOrders,
  storefrontPaymentReceipts, storefrontProducts, storefrontShippingMethods, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { fin } from '../../lib/financialDecimal.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v11 phase 8.2c (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6, decision 6): discount codes of the new site, on real
 * Express routes and PostgreSQL. A code is made on the «کدهای تخفیف» section (storefront.manage; a viewer gets 403, a code
 * taken by a live one 409, an amount code below its minimum order 422). A quote with a code answers its amount (typed in
 * lower case and Persian digits too), and a code that does not apply is a 422 on `discountCode`. Two buyers racing for
 * the last use of a code get one order and one 422; the order's proforma carries the discount on its line and the
 * payable is items − discount + shipping. Cancelling the order gives the use back, so another buyer can use it. A code
 * only for account holders refuses a guest, and an amount code refuses a cart below its minimum.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const PRICE = '12500000';
const SHIPPING = '500000';

export async function runStorefrontDiscountsV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_discounts_v11_8_2c';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'orders', 'discounts', 'concurrency')) return results;

  const name = 'v11 phase 8.2c: site discount codes (admin rules and keys, the quote, the last use raced, the proforma line discount, the use back on cancel, accounts-only and the minimum order) and the corporate gift form';
  const tStart = Date.now();
  const tag = String(Date.now()).slice(-7);
  const itemIds: number[] = [];
  const codeIds: number[] = [];
  let bankId: number | null = null;
  let methodId: number | null = null;
  let leadId: number | null = null;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    });
    const erp = as(admin);
    const wrong: string[] = [];

    // the setup: a retail list, one item with 5 units, a flat shipping method, a bank account, ordering on
    const retailList = `تکی تخفیف ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const item = await createTestItem({ name: `دستبند تخفیف ${tag}`, code: `SFD-A-${tag}`, stocks: { '': 5 } });
    itemIds.push(item.id);
    await orm.insert(itemPrices).values({ itemId: item.id, title: retailList, price: money(PRICE), currency: 'IRR' });
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFD-${tag}`, title: 'ERP-TEST-MARKER حساب دریافت سایت', type: 'bank', currency: 'IRR',
      accountId: ledger?.id ?? null, initialBalance: money(0), currentBalance: money(0),
    }).returning({ id: bankAccounts.id });
    bankId = bank.id;
    const read = await erp.get('/api/storefront/settings');
    if (read.status !== 200) throw new Error(`GET settings: ${read.status}`);
    const saved = await erp.put('/api/storefront/settings', {
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: '', lowStockThreshold: 0, stockDisplay: 'count',
      warehouseCode: warehouse.code, whatsappNumber: '', whatsappEnabled: false, enabled: true, ordersEnabled: true, treasuryAccountId: bank.id,
      openOrdersPerPhone: 3, version: Number(read.body.data.version),
    });
    if (saved.status !== 200) throw new Error(`save settings: ${saved.status} ${JSON.stringify(saved.body)}`);
    const made = await erp.post('/api/storefront/api-key');
    if (made.status !== 201) throw new Error(`POST api-key: ${made.status}`);
    const apiKey = String(made.body.data?.apiKey ?? '');
    const site = { post: (url: string, body: Body) => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).send(body) };
    const method = await erp.post('/api/storefront/shipping-methods', {
      code: `sfd-${tag}`, title: 'پست آزمون تخفیف', description: '', pricing: 'flat', flatRate: SHIPPING, isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slug = `bracelet-${tag}`;
    const pub = await erp.put(`/api/storefront/products/${item.id}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
    if (pub.status !== 200) throw new Error(`publish: ${pub.status} ${JSON.stringify(pub.body)}`);

    // 1) the admin section: keys, a taken code, an amount code at or below its minimum
    const codeText = `TEST${tag}`;
    const base: Body = {
      code: codeText.toLowerCase(), title: 'تخفیف آزمون', kind: 'percent', percent: 10, amount: '0', maxDiscount: '0', minOrderAmount: '0',
      startsOn: '', endsOn: '', usageLimit: 1, perBuyerLimit: 1, forRetail: true, groupIds: [], accountsOnly: false, firstOrderOnly: false, isActive: true,
    };
    const viewRole = await createTestRole({ permissions: ['storefront.view'] });
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: viewRole.code })).username));
    if ((await viewer.get('/api/storefront/discounts')).status !== 200) wrong.push('a viewer could not read the codes');
    const viewerMade = await viewer.post('/api/storefront/discounts', base);
    if (viewerMade.status !== 403) wrong.push(`a viewer made a code: ${viewerMade.status}`);
    const created = await erp.post('/api/storefront/discounts', base);
    if (created.status !== 201 || created.body.data.code !== codeText) throw new Error(`create code: ${created.status} ${JSON.stringify(created.body)}`);
    codeIds.push(Number(created.body.data.id));
    const taken = await erp.post('/api/storefront/discounts', base);
    if (taken.status !== 409) wrong.push(`a taken code: ${taken.status}`);
    const lowMin = await erp.post('/api/storefront/discounts', { ...base, code: `LOW${tag}`, kind: 'amount', percent: 0, amount: '1000000', minOrderAmount: '1000000' });
    if (lowMin.status !== 422) wrong.push(`an amount code at its minimum: ${lowMin.status}`);

    // 2) the quote: the amount (10% of the price, whole tomans), a code typed in lower case and Persian digits, an unknown code
    const persianTyped = ` ${codeText.toLowerCase().replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])} `;
    const quote = await site.post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug, quantity: 1 }], discountCode: persianTyped });
    const discount = (BigInt(PRICE) / 10n).toString();
    if (quote.status !== 200 || quote.body.data.discount?.code !== codeText || quote.body.data.discount?.amount !== discount) {
      wrong.push(`quote with the code: ${quote.status} ${JSON.stringify(quote.body)}`);
    }
    const plain = await site.post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug, quantity: 1 }] });
    if (plain.body.data?.discount !== null) wrong.push(`quote without a code: ${JSON.stringify(plain.body.data?.discount)}`);
    const unknown = await site.post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug, quantity: 1 }], discountCode: `NO${tag}` });
    if (unknown.status !== 422 || unknown.body.details?.field !== 'discountCode') wrong.push(`an unknown code: ${unknown.status} ${JSON.stringify(unknown.body)}`);

    // 3) two buyers race for the code's only use: one order, one 422 on the code
    const buyer = (phone: string, requestKey: string, code: string): Body => ({
      requestKey, recipientName: `خریدار تخفیف ${tag}`, phone, province: 'تهران', city: 'تهران', address: 'خیابان آزمون، پلاک ۲',
      postalCode: '1234567890', note: '', shippingMethod: `sfd-${tag}`, lines: [{ slug, quantity: 1 }], discountCode: code,
    });
    const phone1 = `0912${tag}`;
    const phone2 = `0935${tag}`;
    const race = await Promise.all([
      site.post('/api/storefront/v1/orders', buyer(phone1, `rk-d1-${tag}-checkout`, codeText)),
      site.post('/api/storefront/v1/orders', buyer(phone2, `rk-d2-${tag}-checkout`, codeText)),
    ]);
    const winners = race.filter(r => r.status === 201);
    const losers = race.filter(r => r.status === 422 && r.body.code === 'STOREFRONT_DISCOUNT_NOT_APPLICABLE');
    if (winners.length !== 1 || losers.length !== 1) throw new Error(`the race: ${race.map(r => `${r.status} ${r.body.code ?? ''}`).join(' / ')}`);
    const won = winners[0].body.data.order;
    const payable = (BigInt(PRICE) - BigInt(discount) + BigInt(SHIPPING)).toString();
    if (won.payableAmount !== payable || won.itemsAmount !== PRICE || won.discount?.code !== codeText || won.discount?.amount !== discount
      || won.lines[0]?.lineAmount !== (BigInt(PRICE) - BigInt(discount)).toString()) {
      wrong.push(`the order with the code: ${JSON.stringify({ payable: won.payableAmount, discount: won.discount, line: won.lines[0] })}`);
    }
    const [row] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, won.number));
    const [line] = await orm.select({ discount: documentItems.discount }).from(documentItems)
      .where(and(eq(documentItems.documentId, row.documentId), eq(documentItems.isDeleted, 0)));
    if (!fin(line?.discount ?? 0).equals(fin(discount)) || row.discountCode !== codeText) wrong.push(`the proforma line: ${line?.discount} ${row.discountCode}`);
    const listed = (await erp.get('/api/storefront/discounts')).body.data?.codes?.find((c: Body) => c.id === codeIds[0]);
    if (listed?.usedCount !== 1) wrong.push(`used count after the order: ${listed?.usedCount}`);

    // 4) cancelling the order gives the use back: the other buyer may use it now
    const detail = (await erp.get(`/api/storefront/orders/${row.id}`)).body.data;
    const cancelled = await erp.post(`/api/storefront/orders/${row.id}/cancel`, { version: detail.version });
    if (cancelled.status !== 200) wrong.push(`cancel: ${cancelled.status} ${JSON.stringify(cancelled.body)}`);
    const [use] = await orm.select().from(storefrontDiscountRedemptions).where(eq(storefrontDiscountRedemptions.orderId, row.id));
    if (!use?.releasedAt) wrong.push('the cancelled order kept its use');
    const loserPhone = winners[0] === race[0] ? phone2 : phone1;
    const again = await site.post('/api/storefront/v1/orders', buyer(loserPhone, `rk-d3-${tag}-checkout`, codeText));
    if (again.status !== 201 || again.body.data.order.discount?.code !== codeText) wrong.push(`the use back: ${again.status} ${JSON.stringify(again.body)}`);

    // 5) a code only for account holders refuses a guest; an amount code refuses a cart below its minimum
    const accountsOnly = await erp.post('/api/storefront/discounts', { ...base, code: `ACC${tag}`, usageLimit: 0, accountsOnly: true });
    if (accountsOnly.status === 201) codeIds.push(Number(accountsOnly.body.data.id));
    const guest = await site.post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug, quantity: 1 }], discountCode: `ACC${tag}` });
    if (guest.status !== 422 || guest.body.details?.field !== 'discountCode') wrong.push(`a guest with an accounts-only code: ${guest.status}`);
    const big = await erp.post('/api/storefront/discounts', {
      ...base, code: `AMT${tag}`, kind: 'amount', percent: 0, amount: '2000000', minOrderAmount: (BigInt(PRICE) * 2n).toString(), usageLimit: 0,
    });
    if (big.status === 201) codeIds.push(Number(big.body.data.id));
    else wrong.push(`create amount code: ${big.status} ${JSON.stringify(big.body)}`);
    const below = await site.post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug, quantity: 1 }], discountCode: `AMT${tag}` });
    if (below.status !== 422) wrong.push(`a cart below the minimum: ${below.status}`);
    const above = await site.post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug, quantity: 2 }], discountCode: `AMT${tag}` });
    if (above.status !== 200 || above.body.data.discount?.amount !== '2000000') wrong.push(`a cart at the minimum: ${above.status} ${JSON.stringify(above.body)}`);

    // 6) the «هدیهٔ سازمانی» form makes a CRM lead at its first stage, from «وبسایت», with no customer, and tells crm.manage
    const badGift = await site.post('/api/storefront/v1/inquiries/corporate-gift', { organization: `شرکت آزمون ${tag}`, contactName: 'رابط آزمون', phone: '12' });
    if (badGift.status !== 422 || badGift.body.details?.field !== 'phone') wrong.push(`a gift form with a bad phone: ${badGift.status}`);
    const gift = await site.post('/api/storefront/v1/inquiries/corporate-gift', {
      organization: `شرکت آزمون ${tag}`, contactName: 'رابط آزمون', phone: '۰۲۱-۸۸۷۷۶۶۵۵', quantity: 120, budget: '2000000000', neededBy: '۱۴۰۵/۱۰/۱۵', note: 'جعبهٔ کادویی',
    });
    if (gift.status !== 201) throw new Error(`gift form: ${gift.status} ${JSON.stringify(gift.body)}`);
    leadId = Number(gift.body.data.reference);
    if (Object.keys(gift.body.data).join(',') !== 'reference') wrong.push(`the gift answer: ${JSON.stringify(gift.body.data)}`);
    const [lead] = await orm.select().from(crmLeads).where(eq(crmLeads.id, leadId));
    if (lead?.source !== 'وبسایت' || lead.stage !== 'lead' || lead.customerId !== null || lead.company !== `شرکت آزمون ${tag}` || lead.phone !== '02188776655'
      || !fin(lead.estimatedValue ?? 0).equals(fin('2000000000')) || lead.expectedCloseDate !== '2027-01-05' || !String(lead.notes).includes('۱۲۰')) {
      wrong.push(`the lead: ${JSON.stringify(lead)}`);
    }
    const [stageRow] = await orm.select().from(crmLeadStageHistory).where(eq(crmLeadStageHistory.leadId, leadId));
    if (stageRow?.toStage !== 'lead') wrong.push('the lead has no first stage row');
    const told = await orm.select().from(notifications).where(eq(notifications.link, `/crm?leadId=${leadId}`));
    if (told.length === 0) wrong.push('nobody was told of the gift request');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a viewer read the codes and got 403 making one, a taken code 409 and an amount code at its minimum 422; a quote answered 10% in whole tomans for a code typed in lower case and Persian digits and 422 on discountCode for an unknown one; two buyers racing for the only use got one order and one 422; the order took the discount off its proforma line and paid items − discount + shipping; cancelling it gave the use back and the other buyer used the code; a guest could not use an accounts-only code and a cart below an amount code\'s minimum was refused; the corporate gift form refused a bad phone and made a CRM lead at its first stage from «وبسایت» with no customer, its stage row and a notice',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
    if (itemIds.length > 0) {
      const orderRows = await orm.select({ id: storefrontOrders.id }).from(storefrontOrders).where(like(storefrontOrders.recipientName, `خریدار تخفیف ${tag}`)).catch(() => []);
      const orderIds = orderRows.map(o => o.id);
      if (orderIds.length > 0) {
        await orm.delete(storefrontDiscountRedemptions).where(inArray(storefrontDiscountRedemptions.orderId, orderIds)).catch(() => undefined);
        await orm.delete(storefrontPaymentReceipts).where(inArray(storefrontPaymentReceipts.orderId, orderIds)).catch(() => undefined);
        await orm.delete(storefrontOrders).where(inArray(storefrontOrders.id, orderIds)).catch(() => undefined);
      }
      await orm.delete(storefrontProducts).where(inArray(storefrontProducts.itemId, itemIds)).catch(() => undefined);
      await orm.update(itemPrices).set({ isDeleted: 1 }).where(inArray(itemPrices.itemId, itemIds)).catch(() => undefined);
      await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
    }
    if (leadId !== null) {
      await orm.delete(notifications).where(eq(notifications.link, `/crm?leadId=${leadId}`)).catch(() => undefined);
      await orm.delete(crmActivities).where(eq(crmActivities.leadId, leadId)).catch(() => undefined);
      await orm.delete(crmLeadStageHistory).where(eq(crmLeadStageHistory.leadId, leadId)).catch(() => undefined);
      await orm.delete(crmLeads).where(eq(crmLeads.id, leadId)).catch(() => undefined);
    }
    if (codeIds.length > 0) await orm.delete(storefrontDiscountCodes).where(inArray(storefrontDiscountCodes.id, codeIds)).catch(() => undefined);
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
