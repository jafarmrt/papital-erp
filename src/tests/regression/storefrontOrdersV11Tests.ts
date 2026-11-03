import request from 'supertest';
import { and, asc, eq, inArray, like } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import {
  accounts, appSettings, bankAccounts, notifications, documents, itemPrices, items, storefrontOrders, storefrontPaymentReceipts, storefrontProducts,
  storefrontShippingMethods, treasuryTransactions, warehouses,
} from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { fin } from '../../lib/financialDecimal.js';
import { invalidateSettingsCache } from '../../lib/memoryCache.js';
import { readPricingStrategies } from '../../lib/items/pricingStrategies.js';

/**
 * v11 phase 8.2a (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §4–§5): orders and card-to-card payment of the new site,
 * on real Express routes and PostgreSQL. Ordering is 404 until its own switch is on. An order is a reserving proforma
 * priced by the server (a price in the request is refused), its tracking key is the only way to read it (a wrong key is
 * the same 404 as a missing order), a repeat of the same request answers the same order, and two buyers racing for the
 * last unit get one order and one 409. A receipt whose amount differs cannot be confirmed; a rejected receipt reopens
 * the order; confirming needs the treasury and finalize keys and turns the proforma into an invoice with a treasury
 * receipt for the payable amount; an unpaid order past its time is cancelled and its stock is free again.
 */

interface Session { cookie: string; csrfToken: string }
type Body = Record<string, unknown>;

const VALID_CARD = '6037991234567893';
const VALID_IBAN = 'IR050170000000123456789012';
const PRICE = '12500000';
const SHIPPING = '500000';

export async function runStorefrontOrdersV11Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_storefront_orders_v11_8_2a';
  if (!shouldRun(id, 'v11', 'phase8', 'storefront', 'orders', 'payment', 'reservation', 'concurrency')) return results;

  const name = 'v11 phase 8.2a: site orders behind their own switch, server prices, the tracking key, request replay, the last unit raced, receipt amount check, reject, confirm with treasury and finalize keys, and expiry releasing stock';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const orderIds: number[] = [];
  let bankId: number | null = null;
  let methodId: number | null = null;
  const savedSettings = await orm.select().from(appSettings).where(like(appSettings.key, 'sf\\_%'));
  const savedStrategies = await orm.select().from(appSettings).where(eq(appSettings.key, 'pricing_strategies'));
  try {
    const { getTestApp, getAdminSession, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestRole, createTestUser } = await import('../fixtures/factories.js');
    const { expireDueOrdersOnce } = await import('../../services/storefront/storefrontOrderExpiry.service.js');
    const app = await getTestApp();
    const admin: Session = await getAdminSession();
    const as = (s: Session) => ({
      get: (url: string) => request(app).get(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken),
      put: (url: string, body: Body) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
      post: (url: string, body: Body = {}) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body),
    });
    const erp = as(admin);
    const tag = String(Date.now()).slice(-7);
    const wrong: string[] = [];

    // the setup: a retail list, two items (2 units and 1 unit), a flat shipping method, a bank account with its ledger
    const retailList = `تکی سفارش ${tag}`;
    const current = readPricingStrategies(savedStrategies[0]?.value);
    const strategies = 'titles' in current ? current.titles : [];
    await orm.insert(appSettings).values({ key: 'pricing_strategies', value: JSON.stringify([...strategies, retailList]) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify([...strategies, retailList]) } });
    invalidateSettingsCache();
    const [warehouse] = await orm.select({ code: warehouses.code }).from(warehouses).where(eq(warehouses.isActive, 1)).orderBy(asc(warehouses.id)).limit(1);
    const two = await createTestItem({ name: `انگشتر سفارش ${tag}`, code: `SFO-A-${tag}`, stocks: { '': 2 } });
    const one = await createTestItem({ name: `گردنبند سفارش ${tag}`, code: `SFO-B-${tag}`, stocks: { '': 1 } });
    itemIds.push(two.id, one.id);
    await orm.insert(itemPrices).values([
      { itemId: two.id, title: retailList, price: money(PRICE), currency: 'IRR' },
      { itemId: one.id, title: retailList, price: money(PRICE), currency: 'IRR' },
    ]);
    const [ledger] = await orm.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.code, '1001'), eq(accounts.isDeleted, 0)));
    const [bank] = await orm.insert(bankAccounts).values({
      code: `ERP-TEST-SFO-${tag}`, title: 'ERP-TEST-MARKER حساب دریافت سایت', type: 'bank', currency: 'IRR',
      accountId: ledger?.id ?? null, initialBalance: money(0), currentBalance: money(0),
    }).returning({ id: bankAccounts.id });
    bankId = bank.id;

    const read = await erp.get('/api/storefront/settings');
    if (read.status !== 200) throw new Error(`GET settings: ${read.status}`);
    let version = Number(read.body.data.version);
    const settings = {
      cardNumber: VALID_CARD, cardHolder: 'گالری پاپیتال', bankName: 'ملت', iban: VALID_IBAN, freeShippingThreshold: '',
      reservationHours: 24, retailPriceList: retailList, wholesalePriceList: '', lowStockThreshold: 0, stockDisplay: 'count',
      warehouseCode: warehouse.code, enabled: true, ordersEnabled: false, treasuryAccountId: bank.id, openOrdersPerPhone: 3,
    };
    const save = async (patch: Body) => {
      const res = await erp.put('/api/storefront/settings', { ...settings, ...patch, version });
      if (res.status !== 200) throw new Error(`save settings: ${res.status} ${JSON.stringify(res.body)}`);
      version = Number(res.body.data.version);
    };
    await save({});
    const made = await erp.post('/api/storefront/api-key');
    const apiKey = String(made.body.data?.apiKey ?? '');
    if (made.status !== 201) throw new Error(`POST api-key: ${made.status}`);
    const site = {
      get: (url: string, orderKey = '') => request(app).get(url).set('Authorization', `Bearer ${apiKey}`).set('X-Order-Key', orderKey),
      post: (url: string, body: Body, orderKey = '') => request(app).post(url).set('Authorization', `Bearer ${apiKey}`).set('X-Order-Key', orderKey).send(body),
    };
    const method = await erp.post('/api/storefront/shipping-methods', {
      code: `sfo-${tag}`, title: 'پست آزمون سفارش', description: '', pricing: 'flat', flatRate: SHIPPING, isActive: true,
      isFreeShippingEligible: false, sortOrder: 1, rates: [],
    });
    if (method.status !== 201) throw new Error(`create shipping: ${method.status} ${JSON.stringify(method.body)}`);
    methodId = Number(method.body.data.id);
    const slugA = `ring-${tag}`;
    const slugB = `necklace-${tag}`;
    for (const [itemId, slug] of [[two.id, slugA], [one.id, slugB]] as const) {
      const pub = await erp.put(`/api/storefront/products/${itemId}`, { published: true, slug, seoTitle: '', seoDescription: '', sortOrder: 0, version: 0 });
      if (pub.status !== 200) throw new Error(`publish ${slug}: ${pub.status} ${JSON.stringify(pub.body)}`);
    }
    const stockOf = async (slug: string) => (await site.get(`/api/storefront/v1/products/${slug}`)).body.data?.stock?.quantity;

    const buyer = (phone: string, slug: string, requestKey: string, quantity = 1): Body => ({
      requestKey, recipientName: `خریدار آزمون ${tag}`, phone, province: 'تهران', city: 'تهران', address: 'خیابان آزمون، پلاک ۱',
      postalCode: '1234567890', note: '', shippingMethod: `sfo-${tag}`, lines: [{ slug, quantity }],
    });
    const phone1 = `0912${tag}`;

    // 1) ordering is off by its own switch, even with the site on
    const whileOff = await site.post('/api/storefront/v1/orders', buyer(phone1, slugA, `rk-off-${tag}-checkout`));
    if (whileOff.status !== 404) wrong.push(`an order while ordering is off: ${whileOff.status}, not 404`);
    await save({ ordersEnabled: true });

    // 2) a quote, then a price in the request is refused (the server prices the cart)
    const quote = await site.post('/api/storefront/v1/shipping/quote', { province: 'تهران', lines: [{ slug: slugA, quantity: 1 }] });
    const option = (quote.body.data?.options ?? []).find((o: Body) => o.code === `sfo-${tag}`);
    if (quote.status !== 200 || quote.body.data.itemsAmount !== PRICE || option?.amount !== SHIPPING) wrong.push(`quote: ${quote.status} ${JSON.stringify(quote.body)}`);
    const tampered = await site.post('/api/storefront/v1/orders', { ...buyer(phone1, slugA, `rk-t-${tag}-checkout`), lines: [{ slug: slugA, quantity: 1, unitPrice: '1' }] });
    if (tampered.status === 201 || tampered.status < 400 || tampered.status >= 500) wrong.push(`a price in the request: ${tampered.status}, not refused`);

    // 3) an order: 201, a key, server prices, a reserving proforma, one unit less on the site
    const body1 = buyer(phone1, slugA, `rk-1-${tag}-checkout`);
    const placed = await site.post('/api/storefront/v1/orders', body1);
    if (placed.status !== 201) throw new Error(`place: ${placed.status} ${JSON.stringify(placed.body)}`);
    const order1 = placed.body.data.order;
    const key1 = String(placed.body.data.accessKey);
    const payable = (BigInt(PRICE) + BigInt(SHIPPING)).toString();
    if (!key1.startsWith('ok_')) wrong.push(`the tracking key: ${key1.slice(0, 3)}`);
    if (order1.status !== 'awaiting_payment' || order1.payableAmount !== payable || order1.lines[0]?.unitPrice !== PRICE || !order1.payment?.cardNumber) {
      wrong.push(`the placed order: ${JSON.stringify({ status: order1.status, payable: order1.payableAmount, line: order1.lines[0], payment: order1.payment })}`);
    }
    // the security review's contract: exactly these fields reach the buyer
    const keys = (value: Body) => Object.keys(value).sort().join(',');
    const expectedOrder = 'cancelReason,cancelReasonTitle,canSendReceipt,createdAt,itemsAmount,lines,note,number,payBefore,payableAmount,payableToman,payment,receipts,recipient,shipping,status,statusTitle,trackingCode';
    if (keys(order1) !== expectedOrder.split(',').sort().join(',')) wrong.push(`buyer order fields: ${keys(order1)}`);
    if (keys(order1.lines[0] ?? {}) !== 'lineAmount,name,quantity,sku,slug,unitPrice') wrong.push(`buyer line fields: ${keys(order1.lines[0] ?? {})}`);
    if (keys(placed.body.data) !== 'accessKey,order') wrong.push(`placed fields: ${keys(placed.body.data)}`);
    const [row1] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, order1.number));
    orderIds.push(row1.id);
    const [doc1] = await orm.select({ status: documents.status, docType: documents.type }).from(documents).where(eq(documents.id, row1.documentId));
    if (doc1?.status !== 'proforma' || doc1?.docType !== 'invoice') wrong.push(`the order's document: ${JSON.stringify(doc1)}`);
    const leftA = await stockOf(slugA);
    if (leftA !== 1) wrong.push(`site stock after one order of two units: ${leftA}, not 1`);

    // 4) the same request answers the same order and key; the same key with another body is refused
    const replay = await site.post('/api/storefront/v1/orders', body1);
    if (replay.status !== 201 || replay.body.data?.order?.number !== order1.number || replay.body.data?.accessKey !== key1) {
      wrong.push(`a replay: ${replay.status} ${replay.body.data?.order?.number}`);
    }
    const reused = await site.post('/api/storefront/v1/orders', { ...body1, note: 'دیگر' });
    if (reused.status !== 422 || reused.body.code !== 'STOREFRONT_REQUEST_KEY_REUSED') wrong.push(`a reused key: ${reused.status} ${reused.body.code}`);
    if ((await stockOf(slugA)) !== 1) wrong.push('a replay reserved stock again');

    // 5) the key: a wrong one and an unknown number are the same 404
    const noKey = await site.get(`/api/storefront/v1/orders/${order1.number}`);
    const wrongKey = await site.get(`/api/storefront/v1/orders/${order1.number}`, `${key1.slice(0, -1)}${key1.endsWith('a') ? 'b' : 'a'}`);
    const unknown = await site.get('/api/storefront/v1/orders/999999999', key1);
    if (noKey.status !== 404 || wrongKey.status !== 404 || unknown.status !== 404) wrong.push(`order reads without the key: ${noKey.status} ${wrongKey.status} ${unknown.status}`);
    const mine = await site.get(`/api/storefront/v1/orders/${order1.number}`, key1);
    if (mine.status !== 200 || mine.body.data.number !== order1.number) wrong.push(`order read with the key: ${mine.status}`);

    // 6) two buyers race for the last unit: one order, one 409
    const raced = await Promise.all([
      site.post('/api/storefront/v1/orders', buyer(`0913${tag}`, slugB, `rk-r1-${tag}-checkout`)),
      site.post('/api/storefront/v1/orders', buyer(`0914${tag}`, slugB, `rk-r2-${tag}-checkout`)),
    ]);
    const won = raced.filter(r => r.status === 201);
    const lost = raced.filter(r => r.status === 409 && r.body.code === 'STOREFRONT_OUT_OF_STOCK');
    if (won.length !== 1 || lost.length !== 1) wrong.push(`the last unit: ${raced.map(r => `${r.status} ${r.body.code ?? ''}`).join(' / ')}`);
    const winner = won[0]?.body.data?.order;
    if (winner) {
      const [w] = await orm.select({ id: storefrontOrders.id }).from(storefrontOrders).where(eq(storefrontOrders.orderNumber, winner.number));
      orderIds.push(w.id);
    }

    // 7) a receipt with another amount cannot be confirmed; rejecting it reopens the order
    const nowIso = new Date().toISOString();
    // a receipt photo must be an image whose bytes prove it; a 1x1 PNG is taken
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const notImage = await site.post(`/api/storefront/v1/orders/${order1.number}/receipts`, { reference: `R${tag}0`, paidAt: nowIso, cardLast4: '1234', amount: PRICE, image: 'data:image/png;base64,PHNjcmlwdD4=' }, key1);
    if (notImage.status !== 422 || notImage.body.details?.field !== 'image') wrong.push(`a receipt photo that is not an image: ${notImage.status} ${JSON.stringify(notImage.body.details)}`);
    const badReceipt = await site.post(`/api/storefront/v1/orders/${order1.number}/receipts`, { reference: `R${tag}1`, paidAt: nowIso, cardLast4: '1234', amount: PRICE, image: PNG }, key1);
    if (badReceipt.status !== 201 || badReceipt.body.data.status !== 'payment_submitted' || badReceipt.body.data.payment !== null) {
      wrong.push(`a receipt: ${badReceipt.status} ${JSON.stringify(badReceipt.body)}`);
    }
    const again = await site.post(`/api/storefront/v1/orders/${order1.number}/receipts`, { reference: `R${tag}9`, paidAt: nowIso, cardLast4: '1234', amount: payable }, key1);
    if (again.status !== 409 || again.body.code !== 'STOREFRONT_RECEIPT_NOT_EXPECTED') wrong.push(`a second receipt while one waits: ${again.status} ${again.body.code}`);
    let detail = (await erp.get(`/api/storefront/orders/${row1.id}`)).body.data;
    const firstReceipt = detail?.receipts?.[0];
    const photo = await erp.get(`/api/storefront/orders/${row1.id}/receipts/${firstReceipt?.id}/image`);
    if (!firstReceipt?.hasImage || photo.status !== 200 || photo.headers['content-type'] !== 'image/png') wrong.push(`the receipt photo: ${firstReceipt?.hasImage} ${photo.status} ${photo.headers['content-type']}`);
    const elsewhere = await erp.get(`/api/storefront/orders/${row1.id + 100000}/receipts/${firstReceipt?.id}/image`);
    if (elsewhere.status !== 404) wrong.push(`a receipt photo under another order: ${elsewhere.status}`);
    // the colleagues who handle orders learn of the order and of its receipt
    const notices = await orm.select({ title: notifications.title }).from(notifications).where(eq(notifications.link, `/site-orders?id=${row1.id}`));
    if (!notices.some(n => n.title.includes('سفارش تازه')) || !notices.some(n => n.title.includes('رسید'))) wrong.push(`order notices: ${JSON.stringify(notices.map(n => n.title))}`);
    const mismatch = await erp.post(`/api/storefront/orders/${row1.id}/confirm`, { receiptId: firstReceipt?.id, version: detail?.version });
    if (mismatch.status !== 422 || mismatch.body.code !== 'STOREFRONT_RECEIPT_AMOUNT_MISMATCH') wrong.push(`confirming another amount: ${mismatch.status} ${mismatch.body.code}`);
    const noReason = await erp.post(`/api/storefront/orders/${row1.id}/reject-receipt`, { receiptId: firstReceipt?.id, reason: ' ', version: detail?.version });
    if (noReason.status !== 422) wrong.push(`a reject without a reason: ${noReason.status}`);
    const rejected = await erp.post(`/api/storefront/orders/${row1.id}/reject-receipt`, { receiptId: firstReceipt?.id, reason: 'مبلغ کم است', version: detail?.version });
    if (rejected.status !== 200 || rejected.body.data.status !== 'awaiting_payment') wrong.push(`reject: ${rejected.status} ${JSON.stringify(rejected.body)}`);
    const buyerAfterReject = (await site.get(`/api/storefront/v1/orders/${order1.number}`, key1)).body.data;
    if (buyerAfterReject?.receipts?.[0]?.rejectReason !== 'مبلغ کم است' || !buyerAfterReject?.canSendReceipt) wrong.push(`the buyer after a reject: ${JSON.stringify(buyerAfterReject?.receipts)}`);
    if ((await stockOf(slugA)) !== 1) wrong.push('a rejected receipt released the reservation');

    // 8) the right receipt; a holder of site_orders.manage alone cannot confirm; the admin can
    const goodReceipt = await site.post(`/api/storefront/v1/orders/${order1.number}/receipts`, { reference: `R${tag}2`, paidAt: nowIso, cardLast4: '1234', amount: payable }, key1);
    if (goodReceipt.status !== 201) wrong.push(`the second receipt: ${goodReceipt.status} ${JSON.stringify(goodReceipt.body)}`);
    detail = (await erp.get(`/api/storefront/orders/${row1.id}`)).body.data;
    const pending = (detail?.receipts ?? []).find((r: Body) => r.status === 'pending');
    if (!pending) throw new Error(`no pending receipt to confirm: ${wrong.join('; ')} ${JSON.stringify(detail?.receipts)}`);
    const role = await createTestRole({ permissions: ['site_orders.view', 'site_orders.manage'] });
    const clerk = as(await loginTestUserWithSession(app, (await createTestUser({ role: role.code })).username));
    const clerkConfirm = await clerk.post(`/api/storefront/orders/${row1.id}/confirm`, { receiptId: pending?.id, version: detail?.version });
    if (clerkConfirm.status !== 403 || clerkConfirm.body.code !== 'STOREFRONT_CONFIRM_FORBIDDEN') wrong.push(`confirm without treasury keys: ${clerkConfirm.status} ${clerkConfirm.body.code}`);
    const viewRole = await createTestRole({ permissions: ['site_orders.view'] });
    const viewer = as(await loginTestUserWithSession(app, (await createTestUser({ role: viewRole.code })).username));
    const viewerCancel = await viewer.post(`/api/storefront/orders/${row1.id}/cancel`, { version: detail?.version });
    if (viewerCancel.status !== 403) wrong.push(`cancel by a viewer: ${viewerCancel.status}`);
    const stale = await erp.post(`/api/storefront/orders/${row1.id}/confirm`, { receiptId: pending?.id, version: Number(detail?.version) - 1 });
    if (stale.status !== 409) wrong.push(`a stale confirm: ${stale.status}`);
    const confirmed = await erp.post(`/api/storefront/orders/${row1.id}/confirm`, { receiptId: pending?.id, version: detail?.version });
    if (confirmed.status !== 200 || confirmed.body.data.status !== 'paid') wrong.push(`confirm: ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
    const [doc1After] = await orm.select({ status: documents.status }).from(documents).where(eq(documents.id, row1.documentId));
    if (doc1After?.status !== 'final') wrong.push(`the document is not a final invoice after confirm: ${doc1After?.status}`);
    const [accepted] = await orm.select().from(storefrontPaymentReceipts).where(eq(storefrontPaymentReceipts.id, Number(pending?.id)));
    const [posted] = accepted?.treasuryTransactionId
      ? await orm.select().from(treasuryTransactions).where(eq(treasuryTransactions.id, accepted.treasuryTransactionId))
      : [];
    if (accepted?.status !== 'accepted' || !posted || fin(posted.amount).toString() !== payable || posted.documentId !== row1.documentId) {
      wrong.push(`the treasury receipt: ${JSON.stringify({ status: accepted?.status, amount: posted ? fin(posted.amount).toString() : null, doc: posted?.documentId })}`);
    }
    const twice = await erp.post(`/api/storefront/orders/${row1.id}/confirm`, { receiptId: pending?.id, version: confirmed.body.data?.version });
    if (twice.status !== 409) wrong.push(`confirming twice: ${twice.status}`);
    const paidView = (await site.get(`/api/storefront/v1/orders/${order1.number}`, key1)).body.data;
    if (paidView?.status !== 'paid' || paidView?.payment !== null || paidView?.canSendReceipt !== false) wrong.push(`the buyer after confirm: ${JSON.stringify({ s: paidView?.status, p: paidView?.payment })}`);

    // 9) shipped with a tracking code, then delivered; a delivered order cannot ship again
    const shipped = await erp.post(`/api/storefront/orders/${row1.id}/fulfil`, { status: 'shipped', trackingCode: 'PST-123', version: confirmed.body.data?.version });
    if (shipped.status !== 200 || shipped.body.data.trackingCode !== 'PST-123') wrong.push(`ship: ${shipped.status} ${JSON.stringify(shipped.body)}`);
    const delivered = await erp.post(`/api/storefront/orders/${row1.id}/fulfil`, { status: 'delivered', trackingCode: '', version: shipped.body.data?.version });
    if (delivered.status !== 200 || delivered.body.data.status !== 'delivered') wrong.push(`deliver: ${delivered.status}`);
    const reship = await erp.post(`/api/storefront/orders/${row1.id}/fulfil`, { status: 'shipped', trackingCode: '', version: delivered.body.data?.version });
    if (reship.status !== 409) wrong.push(`shipping a delivered order: ${reship.status}`);

    // 10) the raced order runs out of time: cancelled as expired, its proforma voided and the last unit free again
    if (winner) {
      await orm.update(storefrontOrders).set({ reserveUntil: new Date(Date.now() - 60_000).toISOString() }).where(eq(storefrontOrders.orderNumber, winner.number));
      if ((await stockOf(slugB)) !== 0) wrong.push('the raced unit was not reserved');
      await expireDueOrdersOnce();
      const [gone] = await orm.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, winner.number));
      const [goneDoc] = await orm.select({ isDeleted: documents.isDeleted }).from(documents).where(eq(documents.id, gone.documentId));
      if (gone.status !== 'cancelled' || gone.cancelReason !== 'expired' || goneDoc?.isDeleted !== 1) wrong.push(`expiry: ${gone.status} ${gone.cancelReason} doc ${goneDoc?.isDeleted}`);
      if ((await stockOf(slugB)) !== 1) wrong.push(`site stock after expiry: ${await stockOf(slugB)}, not 1`);
    }

    // 11) the ERP list finds the order by phone
    const list = await erp.get(`/api/storefront/orders?q=${phone1}`);
    if (list.status !== 200 || !(list.body.data ?? []).some((r: Body) => r.number === order1.number)) wrong.push(`the ERP list by phone: ${list.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'ordering answered 404 while its switch was off; a price in the request was refused; an order made a reserving proforma priced by the server with the exact buyer fields; a replay answered the same order and key, a reused key with another body 422; a wrong key and an unknown number were the same 404; two buyers racing for the last unit got one order and one 409; a receipt of another amount could not be confirmed and its reject reopened the order; confirming without the treasury and finalize keys was 403, a stale version 409, and the admin confirm made an invoice with a treasury receipt of the payable amount; ship and deliver moved in order; an expired order was cancelled, its proforma voided and the unit free again',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? `${err.message} ${err.stack ?? ''}` : String(err),
    }));
  } finally {
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
