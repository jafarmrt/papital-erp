/**
 * v9.0.285 (TD-783، یافته B08-14، تصمیم ت۹ «الف» بسته ۸): قاعده شماره سند، مشترک سرور و مرورگر.
 *
 * - شماره «فاکتور فروش» و «برگشت از فروش» فقط از سری سرور است: فرم آن را فقط نشان می‌دهد و «auto» می‌فرستد، و شماره دستی
 *   در ثبت (`POST /documents`) یا ویرایش (`PUT /documents/:id`) ۴۲۲ `DOCUMENT_REF_SERVER_SERIES` است.
 * - سند انبار شماره دستی می‌پذیرد، ولی شماره گرفته‌شده در همان نوع و سال مالی ۴۰۹ `DOCUMENT_REF_TAKEN` است (پیش‌تر بی‌صدا
 *   با شماره خودکار عوض می‌شد) و شماره دستی شمارنده سری را جلو نمی‌برد؛ شماره خودکار از شماره‌های گرفته‌شده می‌گذرد.
 *
 * این فایل به چیزی از سرور یا React وابسته نیست.
 */

/** نوع‌هایی که شماره‌شان فقط از سری سرور است */
export const SERVER_SERIES_DOCUMENT_TYPES: readonly string[] = Object.freeze(['invoice', 'return']);

export function isServerSeriesDocumentType(docType: string | null | undefined): boolean {
  return SERVER_SERIES_DOCUMENT_TYPES.includes(String(docType ?? ''));
}

/** شماره خالی یا «auto» یعنی شماره بعدی سری */
export function isAutoRefNumber(requested: unknown): boolean {
  if (requested === undefined || requested === null) return true;
  const text = String(requested).trim();
  return text === '' || text.toLowerCase() === 'auto';
}

/**
 * شماره‌ای که فرم سند انبار می‌فرستد: شماره نوع سری سرور، شماره خالی و شماره پیشنهادی دست‌نخورده «auto» است تا سرور
 * شماره آزاد بعدی را بدهد (دو فرم باز با یک شماره پیشنهادی ۴۰۹ نگیرند)؛ فقط شماره‌ای که کاربر خودش نوشته فرستاده می‌شود.
 */
export function refNumberToSend(docType: string, entered: string | null | undefined, suggested: string | null | undefined): string {
  const text = String(entered ?? '').trim();
  if (isServerSeriesDocumentType(docType) || text === '' || text === String(suggested ?? '').trim()) return 'auto';
  return text;
}
