import { ValidationError } from '../../errors/customErrors.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { money, type Money } from '../../lib/money.js';

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
export function parseExchangeRateInput(input: ExchangeRateInput | undefined): Money | undefined {
  const raw = input?.exchangeRate !== undefined ? input.exchangeRate : input?.exchange_rate;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`نرخ تسعیر باید عددی بزرگ‌تر از صفر باشد (مقدار دریافتی: ${String(raw)}).`);
  }
  return money(raw as DecimalValue);
}

/**
 * نرخ تسعیری که روی سند ذخیره می‌شود: سند ریالی تهی؛ سند ارزی نرخ ارسالی یا نرخ ذخیره‌شده قبلی، و در نبود هر دو خطا.
 */
export function resolveDocumentExchangeRate(params: {
  currency: unknown;
  input?: ExchangeRateInput;
  existing?: DecimalValue;
}): Money | null {
  const currency = normalizeCurrency(params.currency);
  if (currency === 'IRR') return null;
  const rate = parseExchangeRateInput(params.input) ?? (fin(params.existing).isPositive() ? money(params.existing) : undefined);
  if (rate === undefined) {
    throw new ValidationError(`برای سند با ارز ${currency} نرخ تسعیر (ریال به ازای هر واحد ${currency}) الزامی است.`);
  }
  return rate;
}

/**
 * v7.0.69 (TD-227، تصمیم مالک محصول): قیمت واحد اقلام سند برای گردش انبار و بهای میانگین موزون (WAC) به ریال.
 * سند ریالی بدون تغییر؛ سند ارزی قیمت × نرخ تسعیر سند. سند ارزی بدون نرخ پذیرفته نمی‌شود (WAC ریالی با عدد ارزی خراب می‌شود).
 */
export function stockUnitPriceInIrr(unitPrice: DecimalValue, currency: unknown, exchangeRate: DecimalValue): FinancialDecimal {
  const cur = normalizeCurrency(currency);
  if (cur === 'IRR') return fin(unitPrice);
  const rate = fin(exchangeRate);
  if (!rate.isPositive()) {
    throw new ValidationError(`برای گردش انبار سند با ارز ${cur} نرخ تسعیر الزامی است.`);
  }
  return fin(unitPrice).multiply(rate).round(4);
}
