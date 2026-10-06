/**
 * v9.0.6 (TD-417، تصمیم مالک محصول ت۱ الف): زبانه «اسناد» پرونده مشتری فقط اسناد فروشی را می‌آورد که نام خریدارشان
 * دقیقاً نام طرف حساب است (GET /customers/:id/documents). پیش‌تر با جست‌وجوی متنی نام پر می‌شد.
 */
export function customerDocumentsUrl(customerId: number): string {
  return `/customers/${customerId}/documents?limit=50`;
}

export interface SalesDocumentLike {
  type?: string;
  status?: string;
}

/** نوع سند فروش؛ پیش‌تر هر سندی جز نوع proforma «فاکتور نهایی» نوشته می‌شد (پیش‌فاکتور و پیش‌نویس فاکتور هم) */
export function salesDocumentKindLabel(doc: SalesDocumentLike): string {
  if (doc.type === 'return') return 'برگشت از فروش';
  if (doc.type === 'proforma' || doc.status === 'proforma') return 'پیش‌فاکتور';
  return 'فاکتور فروش';
}
