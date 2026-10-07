/**
 * v9.0.125 (TD-541 / TD-771، یافته‌های B02-26 و B08-02، تصمیم ت۱ «الف» بسته ۸ و مدل مجوز §۴.۲): یک جدول می‌گوید ثبت
 * هر نوع سند در هر وضعیت کدام مجوز را می‌خواهد. سرور (ثبت، نهایی‌سازی و گام تأیید گردش کار) و فرم فاکتور همین را
 * می‌خوانند و هیچ‌جا کد نقش پرسیده نمی‌شود. پیش‌تر هر نقشی جز چهار کد ثابت «کاربر فروش» بود: سند قطعی نمی‌زد، پیش‌نویسش
 * پیش‌فاکتور می‌شد، و همان پیش‌فاکتور را بی هیچ قاعده‌ای از مسیر نهایی‌سازی قطعی می‌کرد.
 *
 * - سند فروش (فاکتور، پیش‌فاکتور، برگشت از فروش): پیش‌نویس و پیش‌فاکتور با «صدور فاکتور و پیش‌فاکتور»، ثبت قطعی و
 *   نهایی‌سازی با «قطعی کردن سند فروش».
 * - سند انبار به جهت گردش کالا: ورود با «ثبت ورود کالا»، خروج با «ثبت خروج کالا»، در هر وضعیت.
 * - انبارگردانی: «اعمال و تسویه مغایرت».
 *
 * این فایل به چیزی از سرور یا مرورگر وابسته نیست.
 */

import { documentStockDirection, type DocumentStockDirection } from '../documents/documentDirection.js';

export type { DocumentStockDirection };
export type DocumentRecordStatus = 'draft' | 'proforma' | 'final';

/** نوع‌های سند فروش */
export const SALES_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['invoice', 'proforma', 'return']);

/** مجوز ثبت قطعی و نهایی‌سازی سند فروش */
export const SALES_FINALIZE_PERMISSION = 'documents.finalize';

export function isSalesDocumentType(docType: string): boolean {
  return SALES_DOCUMENT_TYPES.has(docType);
}

/** مجوزی که ثبت (یا نهایی‌سازی) سندی از این نوع، در این وضعیت و با این جهت گردش کالا می‌خواهد */
export function documentRecordPermission(docType: string, status: DocumentRecordStatus, direction: DocumentStockDirection): string {
  if (isSalesDocumentType(docType)) return status === 'final' ? SALES_FINALIZE_PERMISSION : 'documents.create';
  if (docType === 'audit') return 'audit.apply';
  return direction === 'in' ? 'warehouse.in' : 'warehouse.out';
}

/**
 * v9.0.238 (TD-770): مجوز ثبت سندی از این نوع در این وضعیت؛ جهت گردش از خود نوع (`documentStockDirection`)، همان که
 * سرور با آن کالا را جابه‌جا می‌کند. صفحه اسناد انبار دکمه ثبت را با همین نشان می‌دهد.
 */
export function documentTypeRecordPermission(docType: string, status: DocumentRecordStatus): string {
  return documentRecordPermission(docType, status, documentStockDirection(docType) ?? 'out');
}
