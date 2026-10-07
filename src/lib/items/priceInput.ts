import { DECIMAL_PATTERN, normalizeDecimalString } from '../numericInput.js';
import { TREASURY_CURRENCIES, normalizeTreasuryCurrency } from '../treasury/treasuryCurrency.js';

/**
 * v9.0.176 (TD-657 بخش قیمت، B05-11، تصمیم ت۹ الف): مبلغ و ارز قیمت کالا، مشترک سرور (فرم، صفحه قیمت‌گذاری و ورود
 * اکسل) و مرورگر (صفحه قیمت‌گذاری و ورود سریع). قیمت عددی بزرگ‌تر از صفر است و حذف قیمت عملیاتی صریح است (`remove`)؛
 * ارز فقط فهرست AGENTS §6 است. پیش‌تر قیمت ‎-۵۰۰۰۰۰ پذیرفته، «abc» صفر و قیمت صفر حذف می‌شد، و ارز «XYZ» یا «تومان»
 * ذخیره و در کشوی قیمت فاکتور بی‌صدا ناپدید می‌شد.
 */
export const PRICE_CURRENCIES = TREASURY_CURRENCIES;
export type PriceCurrency = typeof PRICE_CURRENCIES[number];

export const PRICE_CURRENCY_MESSAGE = 'ارز قیمت پشتیبانی نمی‌شود؛ یکی از ریال (IRR)، دلار (USD)، یورو (EUR)، درهم (AED) یا پوند (GBP) را انتخاب کنید.';
export const PRICE_AMOUNT_MESSAGE = 'قیمت باید عددی بزرگ‌تر از صفر باشد؛ برای حذف قیمت، خانه آن را خالی بگذارید.';

/** خالی یا «ریال» ← IRR؛ کد ارز بی‌حساسیت به بزرگی حروف */
export function normalizePriceCurrency(value: unknown): unknown {
  return normalizeTreasuryCurrency(value) ?? 'IRR';
}

export function priceCurrencyOf(value: unknown): PriceCurrency | null {
  const code = normalizePriceCurrency(value);
  return typeof code === 'string' && (PRICE_CURRENCIES as readonly string[]).includes(code) ? code as PriceCurrency : null;
}

/** مبلغ قیمت با ارقام لاتین (ارقام فارسی و جداکننده هزارگان پذیرفته)، یا null وقتی عدد بزرگ‌تر از صفر نیست */
export function parsePriceAmount(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(value) : null;
  if (typeof value !== 'string') return null;
  const clean = normalizeDecimalString(value);
  return DECIMAL_PATTERN.test(clean) && Number(clean) > 0 ? clean : null;
}

/** خانه ویرایش‌شده یک فهرست قیمت در صفحه قیمت‌گذاری */
export interface PriceFieldEdit {
  title: string;
  price: string;
  currency: string;
}

export type PriceSaveUpdate =
  | { itemId: number; title: string; remove: true }
  | { itemId: number; title: string; price: string; currency: string };

/** بدنه `batch-update` برای یک خانه: خانه خالی حذف صریح است؛ عدد نامعتبر یا ارز ناشناخته خطای فارسی می‌دهد و فرستاده نمی‌شود */
export function priceSaveUpdate(itemId: number, edit: PriceFieldEdit): { update: PriceSaveUpdate } | { error: string } {
  if (String(edit.price ?? '').trim() === '') return { update: { itemId, title: edit.title, remove: true } };
  const price = parsePriceAmount(String(edit.price));
  if (price === null) return { error: `قیمت «${edit.title}»: ${PRICE_AMOUNT_MESSAGE}` };
  const currency = priceCurrencyOf(edit.currency);
  if (currency === null) return { error: `قیمت «${edit.title}»: ${PRICE_CURRENCY_MESSAGE}` };
  return { update: { itemId, title: edit.title, price, currency } };
}

/** بدنه‌های `batch-update` چند خانه و خطاهای فارسی خانه‌های نامعتبر */
export function priceSaveUpdates(edits: ReadonlyArray<{ itemId: number; edit: PriceFieldEdit }>): { updates: PriceSaveUpdate[]; errors: string[] } {
  const updates: PriceSaveUpdate[] = [];
  const errors: string[] = [];
  for (const { itemId, edit } of edits) {
    const r = priceSaveUpdate(itemId, edit);
    if ('error' in r) errors.push(r.error);
    else updates.push(r.update);
  }
  return { updates, errors };
}
