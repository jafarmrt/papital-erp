import { fin, type DecimalValue, type FinancialDecimal } from '../../lib/financialDecimal.js';

/**
 * v8.0.9 (TD-250): بهای ورود کالا به انبار در سند ورودی (رسید، خرید، رسید تولید) قیمت خالص پس از تخفیف ردیف است:
 * (مقدار × قیمت − تخفیف ردیف) ÷ مقدار، نه قیمت پیش از تخفیف. همان مبلغی که سند حسابداری خرید به موجودی می‌برد
 * (`syncPurchaseInvoiceVoucher`: خالص ردیف با کف صفر)، پس WAC و کاردکس با دفتر کل یکی می‌مانند. تسعیر ارزی روی همین
 * قیمت خالص انجام می‌شود (`stockUnitPriceInIrr`). پیش‌تر کالا با قیمت پیش از تخفیف وارد انبار می‌شد و WAC و ارزش انبار
 * بیش از بهای واقعی بود.
 */
const NET_UNIT_PRICE_SCALE = 12;

export function netLineUnitPrice(unitPrice: DecimalValue, quantity: DecimalValue, discount: DecimalValue | null | undefined): FinancialDecimal {
  const qty = fin(quantity);
  const price = fin(unitPrice);
  const lineDiscount = fin(discount ?? 0);
  if (!qty.isPositive() || lineDiscount.isZero()) return price;
  const net = qty.multiply(price).subtract(lineDiscount);
  // دقت میانی ۱۲ رقم: گرد کردن ۴ رقمی قیمت ارزی پیش از تسعیر، با نرخ بزرگ می‌شود (۰٫۰۰۰۰۵ دلار × ۶۰۰٬۰۰۰ = ۳۰ ریال در
  // هر واحد)؛ stockUnitPriceInIrr پس از تسعیر تا ۴ رقم گرد می‌کند و ستون پولی ریالی ۴ رقم نگه می‌دارد
  return net.isNegative() ? fin(0) : net.divide(qty, NET_UNIT_PRICE_SCALE);
}
