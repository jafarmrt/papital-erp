import { toLatinDigits } from '../numericInput.js';
import { IRAN_PROVINCES, digitsOnly, rialAmountText } from './storefrontRules.js';

/**
 * v11 phase 8.2a (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §4, §5, §9الف): the rules of a site order shared by the
 * server, the ERP orders screen and the storefront app. Nothing here reads the database. Every field a buyer types on a
 * phone takes Persian, Arabic or Latin digits (§9الف), and each error is one Persian sentence for that field.
 */
export const ORDER_STATUSES = [
  'awaiting_payment', 'payment_submitted', 'paid', 'awaiting_approval', 'confirmed', 'shipped', 'delivered', 'cancelled',
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ORDER_STATUS_TITLES: Readonly<Record<OrderStatus, string>> = {
  awaiting_payment: 'در انتظار پرداخت',
  payment_submitted: 'در انتظار تأیید پرداخت',
  paid: 'پرداخت‌شده',
  awaiting_approval: 'در انتظار تأیید فروشگاه',
  confirmed: 'تأییدشده (به حساب)',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغوشده',
};
export const isOrderStatus = (value: unknown): value is OrderStatus => ORDER_STATUSES.includes(value as OrderStatus);

/** Orders whose proforma still holds stock: they count towards the open-orders limit and the expiry sweep reads them */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['awaiting_payment', 'payment_submitted', 'awaiting_approval'];
/** Open orders the expiry sweep cancels when their window ends: no receipt is waiting for a colleague */
export const EXPIRING_ORDER_STATUSES: readonly OrderStatus[] = ['awaiting_payment', 'awaiting_approval'];

/**
 * v11 phase 8.2b part 2: how an order is paid. «کارت‌به‌کارت» is open to everyone; «به حساب» only to a signed-in account
 * of a buyer group that allows it. An on-account order sends no receipt: a colleague confirms it into the invoice.
 */
export const PAYMENT_METHODS = ['card', 'on_account'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export const PAYMENT_METHOD_TITLES: Readonly<Record<PaymentMethod, string>> = { card: 'کارت‌به‌کارت', on_account: 'به حساب' };
export const isPaymentMethod = (value: unknown): value is PaymentMethod => PAYMENT_METHODS.includes(value as PaymentMethod);

export const CANCEL_REASONS = ['expired', 'staff'] as const;
export type CancelReason = typeof CANCEL_REASONS[number];
export const CANCEL_REASON_TITLES: Readonly<Record<CancelReason, string>> = {
  expired: 'مهلت پرداخت گذشت',
  staff: 'لغو به دست فروشگاه',
};

export const RECEIPT_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type ReceiptStatus = typeof RECEIPT_STATUSES[number];
export const RECEIPT_STATUS_TITLES: Readonly<Record<ReceiptStatus, string>> = {
  pending: 'در انتظار بررسی',
  accepted: 'تأییدشده',
  rejected: 'ردشده',
};

/** At most this many receipts per order (a rejected one may be sent again) */
export const RECEIPTS_PER_ORDER_MAX = 3;
/** Distinct items in one order, and units of one item */
export const ORDER_LINES_MAX = 50;
export const ORDER_LINE_QUANTITY_MAX = 99;
/** The open (unpaid) orders one phone number may hold at once (start plan §8: orders made only to lock stock) */
export const OPEN_ORDERS_PER_PHONE_DEFAULT = 3;
export const OPEN_ORDERS_PER_PHONE_MAX = 20;

export const RECIPIENT_NAME_MAX = 80;
export const CITY_MAX = 60;
export const ADDRESS_MIN = 10;
export const ADDRESS_MAX = 400;
export const BUYER_NOTE_MAX = 500;
export const REJECT_REASON_MAX = 300;
export const TRACKING_CODE_MAX = 40;

/** An Iranian mobile number as `09xxxxxxxxx`, from any of 0912…, +98912…, 0098912…, 912… with any digits; else null */
export function normalizeMobile(raw: string): string | null {
  const digits = digitsOnly(String(raw ?? '')).replace(/^\+/, '');
  const national = digits.startsWith('0098') ? digits.slice(4) : digits.startsWith('98') && digits.length === 12 ? digits.slice(2) : digits.startsWith('0') ? digits.slice(1) : digits;
  return /^9\d{9}$/.test(national) ? `0${national}` : null;
}

/** A ten-digit Iranian postal code (any digits, spaces and hyphens read), or null */
export function normalizePostalCode(raw: string): string | null {
  const digits = digitsOnly(String(raw ?? ''));
  return /^\d{10}$/.test(digits) ? digits : null;
}

/** The last four digits of the paying card, or null */
export function normalizeCardLast4(raw: string): string | null {
  const digits = digitsOnly(String(raw ?? ''));
  return /^\d{4}$/.test(digits) ? digits : null;
}

/** A bank reference (پیگیری / ارجاع): 4 to 40 Latin letters, digits or hyphens, Persian digits read; else null */
export function normalizeReference(raw: string): string | null {
  const text = toLatinDigits(String(raw ?? '')).replace(/[\s‌]/g, '');
  return /^[0-9A-Za-z-]{4,40}$/.test(text) ? text : null;
}

/** One trimmed line of text with inner runs of spaces folded, or null when empty or too long */
export function cleanText(raw: unknown, max: number, options: { multiline?: boolean } = {}): string | null {
  const text = String(raw ?? '').replace(options.multiline ? /[^\S\n]+/g : /\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text && text.length <= max ? text : null;
}

export const isIranProvince = (value: string): boolean => (IRAN_PROVINCES as readonly string[]).includes(value);

export interface CartLineInput {
  slug: string;
  quantity: number;
}

/** The lines of a cart, or the first reason they cannot be ordered: each item once, whole quantities 1..99 */
export function cartLinesError(lines: readonly CartLineInput[]): string | null {
  if (lines.length === 0) return 'سبد خرید خالی است.';
  if (lines.length > ORDER_LINES_MAX) return `هر سفارش حداکثر ${ORDER_LINES_MAX.toLocaleString('fa-IR')} کالای جدا دارد.`;
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.slug)) return 'هر کالا فقط یک بار در سفارش می‌آید؛ تعدادش را بیشتر کنید.';
    seen.add(line.slug);
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > ORDER_LINE_QUANTITY_MAX) {
      return `تعداد هر کالا باید عددی از ۱ تا ${ORDER_LINE_QUANTITY_MAX.toLocaleString('fa-IR')} باشد.`;
    }
  }
  return null;
}

/** Rials as tomans for the buyer's eyes (whole rials only; the remainder below ten rials is dropped) */
export function tomanText(rial: string): string {
  const clean = rialAmountText(rial, { allowZero: true });
  if (clean === null) return '';
  return clean.length > 1 ? clean.slice(0, -1) : '0';
}

/** The transitions the ERP orders screen offers for each status */
export const NEXT_FULFILMENT: Readonly<Partial<Record<OrderStatus, 'shipped' | 'delivered'>>> = {
  paid: 'shipped', confirmed: 'shipped', shipped: 'delivered',
};
