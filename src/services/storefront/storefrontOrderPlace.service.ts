import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm, type DbExecutor, type DbTransaction } from '../../db/drizzle.js';
import { customers, storefrontOrders } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { phoneMatchKey } from '../../lib/search/phoneMatchKey.js';
import { money } from '../../lib/money.js';
import {
  ADDRESS_MAX, ADDRESS_MIN, BUYER_NOTE_MAX, CITY_MAX, GIFT_MESSAGE_MAX, OPEN_ORDER_STATUSES, RECIPIENT_NAME_MAX, RETAIL_LINE_CAP_MESSAGE, cartLinesError, cleanText,
  isIranProvince, isPaymentMethod, normalizeMobile, normalizePostalCode, retailLineOverCap, type CartLineInput, type PaymentMethod, payableWith,
} from '../../lib/storefront/storefrontOrderRules.js';
import type { PlaceOrderRequest, PlacedOrder, ShippingQuoteAnswer, ShippingQuoteRequest } from '../../lib/storefront/storefrontOrderContracts.js';
import type { StorefrontSettingsInput } from '../../lib/storefront/storefrontContracts.js';
import { DocumentService } from '../document.service.js';
import { lockStockItems } from '../inventory/stockItemLocks.js';
import { STOREFRONT_BOT_USER, resolveSiteCustomer } from './storefrontCustomer.js';
import { activeGroupOf, sessionAccount, type AccountRecord, type GroupRecord } from './storefrontBuyerAuth.service.js';
import { isProofRefusal, proveOrderBuyer, type OrderProof } from './storefrontOrderProof.js';
import { inboxKey, normalizeEmail } from '../../lib/storefront/storefrontEmailRules.js';
import { priceCart, shippingOptions } from './storefrontOrderCart.js';
import { isOrderAccessKey, newAccessSalt, orderAccessKey, requestHashOf } from './storefrontOrderKeys.js';
import { notifySiteOrder } from './storefrontOrderNotices.js';
import { buyerOrderView, type OrderRecord } from './storefrontOrderView.js';
import { storefrontSellable, storefrontWarehouseCode } from './storefrontStock.js';
import { storefrontSettingValues } from './storefrontSettings.service.js';
import { queueOrderSms } from './storefrontSms.service.js';
import { appliedDiscount, chooseDiscount, redeemDiscount, type DiscountChoice } from './storefrontDiscountApply.js';
import { normalizeDiscountCode, spreadDiscount } from '../../lib/storefront/storefrontDiscountRules.js';
import { keepOrderAddress } from './storefrontBuyerAddresses.service.js';

/**
 * v11 phase 8.2a (start plan §4): placing a site order, in one transaction. The server prices the cart (the request's
 * amounts are never read), locks the phone's open orders and then every item of the cart at once, in id order
 * (`AGENTS.md` §2.6), checks the sellable stock of the site's warehouse, finds or makes the customer and issues a sales
 * proforma (`invoice` in status `proforma`), which reserves the stock (§4.7) until the payment is confirmed or the
 * reservation ends. The proforma is issued through `DocumentService`, so the documents package keeps its own rules; it is
 * not sent to the approval workflow (start plan decision 2: confirming the payment is the approval). A repeat of the same
 * request key and body answers the same order and key; the same key with another body is refused.
 *
 * v12 phase 7 (site review 1.3): while the site signs in by SMS, a guest's order presents a phone proof for its phone
 * (`POST /auth/otp/verify`), used up in the order's own transaction, so a refused order (no stock, a code that ran out)
 * leaves the proof for the next try. The proof is not part of the request hash: a lost answer repeated with the same key
 * replays the order without a second proof. A signed-in account orders without one. While the texts are off nothing
 * changes. A retail buyer orders at most `RETAIL_LINE_QUANTITY_MAX` of an item; a wholesale group keeps the cart limit.
 *
 * v12 phase 8c (site review 2.5, owner's decision 13): the buyer apart from the recipient. `phone` is the buyer's mobile
 * (the customer, the texts, the proof and the open-orders limit go by it) and `buyerName` the buyer's name, whom the
 * customer is named after; the recipient's name, own mobile (`recipientPhone`, a contact for the courier only) and
 * address go on the order and the proforma's shipping address. A gift is free, and its card's message stays on the order.
 * A signed-in buyer may keep the address in the account's address book, in the order's own transaction. Each new field
 * enters the request hash only when given, so the hash of an order without them is as before.
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
  paymentMethod: PaymentMethod;
  /** v11 phase 8.2c: the code as normalized; left out when none, so the hash of an order without one is as before */
  discountCode?: string;
  /** v12 phase 8c: left out when the buyer is the recipient, the recipient's phone the buyer's, or no gift */
  buyerName?: string;
  recipientPhone?: string;
  gift?: true;
  giftMessage?: string;
  saveAddress?: true;
  /** v12 phase 8e: the buyer's email as typed and normalized; left out when none, so the hash of an order without one is as before */
  email?: string;
}

/** v12 phase 7 and 8e: the guest's proofs, kept out of `CleanOrder` so the request hash never carries them */
const proofsOf = (input: PlaceOrderRequest) => ({ phoneProof: String(input.phoneProof ?? '').trim(), emailProof: String(input.emailProof ?? '').trim() });

const fieldError = (field: string, message: string) => new ValidationError(message, { field }, 'STOREFRONT_ORDER_FIELD_INVALID');

/** A typed discount code normalized, '' for none, or a 422 on `discountCode` when it cannot be a code */
function typedDiscountCode(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const code = normalizeDiscountCode(text);
  if (!code) throw new ValidationError('این کد تخفیف شناخته نیست یا دیگر کار نمی‌کند.', { field: 'discountCode' }, 'STOREFRONT_DISCOUNT_NOT_APPLICABLE');
  return code;
}

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
  const paymentMethod = input.paymentMethod === undefined || input.paymentMethod === null ? 'card' : input.paymentMethod;
  if (!isPaymentMethod(paymentMethod)) throw fieldError('paymentMethod', 'روش پرداخت را انتخاب کنید.');
  const discountCode = typedDiscountCode(input.discountCode);
  // v12 phase 8c: the buyer apart from the recipient, and a gift
  const buyerText = String(input.buyerName ?? '').trim();
  const buyerName = buyerText ? cleanText(buyerText, RECIPIENT_NAME_MAX) : recipientName;
  if (!buyerName || buyerName.length < 2) throw fieldError('buyerName', 'نام و نام خانوادگی خریدار را بنویسید.');
  const recipientText = String(input.recipientPhone ?? '').trim();
  const recipientPhone = recipientText ? normalizeMobile(recipientText) : '';
  if (recipientPhone === null) throw fieldError('recipientPhone', 'شمارهٔ همراه گیرنده باید ۱۱ رقم و با ۰۹ آغاز شود.');
  const gift = input.gift === true;
  const giftText = gift ? String(input.giftMessage ?? '').trim() : '';
  const giftMessage = giftText ? cleanText(giftText, GIFT_MESSAGE_MAX, { multiline: true }) : '';
  if (giftMessage === null) throw fieldError('giftMessage', `پیام کارت هدیه حداکثر ${GIFT_MESSAGE_MAX.toLocaleString('fa-IR')} نویسه است.`);
  const emailText = String(input.email ?? '').trim();
  const email = emailText ? normalizeEmail(emailText) : '';
  if (emailText && !email) throw fieldError('email', 'نشانی ایمیل را درست بنویسید (مانند name@example.com).');
  return {
    requestKey, recipientName, phone, phoneKey: phoneMatchKey(phone), province, city, address, postalCode, note, shippingMethod, lines, paymentMethod,
    ...(discountCode ? { discountCode } : {}),
    ...(buyerName !== recipientName ? { buyerName } : {}),
    ...(recipientPhone && recipientPhone !== phone ? { recipientPhone } : {}),
    ...(gift ? { gift: true as const } : {}),
    ...(giftMessage ? { giftMessage } : {}),
    ...(input.saveAddress === true ? { saveAddress: true as const } : {}),
    ...(email ? { email } : {}),
  };
}

/**
 * v11 phase 8.2b part 2: who is ordering. A live session links the order to its account; an approved account of an
 * active group orders with the group's prices and rules, and only it may pay «به حساب» when its group allows it. A
 * session that is not live is ignored (the order is a guest's), so a stale cookie never blocks a purchase.
 */
interface OrderBuyer {
  account: AccountRecord | null;
  group: GroupRecord | null;
}

async function orderBuyer(executor: DbExecutor, rawSession: unknown): Promise<OrderBuyer> {
  const account = await sessionAccount(executor, rawSession);
  return { account, group: account ? await activeGroupOf(executor, account) : null };
}

/** v12 phase 7 (site review 1.3, 2.10): a buyer without a live group orders at most the retail cap of each item */
function assertRetailCap(buyer: OrderBuyer, lines: readonly CartLineInput[]): void {
  if (buyer.group) return;
  const slug = retailLineOverCap(lines);
  if (slug !== null) throw new ValidationError(RETAIL_LINE_CAP_MESSAGE, { field: 'lines', slug }, 'STOREFRONT_RETAIL_LINE_CAP');
}


function assertPaymentAllowed(buyer: OrderBuyer, method: PaymentMethod): void {
  const group = buyer.group;
  const allowed = method === 'card' ? !group || group.allowCard === 1 : Boolean(group && group.allowOnAccount === 1);
  if (!allowed) {
    throw fieldError('paymentMethod', method === 'card'
      ? 'پرداخت کارت‌به‌کارت برای گروه خرید شما باز نیست؛ «به حساب» را انتخاب کنید.'
      : 'پرداخت «به حساب» فقط برای حساب‌های خرید عمده‌ای است که فروشگاه برایشان باز کرده است.');
  }
}

async function settingsForOrders(executor: DbExecutor): Promise<StorefrontSettingsInput> {
  const settings = await storefrontSettingValues(executor);
  if (!settings.enabled || !settings.ordersEnabled) throw new NotFoundError('پیدا نشد');
  return settings;
}

/** `POST /shipping/quote`: the methods a cart can use for a province */
export async function quoteShipping(input: ShippingQuoteRequest, rawSession?: unknown): Promise<ShippingQuoteAnswer> {
  const settings = await settingsForOrders(orm);
  const buyer = await orderBuyer(orm, rawSession);
  const province = String(input.province ?? '').trim();
  if (!isIranProvince(province)) throw fieldError('province', 'استان را از فهرست انتخاب کنید.');
  const lines = (Array.isArray(input.lines) ? input.lines : []).map(l => ({ slug: String(l?.slug ?? '').trim(), quantity: Number(l?.quantity) }));
  const linesError = cartLinesError(lines);
  if (linesError) throw fieldError('lines', linesError);
  assertRetailCap(buyer, lines);
  const cart = await priceCart(orm, settings, lines, buyer.group);
  const code = typedDiscountCode(input.discountCode);
  // the quote has no phone yet: the phone's own uses and first order are checked again when the order is placed
  const choice = code ? await chooseDiscount(orm, code, cart.itemsAmount, { ...buyer, phoneKey: '' }) : null;
  return {
    itemsAmount: cart.itemsAmount,
    lines: cart.lines.map(l => ({ slug: l.item.slug, quantity: l.quantity, amount: l.lineAmount })),
    discount: choice ? appliedDiscount(choice.code.code, choice.code.title, choice.amount.toString()) : null,
    options: await shippingOptions(orm, settings, cart, province, discountedSubtotal(cart.itemsAmount, choice)),
  };
}

/** The items amount after a code: free shipping is reckoned on what the buyer pays for the items */
const discountedSubtotal = (itemsAmount: string, choice: DiscountChoice | null): string =>
  (BigInt(itemsAmount) - (choice?.amount ?? 0n)).toString();

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

export async function placeOrder(input: PlaceOrderRequest, rawSession?: unknown): Promise<PlacedOrder> {
  const order = cleanOrderRequest(input);
  // the account is part of the request: the same key from another account (or signed out) is another request
  const signedIn = await sessionAccount(orm, rawSession);
  const requestHash = requestHashOf({ ...order, requestKey: undefined, ...(signedIn ? { accountId: signedIn.id } : {}) });
  const existing = await findByRequestKey(orm, order.requestKey);
  if (existing) return replay(existing, requestHash);
  try {
    const placed = await orm.transaction(tx => placeInTransaction(tx, order, requestHash, rawSession, proofsOf(input)));
    return placed;
  } catch (err) {
    // the same request racing itself: the first one used the proof (or the key) and committed; the second answers its order
    if (!isRequestKeyViolation(err) && !isProofRefusal(err)) throw err;
    const raced = await findByRequestKey(orm, order.requestKey);
    if (!raced) throw err;
    return replay(raced, requestHash);
  }
}

async function placeInTransaction(
  tx: DbTransaction, order: CleanOrder, requestHash: string, rawSession: unknown, proofs: { phoneProof: string; emailProof: string },
): Promise<PlacedOrder> {
  const settings = await settingsForOrders(tx);
  const buyer = await orderBuyer(tx, rawSession);
  assertPaymentAllowed(buyer, order.paymentMethod);
  assertRetailCap(buyer, order.lines);
  // before anything is locked, reserved or made: an order without its proof leaves no customer, proforma or text behind
  const proof = await proveOrderBuyer(tx, buyer.account, { phone: order.phone, email: order.email ?? '', ...proofs });
  const { phoneProven } = proof;
  const onAccount = order.paymentMethod === 'on_account';
  // one buyer's orders one at a time, so the open-orders limit holds under concurrent requests; then the items (§2.6).
  // v12 phase 8e: an order proven by an email counts by that email (its phone is nobody's proven word)
  // 8e3 review: by the mailbox (a `+tag` folded), and a phone's count leaves out the email-proven orders typed with it,
  // so a stranger's orders never use up the phone owner's limit
  const byEmail = Boolean(proof.emailKey) && !phoneProven;
  const inbox = byEmail ? inboxKey(proof.emailKey) : '';
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${byEmail ? `storefront-email:${inbox}` : `storefront-phone:${order.phoneKey}`}))`);
  const [{ open }] = await tx.select({ open: sql<number>`count(*)::int` }).from(storefrontOrders)
    .where(and(
      byEmail ? sql`regexp_replace(${storefrontOrders.emailKey}, '[+][^@]*@', '@') = ${inbox}` : and(eq(storefrontOrders.phoneKey, order.phoneKey), eq(storefrontOrders.emailKey, '')),
      inArray(storefrontOrders.status, [...OPEN_ORDER_STATUSES]),
    ));
  if (open >= settings.openOrdersPerPhone) {
    throw new ConflictError(byEmail
      ? 'برای این ایمیل سفارش پرداخت‌نشدهٔ دیگری هست؛ اول آن را پرداخت کنید یا منتظر پایان مهلتش بمانید.'
      : 'برای این شمارهٔ همراه سفارش پرداخت‌نشدهٔ دیگری هست؛ اول آن را پرداخت کنید یا منتظر پایان مهلتش بمانید.', undefined, 'STOREFRONT_TOO_MANY_OPEN_ORDERS');
  }

  // 8e3 review: an email-proven order's discount uses and first order go by its mailbox, never by its unproven phone
  const discountKeys = byEmail ? { phoneKey: `email:${inbox}`, inboxKey: inbox } : { phoneKey: order.phoneKey };
  const cart = await priceCart(tx, settings, order.lines, buyer.group);
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

  // the code under its row lock, so its uses counted here hold until the commit (two orders never take its last use)
  const choice = order.discountCode
    ? await chooseDiscount(tx, order.discountCode, cart.itemsAmount, { ...buyer, ...discountKeys }, { lock: true })
    : null;
  const discountAmount = (choice?.amount ?? 0n).toString();
  const lineDiscounts = spreadDiscount(cart.lines.map(l => BigInt(l.lineAmount)), choice?.amount ?? 0n);
  const option = (await shippingOptions(tx, settings, cart, order.province, discountedSubtotal(cart.itemsAmount, choice))).find(o => o.code === order.shippingMethod);
  if (!option) throw fieldError('shippingMethod', 'این روش ارسال برای این سبد و استان در دسترس نیست؛ روش دیگری انتخاب کنید.');
  const shippingAmount = option.kind === 'cost' ? option.amount : '0';
  const payable = payableWith(cart.itemsAmount, discountAmount, option);

  const [{ value: sequence }] = (await tx.execute(sql`SELECT nextval('storefront_order_number_seq')::text AS value`)).rows as Array<{ value: string }>;
  const orderNumber = String(sequence);
  // an approved buyer's orders go on the customer a colleague linked at approval; any other order finds or makes one by phone
  const customer = await customerOf(tx, buyer, orderNumber, order, byEmail ? proof : null);
  // v12 phase 8c: the proforma's shipping address names the recipient when the buyer is someone else
  const recipientLine = order.buyerName || order.recipientPhone ? `گیرنده: ${order.recipientName}${order.recipientPhone ? ` (${order.recipientPhone})` : ''}، ` : '';
  const fullAddress = `${recipientLine}${order.province}، ${order.city}، ${order.address}، کد پستی ${order.postalCode}`;
  const documentId = await DocumentService.createDocument({
    docType: 'invoice', status: 'proforma', inOut: 'out', user: STOREFRONT_BOT_USER,
    partyId: customer.id, buyerName: customer.name, buyerPhone: order.phone, buyerCity: order.city, buyerAddress: fullAddress,
    notes: `${ORDER_NOTE_PREFIX} ${orderNumber}، ارسال: ${option.title}${option.kind === 'on_delivery' ? ' (هزینه در محل)' : ''}${onAccount ? '، پرداخت به حساب' : ''}${buyer.group ? `، گروه خریدار «${buyer.group.title}»` : ''}${choice ? `، کد تخفیف ${choice.code.code}` : ''}${order.gift ? '، هدیه است (بی قیمت روی بسته)' : ''}`,
    currency: 'IRR', vatAmount: 0, vatPercent: 0, serviceChargeAmount: shippingAmount,
    items: cart.lines.map((l, i) => ({
      itemId: l.item.itemId, quantity: l.quantity, unit_price: Number(l.unitPrice), location: warehouse,
      ...(lineDiscounts[i] > 0n ? { discount: lineDiscounts[i].toString() } : {}),
    })),
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
    status: onAccount ? 'awaiting_approval' : 'awaiting_payment', recipientName: order.recipientName, phone: order.phone, phoneKey: order.phoneKey, phoneProven: phoneProven ? 1 : 0, email: proof.email, emailKey: proof.emailKey,
    province: order.province, city: order.city, address: order.address, postalCode: order.postalCode, buyerNote: order.note,
    shippingMethodCode: option.code, shippingMethodTitle: option.title, shippingOnDelivery: option.kind === 'on_delivery' ? 1 : 0,
    shippingAmount: money(shippingAmount), itemsAmount: money(cart.itemsAmount), payableAmount: money(payable),
    // v12 phase 8b (site review 2.7): an «به حساب» order waits for a colleague's confirmation, longer than a buyer's payment
    reserveUntil: sql`now() + make_interval(hours => ${onAccount ? settings.approvalHours : settings.reservationHours})`,
    buyerAccountId: buyer.account?.id ?? null, buyerGroupId: buyer.group?.id ?? null, paymentMethod: order.paymentMethod,
    discountCodeId: choice?.code.id ?? null, discountCode: choice?.code.code ?? '', discountAmount: money(discountAmount),
    buyerName: order.buyerName ?? '', recipientPhone: order.recipientPhone ?? '', isGift: order.gift ? 1 : 0, giftMessage: order.giftMessage ?? '',
    updatedBy: STOREFRONT_BOT_USER,
  }).returning();
  if (order.saveAddress && buyer.account) await keepOrderAddress(tx, buyer.account.id, order);
  if (choice) await redeemDiscount(tx, choice, { id: row.id, phoneKey: discountKeys.phoneKey, buyerAccountId: row.buyerAccountId });
  // v11 phase 8.4a: the buyer's text, queued with the order (sent after the commit; nothing while sending is off). Its
  // text asks for a card-to-card payment, so an on-account order sends none.
  if (!onAccount) await queueOrderSms(tx, row, 'order_placed');
  await logActivity({
    tx, username: STOREFRONT_BOT_USER, action: 'CREATE', entity: 'سفارش سایت', entityId: row.id,
    description: `ثبت سفارش سایت ${orderNumber} با پیش‌فاکتور «${storedDocument?.refNumber ?? documentId}»`,
    details: {
      after: {
        orderNumber, documentId, customerId: customer.id, shippingMethod: option.code, itemsAmount: cart.itemsAmount,
        shippingAmount, discountCode: row.discountCode, discountAmount, payableAmount: payable, reserveUntil: row.reserveUntil, paymentMethod: order.paymentMethod,
        buyerAccountId: row.buyerAccountId, buyerGroupId: row.buyerGroupId, buyerName: row.buyerName, isGift: row.isGift,
      },
    },
  });
  await notifySiteOrder(tx, 'placed', row);
  return { order: await buyerOrderView(tx, row, settings), accessKey: orderAccessKey(orderNumber, row.accessSalt) };
}

async function customerOf(tx: DbTransaction, buyer: OrderBuyer, orderNumber: string, order: CleanOrder, byEmail: OrderProof | null): Promise<{ id: number; name: string }> {
  if (buyer.group && buyer.account?.customerId) {
    const [linked] = await tx.select({ id: customers.id, name: customers.name }).from(customers)
      .where(and(eq(customers.id, buyer.account.customerId), eq(customers.isDeleted, 0)));
    if (linked) return linked;
  }
  // v12 phase 8c (site review 2.5): the customer is the buyer; a gift's recipient address is not the buyer's own
  const ownAddress = !order.buyerName && !order.recipientPhone;
  return resolveSiteCustomer(tx, `سفارش سایت ${orderNumber}`, {
    name: order.buyerName ?? order.recipientName, phone: order.phone, city: ownAddress ? order.city : '', address: ownAddress ? order.address : '',
    // v12 phase 8e (owner's decision of 21 Aban 1405): an order proven by an email goes on the customer with that email
    ...(byEmail ? { email: byEmail.email } : {}),
  });
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
