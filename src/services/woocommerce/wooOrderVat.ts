import { type FinancialDecimal } from '../../lib/financialDecimal.js';
import { percentVatOf, vatBaseOf } from '../../lib/vatFormula.js';

/** سطر فاکتور ووکامرس، همان شکلی که به ثبت سند داده می‌شود */
export interface WooVatLine { quantity: number; unit_price: FinancialDecimal | number; discount?: FinancialDecimal | number }

/**
 * v10.0.231 (TD-936، P5-S-13، تصمیم ت۱۱ «بله»): درصد مالیات فاکتور سفارش ووکامرس از خود سفارش، مالیات ÷ خالص اقلام × ۱۰۰ با
 * دو رقم اعشار (دقت ستون `vat_percent`). فقط وقتی برگردانده می‌شود که همان درصد با قاعده سرور (TD-381 / TD-382) دقیقاً همان
 * مالیات سفارش را بسازد؛ مالیاتی که با هیچ درصدی از خالص اقلام ساخته نمی‌شود (مثلاً مالیات ارسال در آن است) بی درصد می‌ماند،
 * مانند پیش. پیش‌تر هر فاکتور ووکامرس درصد ۰ و مالیات مثبت داشت و مرجوعی آن با درصد واقعی ۴۲۲ می‌گرفت (TD-774).
 */
export function wooOrderVatPercent(lines: WooVatLine[], tax: FinancialDecimal, currency: string | null | undefined): number | undefined {
  // 10.3 (ARCH review finding 6): the base and the rebuilt VAT by the server's own formula (src/lib/vatFormula.ts), so the
  // percent kept is exactly one the document's VAT check accepts
  const { net } = vatBaseOf(lines.map(l => ({ quantity: l.quantity, unitPrice: l.unit_price, discount: l.discount })));
  if (!net.isPositive() || !tax.isPositive()) return undefined;
  const percent = tax.multiply(100).divide(net, 12).round(2);
  if (!percent.isPositive() || percent.greaterThan(100)) return undefined;
  const rebuilt = percentVatOf(net, percent.toNumber(), currency);
  return rebuilt.equals(tax.round(4)) ? percent.toNumber() : undefined;
}
