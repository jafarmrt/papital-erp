/**
 * v9.0.249 (TD-667، تصمیم ت۱ بسته ۱۶): «واحد نمایش مبالغ ریالی».
 * تنظیم `currency` فقط می‌گوید مبلغ‌های ریالی (ارزش انبار، حقوق، مانده‌ها، کاردکس) به ریال نشان داده شوند یا به تومان؛
 * ارز خارجی جزو این تنظیم نیست، چون ارز هر سند ستون خود آن است. تومان = ریال ÷ ۱۰ و برچسبش «تومان» است؛
 * داده همیشه به ریال ذخیره و وارد می‌شود و دو واحد هرگز بی‌صدا با هم قاطی نمی‌شوند (معیار vibefarsi).
 */
import { fin } from './financialDecimal.js';
import { normalizeDecimalString } from './numericInput.js';
import { formatPersianPrice } from '../utils/persianNumber.js';

export type RialDisplayUnit = 'IRR' | 'TOMAN';

/** گزینه‌های مجاز تنظیم `currency` (فرم تنظیمات، نصب اولیه و بررسی سرور) */
export const RIAL_DISPLAY_UNITS: readonly RialDisplayUnit[] = ['IRR', 'TOMAN'];

export const RIAL_DISPLAY_UNIT_LABELS: Record<RialDisplayUnit, string> = { IRR: 'ریال', TOMAN: 'تومان' };

export function isRialDisplayUnit(value: unknown): value is RialDisplayUnit {
  return value === 'IRR' || value === 'TOMAN';
}

/** مقدار ذخیره‌شده را به یکی از دو واحد برمی‌گرداند؛ مقدار قدیمی دیگر (USD، EUR …) ریال است */
export function normalizeRialDisplayUnit(value: unknown): RialDisplayUnit {
  const text = String(value ?? '').trim();
  if (/^(toman|irt|tmn)$/i.test(text) || text === 'تومان') return 'TOMAN';
  return 'IRR';
}

/** مبلغ ریالی در واحد نمایش (تومان بی گرد کردن میانی) */
export function rialDisplayAmount(amountIrr: number | string | null | undefined, unit: RialDisplayUnit): number {
  const raw = typeof amountIrr === 'number' ? amountIrr : Number(normalizeDecimalString(String(amountIrr ?? '')));
  if (!Number.isFinite(raw)) return 0;
  return unit === 'TOMAN' ? fin(raw).divide(10, 4).toNumber() : raw;
}

export interface RialDisplay {
  unit: RialDisplayUnit;
  /** «ریال» یا «تومان» برای سرستون و برچسب */
  label: string;
  /** عدد فارسی در واحد نمایش، بی برچسب (برای خانه‌های زیر سرستونی که برچسب دارد) */
  number: (amountIrr: number | string | null | undefined) => string;
  /** عدد فارسی در واحد نمایش با برچسب واحد پس از عدد */
  amount: (amountIrr: number | string | null | undefined) => string;
  /** مبلغ رکوردی که ارز خود را دارد: ریال (یا بی ارز) در واحد نمایش، ارز خارجی با همان ارز */
  money: (amount: number | string | null | undefined, currency?: string | null) => string;
}

/** ارز خالی یا ریال یعنی مبلغ ریالی است */
export function isRialCurrency(currency?: string | null): boolean {
  const c = String(currency ?? '').trim();
  return c === '' || c.toUpperCase() === 'IRR' || c === 'ریال';
}

export function rialDisplayOf(unitValue: unknown): RialDisplay {
  const unit = normalizeRialDisplayUnit(unitValue);
  const label = RIAL_DISPLAY_UNIT_LABELS[unit];
  // تومانِ یک مبلغ ریالی حداکثر یک رقم اعشار دارد (۱۲۵ ریال = ۱۲٫۵ تومان)
  const decimals = unit === 'TOMAN' ? 1 : 0;
  const number = (amountIrr: number | string | null | undefined) => formatPersianPrice(rialDisplayAmount(amountIrr, unit), undefined, decimals);
  const amount = (amountIrr: number | string | null | undefined) => `${number(amountIrr)} ${label}`;
  return {
    unit,
    label,
    number,
    amount,
    money: (value, currency) => (isRialCurrency(currency) ? amount(value) : formatPersianPrice(value, String(currency).trim()))
  };
}
