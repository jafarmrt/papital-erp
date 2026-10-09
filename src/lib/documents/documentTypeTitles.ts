/** نام فارسی هر نوع سند در پیام‌ها و گزارش ممیزی (پیش‌تر فقط در documents.routes.ts) */
export const DOCUMENT_TYPE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  receipt: 'رسید خرید مواد و کالا',
  production_receipt: 'رسید تولید و تحویل محصول',
  invoice: 'فاکتور فروش',
  proforma: 'پیش‌فاکتور',
  return: 'سند مرجوعی',
  audit: 'سند انبارگردانی',
  transfer: 'حواله انتقال',
  remittance: 'حواله خروج',
  waste: 'سند ضایعات',
});

export function documentTypeTitle(docType: string | null | undefined, fallback = 'سند'): string {
  return DOCUMENT_TYPE_TITLES[String(docType ?? '')] ?? fallback;
}

/**
 * v10.0.47 (TD-1131): نوع سند یک ردیف کاردکس برای نمایش؛ کد نوع (`remittance`، `audit`) نام فارسی‌اش را می‌گیرد،
 * متن فارسی ثبت‌شده ردیف‌های قدیمی همان‌طور می‌ماند، و کد لاتین ناشناخته «سند» خوانده می‌شود، هرگز خود کد.
 */
export function kardexDocumentTypeLabel(docType: string | null | undefined): string {
  const raw = String(docType ?? '').trim();
  if (!raw) return '';
  if (DOCUMENT_TYPE_TITLES[raw]) return DOCUMENT_TYPE_TITLES[raw];
  return /^[A-Za-z0-9_-]+$/.test(raw) ? 'سند' : raw;
}
