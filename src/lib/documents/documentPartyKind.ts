import { PICK_LIST_URLS } from '../permissions/pickLists';

/**
 * v10.0.44 (TD-939، P5-P12): نوع طرف حساب هر سند. سند خرید (رسید، خرید) فقط «تأمین‌کننده» یا «هر دو» و سند فروش (فاکتور،
 * پیش‌فاکتور، برگشت از فروش) فقط «مشتری» یا «هر دو» می‌گیرد؛ همان قاعده پیوند خزانه (TD-501). پیش‌تر رسید خرید طرف حساب
 * «فقط مشتری» را می‌پذیرفت و سند حسابداری‌اش بستانکاری تفصیلی «تأمین‌کننده» با شناسه یک مشتری می‌ساخت که با پرداخت
 * تأمین‌کننده تسویه‌پذیر نبود. سرور (`resolveDocumentParty`) و فهرست انتخاب صفحه سند انبار و فاکتور همین جدول را می‌خوانند.
 */
export type DocumentPartySide = 'customer' | 'supplier';

const DOCUMENT_PARTY_SIDES: Readonly<Record<string, DocumentPartySide>> = Object.freeze({
  invoice: 'customer',
  proforma: 'customer',
  return: 'customer',
  receipt: 'supplier',
  purchase: 'supplier',
});

export function documentPartySide(docType: string | null | undefined): DocumentPartySide | null {
  return DOCUMENT_PARTY_SIDES[String(docType ?? '')] ?? null;
}

/** طرف حسابی با این نوع (خالی = مشتری، پیش‌فرض ستون) برای این سند مجاز است */
export function partyFitsDocument(docType: string | null | undefined, partyType: string | null | undefined): boolean {
  const side = documentPartySide(docType);
  if (!side) return false;
  const type = String(partyType ?? '').trim() || 'customer';
  return type === side || type === 'both';
}

export const DOCUMENT_PARTY_SIDE_LABELS: Readonly<Record<DocumentPartySide, string>> = Object.freeze({
  customer: 'مشتری',
  supplier: 'تأمین‌کننده',
});

/** فهرست انتخاب طرف حساب همین سند (`GET /customers/options?partyType=`) */
export function documentPartyPickListUrl(docType: string | null | undefined): string {
  const side = documentPartySide(docType);
  return side ? `${PICK_LIST_URLS.customers}?partyType=${side}` : PICK_LIST_URLS.customers;
}

export interface SupplierPartyRow {
  id?: number;
  name: string;
  partyType?: string | null;
  supplierCategory?: string | null;
  phone?: string | null;
}

/**
 * v10.0.93 (TD-1194): گزینه‌های تأمین‌کننده فرم‌های خرید (تقسیم سفارش میز کار تدارکات، صدور مستقیم سند هشدار نقطه سفارش):
 * فقط طرف حساب «تأمین‌کننده» یا «هر دو»، همان قاعده سرور (`partyFitsDocument` رسید). پیش‌تر هر دو فرم مشتری را هم با
 * نشان «👤 مشتری» فهرست می‌کردند و رسید با نام مشتری ثبت می‌شد.
 */
export function supplierNameOptions<T extends SupplierPartyRow>(parties: readonly T[]): Array<{ value: string; label: string; _raw: T }> {
  return parties
    .filter(p => !!p && !!String(p.name ?? '').trim() && partyFitsDocument('receipt', p.partyType))
    .map(p => ({
      value: p.name,
      label: [
        `${p.partyType === 'supplier' ? '🏭 تأمین‌کننده' : '🤝 هر دو'}: ${p.name}`,
        p.supplierCategory ? `(${p.supplierCategory})` : '',
        p.phone ? `- ${p.phone}` : '',
      ].filter(Boolean).join(' '),
      _raw: p,
    }));
}
