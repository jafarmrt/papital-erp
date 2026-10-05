import { fin, type DecimalValue } from '../financialDecimal';

/**
 * v8.0.81 (TD-380): همان قاعده سرور (`assertLineDiscountsWithinAmount` در src/services/documents/lineDiscount.ts):
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
