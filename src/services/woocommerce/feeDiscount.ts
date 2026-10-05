import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';

/** گرد کردن رو به پایین در scale رقم اعشار (FinancialDecimal فقط گرد کردن نیم‌به‌بالا دارد) */
function floorAt(value: FinancialDecimal, scale: number): FinancialDecimal {
  const rounded = value.round(scale);
  return rounded.greaterThan(value) ? rounded.subtract(fin(1).divide(10 ** scale, scale)) : rounded;
}

/**
 * v8.0.42 (TD-295، تصمیم مالک محصول — گزینه الف): تخفیف کارمزدی سفارش ووکامرس (جمع کارمزدهای منفی) به نسبت مبلغ هر سطر، مانند
 * کوپن ووکامرس، به‌عنوان تخفیف سطر پخش می‌شود. سهم هر سطر در کوچک‌ترین واحد ارز رو به پایین گرد می‌شود و باقی‌مانده به سطرهای
 * بزرگ‌تر (تا سقف مبلغ هر سطر) می‌رسد؛ جمع سهم‌ها دقیقاً همان تخفیف است. تخفیفِ بیش از جمع سطرها null است (فاکتور منفی نمی‌شود).
 */
export function allocateFeeDiscount(lineAmounts: FinancialDecimal[], discount: FinancialDecimal, scale: number): FinancialDecimal[] | null {
  const total = lineAmounts.reduce((sum, a) => sum.add(a), fin(0));
  if (discount.greaterThan(total)) return null;
  if (!discount.isPositive() || !total.isPositive()) return lineAmounts.map(() => fin(0));

  const shares = lineAmounts.map(a => floorAt(discount.multiply(a).divide(total, 12), scale));
  let left = discount.subtract(shares.reduce((sum, s) => sum.add(s), fin(0)));
  const step = fin(1).divide(10 ** scale, scale);
  const byAmount = lineAmounts.map((a, i) => ({ a, i })).sort((x, y) => y.a.compareTo(x.a) || x.i - y.i);
  while (left.isPositive()) {
    let moved = false;
    for (const { a, i } of byAmount) {
      if (!left.isPositive()) break;
      const room = a.subtract(shares[i]);
      if (!room.isPositive()) continue;
      const add = left.lessThan(step) ? left : (room.lessThan(step) ? room : step);
      shares[i] = shares[i].add(add);
      left = left.subtract(add);
      moved = true;
    }
    if (!moved) return null;
  }
  return shares;
}
