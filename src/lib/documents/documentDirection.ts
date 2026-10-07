/**
 * v9.0.213 (TD-770، یافته B08-01، تصمیم ت۲ «الف» بسته ۸): جهت گردش کالای هر نوع سند فقط از خود نوع می‌آید. سرور (ثبت،
 * نهایی‌سازی و مجوز ثبت) و صفحه اسناد انبار همین جدول را می‌خوانند. پیش‌تر جهت از فیلد `inOut` بدنه درخواست می‌آمد ولی
 * سند حسابداری از نوع سند ساخته می‌شد: «رسید» با `inOut: out` کالا را خارج می‌کرد و موجودی دفتر را زیاد، و «فاکتور فروش»
 * با `inOut: in` کالا را وارد می‌کرد.
 *
 * انبارگردانی (`audit`) جهت نوعی ندارد: هر ردیف به اندازه اختلاف شمارش با موجودی دفتری وارد یا خارج می‌شود. حواله انتقال
 * بین انبارها (`transfer`) فقط از مسیر انتقال ثبت می‌شود (TD-489).
 *
 * این فایل به چیزی از سرور یا مرورگر وابسته نیست.
 */

export type DocumentStockDirection = 'in' | 'out';

/** جهت گردش کالای هر نوع سندی که از مسیر ثبت سند پذیرفته می‌شود (جز انبارگردانی) */
export const DOCUMENT_STOCK_DIRECTIONS: Readonly<Record<string, DocumentStockDirection>> = Object.freeze({
  receipt: 'in',
  purchase: 'in',
  production_receipt: 'in',
  return: 'in',
  invoice: 'out',
  proforma: 'out',
  remittance: 'out',
  waste: 'out',
});

/** جهت گردش کالای این نوع سند؛ برای انبارگردانی، انتقال و نوع ناشناخته null */
export function documentStockDirection(docType: string): DocumentStockDirection | null {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_STOCK_DIRECTIONS, docType) ? DOCUMENT_STOCK_DIRECTIONS[docType] : null;
}

/** نوعی که مسیر ثبت سند می‌پذیرد: نوع‌های جهت‌دار و انبارگردانی */
export function isRecordableDocumentType(docType: string): boolean {
  return docType === 'audit' || documentStockDirection(docType) !== null;
}
