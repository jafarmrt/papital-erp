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
