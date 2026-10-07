import { TREASURY_CURRENCIES } from '../treasury/treasuryCurrency';
import { computeVoucherCurrencyBalance, voucherRowCurrency, voucherRowRate, type VoucherCurrencyBalance } from './voucherCurrencyBalance';

/**
 * v9.0.170 (TD-564، B03-22، تصمیم ت۷ الف): ارز و نرخ ردیف در فرم سند دستی و فرم سند اصلاحی.
 *
 * - ارزهای سند همان فهرست ارزهای خزانه است («تومان» دیگر پیشنهاد نمی‌شود؛ مبلغ تومانی ریال × ۱۰ است).
 * - ردیف بی ارز ارز سند را می‌گیرد؛ ردیف غیرریالی بی نرخ خودش، نرخ ارز سند را (وقتی ارزش همان ارز سند است).
 * - هر ردیف با ارز و نرخ قطعی فرستاده می‌شود؛ پیش‌تر فرم ارز و نرخ ردیف را نمی‌فرستاد و سند ۱۰۰ دلاری ۱۰۰ ریال ثبت می‌شد.
 */

export const VOUCHER_CURRENCIES = TREASURY_CURRENCIES;

/** ارز سند در فرم: کد فهرست، وگرنه ریال؛ `replaced` کد کنارگذاشته (مانند «TOMAN» قدیمی) است تا فرم کاربر را آگاه کند */
export function voucherFormCurrency(value: unknown): { currency: string; replaced: string | null } {
  const code = voucherRowCurrency(value);
  return (VOUCHER_CURRENCIES as readonly string[]).includes(code) ? { currency: code, replaced: null } : { currency: 'IRR', replaced: code };
}

export interface VoucherRowCurrencyDraft {
  /** خالی = ارز سند */
  currency?: string;
  /** خالی = نرخ ارز سند */
  exchangeRate?: number | string | '';
}

export interface VoucherHeaderCurrency {
  currency: string;
  /** نرخ ارز سند به ریال (برای ارز غیرریالی) */
  rate?: number | string | '';
}

const positive = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** ارز و نرخ قطعی ردیف (نرخ ریال ۱ نیست، فرستاده نمی‌شود) */
export function voucherRowCurrencyRate(row: VoucherRowCurrencyDraft, header: VoucherHeaderCurrency): { currency: string; exchangeRate?: number } {
  const headerCurrency = voucherRowCurrency(header.currency);
  const currency = voucherRowCurrency(row.currency, headerCurrency);
  if (currency === 'IRR') return { currency };
  const rate = positive(row.exchangeRate) ?? (currency === headerCurrency ? positive(header.rate) : undefined);
  return rate === undefined ? { currency } : { currency, exchangeRate: rate };
}

/** ردیف‌های فرستادنی با ارز و نرخ قطعی */
export function withVoucherRowCurrency<T extends VoucherRowCurrencyDraft>(rows: readonly T[], header: VoucherHeaderCurrency): Array<Omit<T, 'currency' | 'exchangeRate'> & { currency: string; exchangeRate?: number }> {
  return rows.map(row => {
    const { currency: _c, exchangeRate: _r, ...rest } = row;
    void _c; void _r;
    return { ...rest, ...voucherRowCurrencyRate(row, header) };
  });
}

/** تراز فرم با قاعده سرور (تک‌ارز و تک‌نرخ روی مبلغ خام، وگرنه به ریال) */
export function voucherFormBalance<T extends VoucherRowCurrencyDraft & { debit?: unknown; credit?: unknown }>(rows: readonly T[], header: VoucherHeaderCurrency): VoucherCurrencyBalance {
  const safeRows = Array.isArray(rows) ? rows : [];
  return computeVoucherCurrencyBalance(safeRows.map(row => ({ debit: row.debit, credit: row.credit, ...voucherRowCurrencyRate(row, header) })), header.currency);
}

/** ارز و نرخ ردیف ذخیره‌شده در فرم: هم‌ارز سند ← خالی (پیرو سند)، نرخ برابر نرخ سند ← خالی */
export function voucherRowDraftFromStored(row: { currency?: string | null; exchangeRate?: unknown }, header: VoucherHeaderCurrency): VoucherRowCurrencyDraft {
  const headerCurrency = voucherRowCurrency(header.currency);
  const currency = voucherRowCurrency(row.currency ?? undefined, headerCurrency);
  if (currency === 'IRR') return { currency: currency === headerCurrency ? '' : 'IRR', exchangeRate: '' };
  const rate = voucherRowRate(currency, row.exchangeRate)?.toNumber();
  const sameRate = currency === headerCurrency && rate !== undefined && rate === positive(header.rate);
  return { currency: currency === headerCurrency ? '' : currency, exchangeRate: sameRate || rate === undefined || rate === 1 ? '' : rate };
}

/** نرخ ارز سند از ردیف‌های ذخیره‌شده: نرخ نخستین ردیف هم‌ارز سند (نرخ ۱ ارز غیرریالی نرخ نیست) */
export function voucherHeaderRateFromRows(rows: ReadonlyArray<{ currency?: string | null; exchangeRate?: unknown }> | null | undefined, voucherCurrency: string | null | undefined): number | '' {
  const headerCurrency = voucherRowCurrency(voucherCurrency ?? undefined);
  if (headerCurrency === 'IRR') return '';
  for (const row of Array.isArray(rows) ? rows : []) {
    if (voucherRowCurrency(row.currency ?? undefined, headerCurrency) !== headerCurrency) continue;
    const rate = positive(row.exchangeRate);
    if (rate !== undefined && rate !== 1) return rate;
  }
  return '';
}

export type VoucherBalancingResult =
  | { kind: 'balanced' }
  | { kind: 'amount'; side: 'debit' | 'credit'; amount: number }
  | { kind: 'error'; message: string };

/**
 * مبلغی که ردیف `targetIndex` (بدهکار یا بستانکار) باید بگیرد تا سند با قاعده سرور تراز شود. سند تک‌ارز و تک‌نرخ روی
 * مبلغ خام؛ وگرنه اختلاف ریالی بر نرخ ردیف هدف (ریال: گرد به ریال، ارز: دو رقم اعشار). ردیف هدف در `rows` هست
 * (ردیف تازه را پیش از فراخوانی بیفزایید).
 */
export function voucherBalancingAmount<T extends VoucherRowCurrencyDraft & { debit?: unknown; credit?: unknown }>(
  rows: readonly T[], targetIndex: number, header: VoucherHeaderCurrency,
): VoucherBalancingResult {
  const target = rows[targetIndex];
  if (!target) return { kind: 'balanced' };
  const others = rows.map((row, i) => (i === targetIndex ? { ...row, debit: 0, credit: 0 } : row));
  const balance = voucherFormBalance(others, header);
  if (balance.rowsWithoutRate.length > 0) {
    return { kind: 'error', message: `نرخ تبدیل ردیف ${balance.rowsWithoutRate.join('، ')} را وارد کنید تا تراز ریالی سند حساب شود.` };
  }
  const diff = balance.totalDebit - balance.totalCredit;
  if (Math.abs(diff) < 0.005) return { kind: 'balanced' };
  const side: 'debit' | 'credit' = diff > 0 ? 'credit' : 'debit';
  if (!balance.inRial) return { kind: 'amount', side, amount: Math.abs(diff) };
  const { currency, exchangeRate } = voucherRowCurrencyRate(target, header);
  if (currency === 'IRR') return { kind: 'amount', side, amount: Math.round(Math.abs(diff)) };
  if (!exchangeRate) return { kind: 'error', message: `نرخ تبدیل ردیف ${targetIndex + 1} را وارد کنید.` };
  return { kind: 'amount', side, amount: Math.round((Math.abs(diff) / exchangeRate) * 100) / 100 };
}
