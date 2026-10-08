/**
 * v9.0.370 (TD-818، یافته B07-02، تصمیم ت۱ الف): سندی که موجودی رزرو می‌کند فقط پیش‌فاکتور فروش است: نوع `invoice` یا
 * `proforma` (هر دو جهت خروج دارند، `documentDirection.ts`) در وضعیت `proforma`. پیش‌فاکتور خرید (رسید با وضعیت پیش‌فاکتور،
 * TD-267)، رسید، خرید، حواله و هر پیش‌نویس رزرو نمی‌کنند و پیش‌فاکتور فروش منقضی نمی‌شود. پیش‌تر هر سند با وضعیت یا نوع
 * «پیش‌فاکتور» رزرو می‌کرد: سفارش خرید ۹ عددی از تأمین‌کننده ۹ عدد از موجودی فعلی را می‌بست و فروش ۳ از ۱۰ رد می‌شد.
 */
export const RESERVING_DOCUMENT_TYPES = ['invoice', 'proforma'] as const;
export const RESERVING_DOCUMENT_STATUS = 'proforma';

export function isReservingDocument(type: unknown, status: unknown): boolean {
  return status === RESERVING_DOCUMENT_STATUS && (RESERVING_DOCUMENT_TYPES as readonly unknown[]).includes(type);
}
