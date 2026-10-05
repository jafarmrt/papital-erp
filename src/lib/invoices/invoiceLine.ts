import { fin, type DecimalValue } from '../financialDecimal';

/**
 * v8.0.103 (TD-380): همان قاعده سرور (`assertLineDiscountsWithinAmount` در src/services/documents/lineDiscount.ts):
 * تخفیف هر ردیف حداکثر برابر مقدار × قیمت واحد همان ردیف است. فرم فاکتور فروش پیش از افزودن ردیف آن را می‌سنجد تا
 * کاربر خطا را همان‌جا ببیند، نه هنگام ثبت.
 */
export function lineDiscountError(quantity: DecimalValue, unitPrice: DecimalValue, discount: DecimalValue): string | null {
  const disc = fin(discount || 0);
  if (!disc.isPositive()) return null;
  const amount = fin(quantity || 0).multiply(fin(unitPrice || 0));
  return disc.greaterThan(amount)
    ? 'تخفیف ردیف نمی‌تواند از مبلغ همان ردیف (تعداد × فی) بیشتر باشد.'
    : null;
}

/** یک قیمت فهرست قیمت کالا (پاسخ GET /items/:id/prices) */
export interface PriceListEntry {
  price: number | string;
  currency?: string | null;
}

const normalizedCurrency = (currency: string | null | undefined): string => String(currency || 'IRR').trim().toUpperCase();

/**
 * v8.0.107 (TD-384): فهرست «سیاست قیمتی» فرم فاکتور فروش فقط قیمت‌های مثبت همان ارز فاکتور را پیشنهاد می‌دهد. پیش‌تر
 * قیمت ۵۰ دلاری در فاکتور ریالی ۵۰ ریال می‌شد، چون فرم فقط عدد را برمی‌داشت و سرور ارز قیمت را نمی‌داند.
 */
export function pricesForCurrency<T extends PriceListEntry>(prices: readonly T[] | null | undefined, currency: string): T[] {
  const safe = Array.isArray(prices) ? prices : [];
  const target = normalizedCurrency(currency);
  return safe.filter(p => Number(p.price) > 0 && normalizedCurrency(p.currency) === target);
}

/**
 * v8.0.107 (TD-384): ارز فاکتوری که ردیف دارد عوض نمی‌شود؛ فی ردیف‌ها به ارز قبلی وارد شده و با تغییر ارز همان عدد به
 * ارز تازه می‌رفت (فی ۱٬۰۰۰٬۰۰۰ ریالی ۱٬۰۰۰٬۰۰۰ دلار می‌شد).
 */
export function currencyChangeError(lineCount: number, current: string, next: string): string | null {
  return lineCount > 0 && normalizedCurrency(current) !== normalizedCurrency(next)
    ? 'ارز فاکتوری که ردیف دارد عوض نمی‌شود؛ فی ردیف‌ها به ارز فعلی است. برای تغییر ارز ابتدا ردیف‌ها را حذف کنید.'
    : null;
}
