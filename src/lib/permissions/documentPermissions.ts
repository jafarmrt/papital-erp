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
 * - رسید تولید بی پروژه: «ثبت تولید بدون پروژه» (v10.1.6، N-06).
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

/**
 * v8.0.4 (TD-257): گردش انبار با تاریخ پیش از آخرین گردش کالا فقط با این مجوز. v9.0.456 (TD-928): از اینجا خوانده
 * می‌شود تا موتور گردش کار هم آن را از امضاکننده بسنجد، بی وابستگی به سرویس انبار.
 */
export const STOCK_BACKDATE_PERMISSION = 'warehouse.backdate';

/**
 * v10.0.176 (TD-932، تصمیم ت۱۴ برنامه ارتباط با مشتری): پیوند سند به پرونده فروش (`crmLeadId` در ثبت یا ویرایش سند)
 * مرحله پرونده را عوض می‌کند، پس همان مجوز مدیریت پرونده‌ها را می‌خواهد.
 */
export const CRM_LEAD_LINK_PERMISSION = 'crm.manage';

/**
 * v10.1.6 (N-06، TD-1262، تصمیم ت۲۶): رسید تولید بی پروژه (صفحه «ورود و خروج انبار») ارزش به انبار می‌افزاید و هزینه
 * «مصرف مواد بی پروژه» را بستانکار می‌کند، پس مجوز جدای خود را دارد که `warehouse.in` را لازم دارد. رسید تولید پروژه از
 * «ورود به انبار» پروژه با مجوزهای خودش (`PROJECT_STOCK_IN_PERMISSIONS`) ثبت می‌شود و از این جدول نمی‌گذرد.
 */
export const PRODUCTION_RECEIPT_PERMISSION = 'warehouse.production_receipt';

export function isSalesDocumentType(docType: string): boolean {
  return SALES_DOCUMENT_TYPES.has(docType);
}

/** Voiding a sales or purchase invoice, a proforma or a sales return («حذف فاکتور») */
export const INVOICE_VOID_PERMISSION = 'documents.delete';

/**
 * v11 phase 6.1j (S7, card t56-7): voiding a stock document, a receipt, production receipt, remittance, waste, transfer
 * or stock count, has its own key. Before, «حذف فاکتور» voided every type, so a sales user allowed to cancel invoices
 * could undo stock counts, transfers and receipts. Migration 0004 gave it to every role that held «حذف فاکتور».
 */
export const STOCK_DOCUMENT_VOID_PERMISSION = 'documents.void_stock';

/** The types voided with «حذف فاکتور»; every other type is a stock document */
const INVOICE_VOID_TYPES: ReadonlySet<string> = new Set([...SALES_DOCUMENT_TYPES, 'purchase']);

/** The key `DELETE /documents/:id` asks for a document of this type */
export function documentVoidPermission(docType: string): string {
  return INVOICE_VOID_TYPES.has(docType) ? INVOICE_VOID_PERMISSION : STOCK_DOCUMENT_VOID_PERMISSION;
}

/** مجوزی که ثبت (یا نهایی‌سازی) سندی از این نوع، در این وضعیت و با این جهت گردش کالا می‌خواهد */
export function documentRecordPermission(docType: string, status: DocumentRecordStatus, direction: DocumentStockDirection): string {
  if (isSalesDocumentType(docType)) return status === 'final' ? SALES_FINALIZE_PERMISSION : 'documents.create';
  if (docType === 'audit') return 'audit.apply';
  if (docType === 'production_receipt') return PRODUCTION_RECEIPT_PERMISSION;
  return direction === 'in' ? 'warehouse.in' : 'warehouse.out';
}

/**
 * v9.0.238 (TD-770): مجوز ثبت سندی از این نوع در این وضعیت؛ جهت گردش از خود نوع (`documentStockDirection`)، همان که
 * سرور با آن کالا را جابه‌جا می‌کند. صفحه اسناد انبار دکمه ثبت را با همین نشان می‌دهد.
 */
export function documentTypeRecordPermission(docType: string, status: DocumentRecordStatus): string {
  return documentRecordPermission(docType, status, documentStockDirection(docType) ?? 'out');
}
