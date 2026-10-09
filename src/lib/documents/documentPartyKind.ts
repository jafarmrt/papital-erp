import { PICK_LIST_URLS } from '../permissions/pickLists';

/**
 * v10.0.41 (TD-939، P5-P12): نوع طرف حساب هر سند. سند خرید (رسید، خرید) فقط «تأمین‌کننده» یا «هر دو» و سند فروش (فاکتور،
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
