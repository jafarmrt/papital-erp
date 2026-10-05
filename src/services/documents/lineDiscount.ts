import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { ValidationError } from '../../errors/customErrors.js';

/**
 * v8.0.103 (TD-380): تخفیف هر ردیف سند از مبلغ همان ردیف (مقدار × قیمت واحد) بیشتر نیست. پیش‌تر تخفیف بزرگ‌تر پذیرفته
 * می‌شد: در فاکتور چندردیفی، بیشترِ تخفیف یک ردیف از درآمد ردیف‌های دیگر کم می‌شد (ردیف با مبلغ منفی)، و اگر جمع
 * تخفیف از جمع ناخالص بیشتر می‌شد، پیش‌فاکتور با «مبلغ قابل پرداخت» منفی ثبت و نهایی‌سازی‌اش با خطای نامفهوم سند
 * حسابداری رد می‌شد. فرم فاکتور فروش همین قاعده را پیش از افزودن ردیف می‌سنجد (`lineDiscountError` در
 * src/lib/invoices/invoiceLine.ts).
 */

export interface DiscountLine {
  itemId?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  unit_price?: unknown;
  price?: unknown;
  discount?: unknown;
}

const asDecimal = (raw: unknown): DecimalValue => {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? (raw as DecimalValue) : 0;
};

export function assertLineDiscountsWithinAmount(lines: readonly DiscountLine[] | null | undefined): void {
  const safeLines = Array.isArray(lines) ? lines : [];
  safeLines.forEach((line, index) => {
    const discount = fin(asDecimal(line.discount));
    if (!discount.isPositive()) return;
    const price = line.unit_price ?? line.unitPrice ?? line.price;
    const amount = fin(asDecimal(line.quantity)).multiply(fin(asDecimal(price)));
    if (discount.greaterThan(amount)) {
      throw new ValidationError(
        `تخفیف ردیف ${index + 1} (${discount.toString()}) از مبلغ همان ردیف (${amount.toString()}) بیشتر است؛ تخفیف هر ردیف حداکثر برابر مقدار × قیمت واحد آن است.`,
        { code: 'LINE_DISCOUNT_EXCEEDS_AMOUNT', line: index + 1, itemId: line.itemId }
      );
    }
  });
}
