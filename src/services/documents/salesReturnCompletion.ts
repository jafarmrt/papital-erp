import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { RETURN_UNIT_PRICE_SCALE, type ReturnItemTerms } from '../../lib/documents/returnUnitPrice.js';

export interface EarlierReturnLine {
  itemId: number;
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  discount: DecimalValue | null;
}

interface ReturnLine {
  itemId: number | string;
  quantity: DecimalValue;
  unit_price?: DecimalValue;
}

/**
 * v10.0.39 (TD-933، P5-S-10، تصمیم ب مالک محصول): قیمت خالص هر واحد برگشت چهار رقم اعشار دارد (TD-788)، پس برگشت کامل
 * کالایی که قیمت خالصش در چهار رقم نمی‌گنجد (ردیف شکسته ووکامرس TD-297: ۱۰۰۰ برای ۳ = ۲ × ۳۳۳ + ۱ × ۳۳۴) جزئی کمتر یا
 * بیشتر از فروش آن را بستانکار می‌کرد و ۰٫۰۰۰۱ ریال روی مشتری می‌ماند. برگشتی که با برگشت‌های قطعی پیشین همه مقدار کالا را
 * در فاکتور برمی‌گرداند، باقی‌مانده دقیق خالص آن را برمی‌گرداند: آخرین ردیف آن کالا یک واحدش را به قیمت تکمیلی (قیمت خالص
 * + باقی‌مانده) می‌گیرد و اگر بیش از یک واحد است دو ردیف می‌شود، مانند `exactLineSplit`. برگشت جزئی دست نمی‌خورد.
 */
export function completeReturnLines<T extends ReturnLine>(
  lines: readonly T[],
  terms: ReadonlyMap<number, ReturnItemTerms>,
  earlier: readonly EarlierReturnLine[],
): { lines: T[]; completionPrices: Map<number, FinancialDecimal> } {
  const completionPrices = new Map<number, FinancialDecimal>();
  const out = [...lines];
  const thisQty = new Map<number, FinancialDecimal>();
  for (const l of lines) thisQty.set(Number(l.itemId), (thisQty.get(Number(l.itemId)) ?? fin(0)).add(fin(l.quantity)));

  for (const [itemId, qty] of thisQty) {
    const itemTerms = terms.get(itemId);
    if (!itemTerms || !qty.isPositive()) continue;
    let earlierQty = fin(0);
    let earlierNet = fin(0);
    for (const e of earlier.filter(r => r.itemId === itemId)) {
      earlierQty = earlierQty.add(fin(e.quantity));
      earlierNet = earlierNet.add(fin(e.quantity).multiply(e.unitPrice).subtract(fin(e.discount ?? 0)));
    }
    if (!earlierQty.add(qty).equals(itemTerms.quantity)) continue;
    const residual = itemTerms.net.subtract(earlierNet).subtract(qty.multiply(itemTerms.netUnitPrice)).round(RETURN_UNIT_PRICE_SCALE);
    if (residual.isZero()) continue;
    const completion = itemTerms.netUnitPrice.add(residual);
    const lastIndex = out.map(l => Number(l.itemId)).lastIndexOf(itemId);
    const last = out[lastIndex];
    const lastQty = fin(last.quantity);
    // کسر واحد (مقدار کمتر از یک) باقی‌مانده را دقیق برنمی‌دارد؛ چنین برگشتی مانند پیش می‌ماند
    if (completion.isNegative() || lastQty.lessThan(1)) continue;
    completionPrices.set(itemId, completion);
    if (!lastQty.greaterThan(1)) {
      out[lastIndex] = { ...last, unit_price: completion.toString() };
    } else {
      out.splice(lastIndex, 1,
        { ...last, quantity: lastQty.subtract(1).toString(), unit_price: itemTerms.netUnitPrice.toString() },
        { ...last, quantity: '1', unit_price: completion.toString() });
    }
  }
  return { lines: out, completionPrices };
}
