/**
 * v10.0.249 (TD-1133، راهنمای نقش‌ها): صفحه «ورود و خروج انبار» ردیف بهای صفر رسید و خرید را مانند هشدار نقطه سفارش
 * (TD-830) فقط با تأیید صریح «کالای اهدایی» ثبت می‌کند. پیش‌تر چنین ردیفی بی‌پرسش اهدایی شمرده می‌شد: به میانگین موزون
 * بهای کالا وارد انبار می‌شد و ارزشش به «درآمد کالای اهدایی» می‌رفت (TD-268)، حتی وقتی کاربر فقط بها را ننوشته بود.
 * کالایی که میانگین موزون بها ندارد با بهای صفر پذیرفته نمی‌شود (TD-906)؛ اگر بها برای خواننده فرستاده نشده باشد
 * (بی `products.view`) بررسی آن با سرور است.
 */
export interface ReceiptPricedLine {
  name: string;
  unitPrice?: number | string | null;
  /** میانگین موزون بهای کالا؛ `undefined` وقتی فهرست انتخاب بها را برای این کاربر نفرستاده است */
  weightedAverageCost?: number | string | null;
}

/** انواع سند ورودی که ردیف بهای صفرشان کالای اهدایی است؛ برگشت از فروش به بهای فاکتور مرجع وارد می‌شود */
const DONATED_GOODS_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['receipt', 'purchase']);

export interface ReceiptZeroPriceCheck {
  /** ردیفی که نباید ثبت شود */
  error: string | null;
  /** پرسش «کالای اهدایی» که پیش از ثبت باید تأیید شود */
  confirmMessage: string | null;
}

const NOTHING: ReceiptZeroPriceCheck = Object.freeze({ error: null, confirmMessage: null });

export function receiptZeroPriceCheck(docType: string, lines: readonly ReceiptPricedLine[]): ReceiptZeroPriceCheck {
  const production = docType === 'production_receipt';
  if (!DONATED_GOODS_DOCUMENT_TYPES.has(docType) && !production) return NOTHING;
  const zeroLines = lines.filter(line => !(Number(line.unitPrice || 0) > 0));
  if (zeroLines.length === 0) return NOTHING;
  const withoutCost = zeroLines.find(line => line.weightedAverageCost !== undefined && !(Number(line.weightedAverageCost || 0) > 0));
  // v10.1.6 (N-06، TD-1262): ردیف بهای صفر رسید تولید بی پروژه به میانگین موزون فعلی کالا وارد می‌شود، نه کالای اهدایی
  if (production) {
    return withoutCost
      ? { error: `«${withoutCost.name}» هنوز میانگین موزون بها ندارد؛ بهای مواد هر واحد آن را وارد کنید تا با بها وارد انبار شود.`, confirmMessage: null }
      : NOTHING;
  }
  if (withoutCost) {
    return {
      error: `«${withoutCost.name}» هنوز میانگین موزون بها ندارد و با بهای صفر بی بها وارد انبار می‌شود؛ پس از آن فروش و حواله‌اش پذیرفته نمی‌شود. بهای خرید آن را وارد کنید.`,
      confirmMessage: null,
    };
  }
  const names = zeroLines.map(line => `«${line.name}»`).join('، ');
  return {
    error: null,
    confirmMessage: `بهای ${names} صفر است. اگر این کالا رایگان دریافت شده (کالای اهدایی)، تأیید کنید تا با میانگین موزون بهای فعلی‌اش وارد انبار شود و ارزش آن به «درآمد کالای اهدایی» برود؛ وگرنه انصراف دهید و بهای خرید را وارد کنید.`,
  };
}
