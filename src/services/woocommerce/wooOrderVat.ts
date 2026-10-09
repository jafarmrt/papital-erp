import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { currencyScale } from '../../lib/currencyScale.js';

/** سطر فاکتور ووکامرس، همان شکلی که به ثبت سند داده می‌شود */
export interface WooVatLine { quantity: number; unit_price: FinancialDecimal | number; discount?: FinancialDecimal | number }

/**
 * v10.0.38 (TD-936، P5-S-13، تصمیم ت۱۱ «بله»): درصد مالیات فاکتور سفارش ووکامرس از خود سفارش، مالیات ÷ خالص اقلام × ۱۰۰ با
 * دو رقم اعشار (دقت ستون `vat_percent`). فقط وقتی برگردانده می‌شود که همان درصد با قاعده سرور (TD-381 / TD-382) دقیقاً همان
 * مالیات سفارش را بسازد؛ مالیاتی که با هیچ درصدی از خالص اقلام ساخته نمی‌شود (مثلاً مالیات ارسال در آن است) بی درصد می‌ماند،
 * مانند پیش. پیش‌تر هر فاکتور ووکامرس درصد ۰ و مالیات مثبت داشت و مرجوعی آن با درصد واقعی ۴۲۲ می‌گرفت (TD-774).
 */
export function wooOrderVatPercent(lines: WooVatLine[], tax: FinancialDecimal, currency: string | null | undefined): number | undefined {
  // خالص اقلام مانند computeNetAmount سرور: مقدار × قیمت − تخفیف سطر
  const net = lines.reduce((sum, l) => sum.add(fin(l.quantity).multiply(fin(l.unit_price))).subtract(fin(l.discount ?? 0)), fin(0));
  if (!net.isPositive() || !tax.isPositive()) return undefined;
  const percent = tax.multiply(100).divide(net, 12).round(2);
  if (!percent.isPositive() || percent.greaterThan(100)) return undefined;
  const rebuilt = net.multiply(percent).divide(100, 12).round(currencyScale(currency));
  return rebuilt.equals(tax.round(4)) ? percent.toNumber() : undefined;
}
