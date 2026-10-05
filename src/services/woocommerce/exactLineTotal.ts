import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';

export { currencyScale } from '../../lib/currencyScale.js';

/**
 * v8.0.41 (TD-297): ردیف سفارش با جمع دقیق. اگر جمع ردیف بر مقدار (صحیح) در کوچک‌ترین واحد ارز بخش‌پذیر نباشد، ردیف دو
 * سطر می‌شود: (مقدار − ۱) واحد به فی گردشده رو به پایین و یک واحد به باقی‌مانده؛ مثلاً ۱۰۰۰ ریال برای ۳ عدد = ۲ × ۳۳۳ + ۱ × ۳۳۴.
 * پیش‌تر فی ۳۳۳٫۳۳۳۳ می‌شد و بدهکار مشتری ۹۹۹٫۹۹۹۹. تخفیف ردیف به کار نمی‌رود تا درآمد ناخالص و «تخفیفات فروش» دست نخورند.
 */
export function exactLineSplit(total: FinancialDecimal, quantity: number, scale: number): Array<{ quantity: number; unitPrice: FinancialDecimal }> {
  const exact = total.divide(quantity, 12);
  if (exact.round(scale).equals(exact)) return [{ quantity, unitPrice: exact.round(scale) }];
  // مقدار کسری یا یک واحد: جمع بر مقدار بخش‌پذیر نیست و سطر دوم کمکی نمی‌کند؛ همان فی چهاررقمی پیشین
  if (!Number.isInteger(quantity) || quantity < 2) return [{ quantity, unitPrice: exact.round(4) }];
  const step = fin(1).divide(10 ** scale, scale);
  let unit = exact.round(scale);
  if (unit.multiply(quantity).greaterThan(total)) unit = unit.subtract(step);
  const last = total.subtract(unit.multiply(quantity - 1));
  return [{ quantity: quantity - 1, unitPrice: unit }, { quantity: 1, unitPrice: last }];
}
