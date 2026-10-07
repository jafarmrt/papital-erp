import { fin, type DecimalValue, type FinancialDecimal } from '../financialDecimal';

/**
 * v9.0.246 (TD-788، یافته B08-19، تصمیم ت۱۰ «الف» بسته ۸): برگشت از فروشِ دارای فاکتور مرجع هر کالا را با قیمت خالص
 * همان فاکتور برمی‌گرداند: جمع (مقدار × قیمت − تخفیف ردیف، با کف صفر) ردیف‌های آن کالا تقسیم بر جمع مقدارشان، یعنی
 * میانگین وزنی وقتی کالا در چند ردیف آمده است. همان خالصی است که سند حسابداری فروش بدهکار مشتری کرده بود (مثل
 * `netLineUnitPrice` در TD-250). ستون قیمت ردیف چهار رقم اعشار دارد، پس قیمت یک بار تا چهار رقم گرد می‌شود.
 *
 * سرور (ثبت، ویرایش و نهایی‌سازی برگشت) و فرم صفحه اسناد انبار همین تابع را می‌خوانند تا قیمتی که فرم می‌فرستد با
 * قیمتی که سرور می‌سنجد یکی باشد. این فایل به چیزی از سرور یا مرورگر وابسته نیست.
 */
export const RETURN_UNIT_PRICE_SCALE = 4;

export interface ReturnSourceLine {
  itemId: number;
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  discount?: DecimalValue;
}

export interface ReturnItemTerms {
  /** جمع مقدار کالا در فاکتور */
  quantity: FinancialDecimal;
  /** قیمت خالص هر واحد، گرد به چهار رقم */
  netUnitPrice: FinancialDecimal;
}

/** قیمت خالص هر واحد هر کالای فاکتور (به ترتیب نخستین ردیف هر کالا) */
export function invoiceReturnTerms(lines: readonly ReturnSourceLine[]): Map<number, ReturnItemTerms> {
  const sums = new Map<number, { qty: FinancialDecimal; net: FinancialDecimal }>();
  for (const line of lines) {
    const qty = fin(line.quantity);
    if (!Number.isInteger(line.itemId) || line.itemId <= 0 || !qty.isPositive()) continue;
    const lineNet = qty.multiply(line.unitPrice).subtract(fin(line.discount ?? 0));
    const prev = sums.get(line.itemId) ?? { qty: fin(0), net: fin(0) };
    sums.set(line.itemId, { qty: prev.qty.add(qty), net: prev.net.add(lineNet.isNegative() ? fin(0) : lineNet) });
  }
  const terms = new Map<number, ReturnItemTerms>();
  for (const [itemId, s] of sums) {
    terms.set(itemId, { quantity: s.qty, netUnitPrice: s.net.divide(s.qty, RETURN_UNIT_PRICE_SCALE) });
  }
  return terms;
}

/** قیمت ارسالی برای ردیف برگشت همان قیمت خالص فاکتور است؟ (پس از گرد کردن به چهار رقم) */
export function isInvoiceNetUnitPrice(sent: DecimalValue, netUnitPrice: FinancialDecimal): boolean {
  return fin(sent).round(RETURN_UNIT_PRICE_SCALE).equals(netUnitPrice.round(RETURN_UNIT_PRICE_SCALE));
}
