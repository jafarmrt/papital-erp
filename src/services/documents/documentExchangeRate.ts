import { ValidationError } from '../../errors/customErrors.js';

/**
 * v7.0.63 (TD-198): نرخ تسعیر ساختاریافته اسناد ارزی.
 *
 * documents.exchange_rate (ریال به ازای یک واحد ارز سند) تنها منبع نرخ تسعیر سند حسابداری است؛ هیچ نرخی از متن
 * یادداشت خوانده نمی‌شود. برای سند غیرریالی در ثبت، ویرایش و نهایی‌سازی الزامی است و برای سند ریالی تهی می‌ماند.
 * با تصمیم مالک محصول اسناد قبلی تغییر نکردند (نرخی از یادداشت منتقل نشد).
 */

export function normalizeCurrency(currency: unknown): string {
  const cur = String(currency ?? '').trim().toUpperCase();
  return cur || 'IRR';
}

export interface ExchangeRateInput {
  exchangeRate?: unknown;
  exchange_rate?: unknown;
}

/** ورودی نرخ تسعیر را می‌خواند؛ اگر ارسال نشده باشد undefined برمی‌گرداند. */
export function parseExchangeRateInput(input: ExchangeRateInput | undefined): number | undefined {
  const raw = input?.exchangeRate !== undefined ? input.exchangeRate : input?.exchange_rate;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`نرخ تسعیر باید عددی بزرگ‌تر از صفر باشد (مقدار دریافتی: ${String(raw)}).`);
  }
  return value;
}

/**
 * نرخ تسعیری که روی سند ذخیره می‌شود: سند ریالی تهی؛ سند ارزی نرخ ارسالی یا نرخ ذخیره‌شده قبلی، و در نبود هر دو خطا.
 */
export function resolveDocumentExchangeRate(params: {
  currency: unknown;
  input?: ExchangeRateInput;
  existing?: number | string | null;
}): number | null {
  const currency = normalizeCurrency(params.currency);
  if (currency === 'IRR') return null;
  const rate = parseExchangeRateInput(params.input) ?? (Number(params.existing) > 0 ? Number(params.existing) : undefined);
  if (rate === undefined) {
    throw new ValidationError(`برای سند با ارز ${currency} نرخ تسعیر (ریال به ازای هر واحد ${currency}) الزامی است.`);
  }
  return rate;
}
