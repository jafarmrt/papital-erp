import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor, type DbTransaction } from '../../db/drizzle.js';
import { storefrontOrders } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { money } from '../../lib/money.js';
import {
  ADDRESS_MAX, ADDRESS_MIN, BUYER_NOTE_MAX, CITY_MAX, OPEN_ORDER_STATUSES, RECIPIENT_NAME_MAX, cartLinesError, cleanText, isIranProvince,
  normalizeMobile, normalizePostalCode,
} from '../../lib/storefront/storefrontOrderRules.js';
import type { PlaceOrderRequest, PlacedOrder, ShippingQuoteAnswer, ShippingQuoteRequest } from '../../lib/storefront/storefrontOrderContracts.js';
import type { StorefrontSettingsInput } from '../../lib/storefront/storefrontContracts.js';
import { DocumentService } from '../document.service.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';
import { STOREFRONT_BOT_USER, resolveSiteCustomer } from './storefrontCustomer.js';
import { priceCart, shippingOptions } from './storefrontOrderCart.js';
import { isOrderAccessKey, newAccessSalt, orderAccessKey, requestHashOf } from './storefrontOrderKeys.js';
import { notifySiteOrder } from './storefrontOrderNotices.js';
import { buyerOrderView, type OrderRecord } from './storefrontOrderView.js';
import { storefrontSellable, storefrontWarehouseCode } from './storefrontStock.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';

/**
 * v11 phase 8.2a (start plan §4): placing a site order, in one transaction. The server prices the cart (the request's
 * amounts are never read), locks the phone's open orders and then every item of the cart at once, in id order
 * (`AGENTS.md` §2.6), checks the sellable stock of the site's warehouse, finds or makes the customer and issues a sales
 * proforma (`invoice` in status `proforma`), which reserves the stock (§4.7) until the payment is confirmed or the
 * reservation ends. The proforma is issued through `DocumentService`, so the documents package keeps its own rules; it is
 * not sent to the approval workflow (start plan decision 2: confirming the payment is the approval). A repeat of the same
 * request key and body answers the same order and key; the same key with another body is refused.
 */
const ORDER_NOTE_PREFIX = 'سفارش سایت';

interface CleanOrder {
  requestKey: string;
  recipientName: string;
  phone: string;
  phoneKey: string;
  province: string;
  city: string;
  address: string;
  postalCode: string;
  note: string;
  shippingMethod: string;
  lines: Array<{ slug: string; quantity: number }>;
}

const fieldError = (field: string, message: string) => new ValidationError(message, { field }, 'STOREFRONT_ORDER_FIELD_INVALID');

/** The request with every field normalized, or the first field's reason (each error names its field for the form) */
export function cleanOrderRequest(input: PlaceOrderRequest): CleanOrder {
  const requestKey = String(input.requestKey ?? '').trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestKey)) throw fieldError('requestKey', 'شناسهٔ درخواست نامعتبر است.');
  const recipientName = cleanText(input.recipientName, RECIPIENT_NAME_MAX);
  if (!recipientName || recipientName.length < 2) throw fieldError('recipientName', 'نام و نام خانوادگی گیرنده را بنویسید.');
  const phone = normalizeMobile(input.phone);
  if (!phone) throw fieldError('phone', 'شمارهٔ همراه باید ۱۱ رقم و با ۰۹ آغاز شود.');
  const province = String(input.province ?? '').trim();
  if (!isIranProvince(province)) throw fieldError('province', 'استان را از فهرست انتخاب کنید.');
  const city = cleanText(input.city, CITY_MAX);
  if (!city) throw fieldError('city', 'شهر را بنویسید.');
  const address = cleanText(input.address, ADDRESS_MAX, { multiline: true });
  if (!address || address.length < ADDRESS_MIN) throw fieldError('address', 'نشانی کامل را بنویسید (خیابان، کوچه، پلاک و واحد).');
  const postalCode = normalizePostalCode(input.postalCode);
  if (!postalCode) throw fieldError('postalCode', 'کد پستی باید ۱۰ رقم باشد.');
  const noteText = String(input.note ?? '').trim();
  const note = noteText ? cleanText(noteText, BUYER_NOTE_MAX, { multiline: true }) : '';
  if (note === null) throw fieldError('note', `توضیح سفارش حداکثر ${BUYER_NOTE_MAX.toLocaleString('fa-IR')} نویسه است.`);
  const shippingMethod = String(input.shippingMethod ?? '').trim();
  if (!shippingMethod) throw fieldError('shippingMethod', 'روش ارسال را انتخاب کنید.');
  const lines = (Array.isArray(input.lines) ? input.lines : []).map(l => ({ slug: String(l?.slug ?? '').trim(), quantity: Number(l?.quantity) }));
  const linesError = cartLinesError(lines);
  if (linesError) throw fieldError('lines', linesError);
  return { requestKey, recipientName, phone, phoneKey: phoneMatchKey(phone), province, city, address, postalCode, note, shippingMethod, lines };
}

async function settingsForOrders(executor: DbExecutor): Promise<StorefrontSettingsInput> {
  const settings = await storefrontSettingValues(executor);
  if (!settings.enabled || !settings.ordersEnabled) throw new NotFoundError('پیدا نشد');
  return settings;
}

/** `POST /shipping/quote`: the methods a cart can use for a province */
export async function quoteShipping(input: ShippingQuoteRequest): Promise<ShippingQuoteAnswer> {
  const settings = await settingsForOrders(orm);
  const province = String(input.province ?? '').trim();
  if (!isIranProvince(province)) throw fieldError('province', 'استان را از فهرست انتخاب کنید.');
  const lines = (Array.isArray(input.lines) ? input.lines : []).map(l => ({ slug: String(l?.slug ?? '').trim(), quantity: Number(l?.quantity) }));
  const linesError = cartLinesError(lines);
  if (linesError) throw fieldError('lines', linesError);
  const cart = await priceCart(orm, settings, lines);
  return { itemsAmount: cart.itemsAmount, options: await shippingOptions(orm, settings, cart, province) };
}

async function findByRequestKey(executor: DbExecutor, requestKey: string): Promise<OrderRecord | undefined> {
  const [row] = await executor.select().from(storefrontOrders).where(eq(storefrontOrders.requestKey, requestKey));
  return row;
}

async function replay(existing: OrderRecord, requestHash: string): Promise<PlacedOrder> {
  if (existing.requestHash !== requestHash) {
    throw new ValidationError('این شناسهٔ درخواست پیش‌تر برای سفارش دیگری به کار رفته است.', undefined, 'STOREFRONT_REQUEST_KEY_REUSED');
  }
  return { order: await buyerOrderView(orm, existing, await storefrontSettingValues(orm)), accessKey: orderAccessKey(existing.orderNumber, existing.accessSalt) };
}

const isRequestKeyViolation = (err: unknown): boolean => {
  const pg = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const e = pg?.code ? pg : pg?.cause;
  return e?.code === '23505' && e?.constraint === 'uq_storefront_orders_request_key';
};

export async function placeOrder(input: PlaceOrderRequest): Promise<PlacedOrder> {
  const order = cleanOrderRequest(input);
  const requestHash = requestHashOf({ ...order, requestKey: undefined });
  const existing = await findByRequestKey(orm, order.requestKey);
  if (existing) return replay(existing, requestHash);
  try {
    const placed = await orm.transaction(tx => placeInTransaction(tx, order, requestHash));
    return placed;
  } catch (err) {
    if (!isRequestKeyViolation(err)) throw err;
    const raced = await findByRequestKey(orm, order.requestKey);
    if (!raced) throw err;
    return replay(raced, requestHash);
  }
}

async function placeInTransaction(tx: DbTransaction, order: CleanOrder, requestHash: string): Promise<PlacedOrder> {
  const settings = await settingsForOrders(tx);
  // one phone's orders one at a time, so the open-orders limit holds under concurrent requests; then the items (§2.6)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`storefront-phone:${order.phoneKey}`}))`);
  const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(storefrontOrders)
    .where(and(eq(storefrontOrders.phoneKey, order.phoneKey), inArray(storefrontOrders.status, [...OPEN_ORDER_STATUSES])));
  if (open >= settings.openOrdersPerPhone) {
    throw new ConflictError('برای این شمارهٔ همراه سفارش پرداخت‌نشدهٔ دیگری هست؛ اول آن را پرداخت کنید یا منتظر پایان مهلتش بمانید.', undefined, 'STOREFRONT_TOO_MANY_OPEN_ORDERS');
  }

  const cart = await priceCart(tx, settings, order.lines);
  await lockStockItems(tx, cart.lines.map(l => l.item.itemId));
  const warehouse = await storefrontWarehouseCode(tx, settings.warehouseCode);
  const sellable = await storefrontSellable(tx, cart.lines.map(l => l.item.itemId), settings.warehouseCode);
  const short = cart.lines.filter(l => (sellable.get(l.item.itemId) ?? 0) < l.quantity)
    .map(l => {
      // the count only when the site shows counts; otherwise only «none left» (0) or «fewer than asked» (null)
      const available = Math.max(0, Math.floor(sellable.get(l.item.itemId) ?? 0));
      return { slug: l.item.slug, available: settings.stockDisplay === 'count' || available === 0 ? available : null };
    });
  if (short.length > 0) {
    throw new ConflictError('موجودی برخی کالاها کمتر از تعداد سفارش است.', { lines: short }, 'STOREFRONT_OUT_OF_STOCK');
  }

  const option = (await shippingOptions(tx, settings, cart, order.province)).find(o => o.code === order.shippingMethod);
  if (!option) throw fieldError('shippingMethod', 'این روش ارسال برای این سبد و استان در دسترس نیست؛ روش دیگری انتخاب کنید.');
  const shippingAmount = option.kind === 'cost' ? option.amount : '0';
  const payable = (BigInt(cart.itemsAmount) + BigInt(shippingAmount)).toString();

  const [{ value: sequence }] = (await tx.execute(sql`SELECT nextval('storefront_order_number_seq')::text AS value`)).rows as Array<{ value: string }>;
  const orderNumber = String(sequence);
  const customer = await resolveSiteCustomer(tx, `سفارش سایت ${orderNumber}`, { name: order.recipientName, phone: order.phone, city: order.city, address: order.address });
  const fullAddress = `${order.province}، ${order.city}، ${order.address}، کد پستی ${order.postalCode}`;
  const documentId = await DocumentService.createDocument({
    docType: 'invoice', status: 'proforma', inOut: 'out', user: STOREFRONT_BOT_USER,
    partyId: customer.id, buyerName: customer.name, buyerPhone: order.phone, buyerCity: order.city, buyerAddress: fullAddress,
    notes: `${ORDER_NOTE_PREFIX} ${orderNumber}، ارسال: ${option.title}${option.kind === 'on_delivery' ? ' (هزینه در محل)' : ''}`,
    currency: 'IRR', vatAmount: 0, vatPercent: 0, serviceChargeAmount: shippingAmount,
    items: cart.lines.map(l => ({ itemId: l.item.itemId, quantity: l.quantity, unit_price: Number(l.unitPrice), location: warehouse })),
    location: warehouse, externalTx: tx,
  });
  const storedDocument = await DocumentService.documentAuditSnapshot(tx, documentId);
  await logActivity({
    tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'اسناد انبار', entityId: documentId,
    description: `ثبت پیش‌فاکتور فروش شماره "${storedDocument?.refNumber ?? documentId}" از سفارش سایت ${orderNumber}`,
    details: { after: storedDocument, storefrontOrder: orderNumber, ...DocumentService.documentLineSummary(storedDocument) },
  });

  const [row] = await tx.insert(storefrontOrders).values({
    orderNumber, accessSalt: newAccessSalt(), requestKey: order.requestKey, requestHash, documentId, customerId: customer.id,
    status: 'awaiting_payment', recipientName: order.recipientName, phone: order.phone, phoneKey: order.phoneKey,
    province: order.province, city: order.city, address: order.address, postalCode: order.postalCode, buyerNote: order.note,
    shippingMethodCode: option.code, shippingMethodTitle: option.title, shippingOnDelivery: option.kind === 'on_delivery' ? 1 : 0,
    shippingAmount: money(shippingAmount), itemsAmount: money(cart.itemsAmount), payableAmount: money(payable),
    reserveUntil: sql`now() + make_interval(hours => ${settings.reservationHours})`,
    updatedBy: STOREFRONT_BOT_USER,
  }).returning();
  await logActivity({
    tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'سفارش سایت', entityId: row.id,
    description: `ثبت سفارش سایت ${orderNumber} با پیش‌فاکتور «${storedDocument?.refNumber ?? documentId}»`,
    details: {
      after: {
        orderNumber, documentId, customerId: customer.id, shippingMethod: option.code, itemsAmount: cart.itemsAmount,
        shippingAmount, payableAmount: payable, reserveUntil: row.reserveUntil,
      },
    },
  });
  await notifySiteOrder(tx, 'placed', row);
  return { order: await buyerOrderView(tx, row, settings), accessKey: orderAccessKey(orderNumber, row.accessSalt) };
}

/** An order of the buyer who holds its key; a missing order and a wrong key are the same 404 */
export async function orderForKey(executor: DbExecutor, orderNumber: string, accessKey: string, options: { lock?: boolean } = {}): Promise<OrderRecord> {
  const notFound = new NotFoundError('سفارش پیدا نشد.', undefined, 'STOREFRONT_ORDER_NOT_FOUND');
  if (!/^\d{6,12}$/.test(orderNumber)) throw notFound;
  const query = executor.select().from(storefrontOrders).where(eq(storefrontOrders.orderNumber, orderNumber));
  const [row] = options.lock ? await query.for('update') : await query;
  if (!row || !isOrderAccessKey(row.orderNumber, row.accessSalt, accessKey)) throw notFound;
  return row;
}
