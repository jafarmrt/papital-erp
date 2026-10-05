import type { Customer, Item } from '../../types';
import { formatPersianDate } from '../../utils';

/**
 * صفحه صدور فاکتور («صدور فاکتور»): نوع‌ها و توابع خالص فرم — منتقل‌شده بدون تغییر رفتار از CreateInvoicePage
 * تا نگاشت مشتری → خریدار و نگاشت سند → فرم (ویرایش پیش‌فاکتور) فقط یک بار نوشته شوند.
 */

/** ردیف اقلام فرم فاکتور */
export interface InvoiceDocItem {
  item: Item;
  quantity: number;
  unitPrice: number;
  discount: number;
}

/** ردیف اقلام سند در پاسخ GET /documents/:id (کلیدهای camelCase و snake_case) */
export interface InvoiceDocumentLine {
  itemId?: number;
  item_id?: number;
  itemCode?: string;
  item_code?: string;
  itemName?: string;
  item_name?: string;
  itemUnit?: string;
  unit?: string;
  current_stock?: number;
  quantity?: number | string;
  unitPrice?: number | string;
  unit_price?: number | string;
  discount?: number | string;
}

/** پاسخ GET /documents/:id که فرم ویرایش و نمای چاپ از آن استفاده می‌کنند */
export interface InvoiceDocumentDetails {
  id?: number;
  docId?: number;
  type?: string;
  status?: string;
  ref_number?: string;
  date?: string;
  buyer_name?: string | null;
  buyer_city?: string | null;
  buyer_phone?: string | null;
  buyer_address?: string | null;
  notes?: string | null;
  currency?: string;
  exchangeRate?: number | string | null;
  exchange_rate?: number | string | null;
  vatPercent?: number | string | null;
  vat_percent?: number | string | null;
  location?: string | null;
  items?: InvoiceDocumentLine[];
}

/** پاسخ POST /documents */
export interface InvoiceSaveResponse {
  docId?: number;
}

/** بدنه POST /documents و PUT /documents/:id صفحه صدور فاکتور */
export interface InvoiceSavePayload {
  docType: string;
  status: string;
  refNumber: string;
  date: string;
  user: string;
  inOut: 'out';
  buyer_name: string;
  buyer_city: string;
  buyer_phone: string;
  buyer_address: string;
  notes: string;
  location: string;
  currency: string;
  exchangeRate: number | null;
  crmLeadId: number | undefined;
  vatPercent: number;
  items: Array<{ itemId: number; quantity: number; unit_price: number; discount: number }>;
}

/** استخراج امن آرایه از پاسخ صفحه‌بندی‌شده `{ data }` یا آرایه خام (AGENTS §2) */
export function listFromResponse<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)) {
    return (res as { data: T[] }).data;
  }
  return [];
}

export type BuyerSource = Partial<Pick<Customer, 'name' | 'province' | 'city' | 'phone' | 'address' | 'contacts'>>;

/** «استان - شهر» بدون تکرار و بدون بخش خالی */
export function customerLocationLabel(c: Pick<BuyerSource, 'province' | 'city'>): string {
  const parts = [c.province, c.city].filter(Boolean).map(s => String(s).trim()).filter(Boolean);
  return parts.filter((v, i, a) => a.indexOf(v) === i).join(' - ');
}

export interface BuyerFields {
  buyerName: string;
  buyerCity: string;
  buyerPhone: string;
  buyerAddress: string;
}

/** نگاشت پرونده مشتری به فیلدهای خریدار فاکتور (تلفن: تلفن مشتری، وگرنه مخاطب اصلی، وگرنه اولین مخاطب) */
export function buyerFieldsOf(customer: BuyerSource): BuyerFields {
  let phone = customer.phone || '';
  if (!phone && Array.isArray(customer.contacts) && customer.contacts.length > 0) {
    const primary = customer.contacts.find(c => c.isPrimary) || customer.contacts[0];
    phone = primary?.phone || '';
  }
  return {
    buyerName: customer.name || '',
    buyerCity: customerLocationLabel(customer) || customer.city || customer.province || '',
    buyerPhone: phone,
    buyerAddress: customer.address || '',
  };
}

/** مقادیر فرم برای ویرایش یک سند (پیش‌فاکتور) بارگذاری‌شده */
export interface InvoiceFormValues extends BuyerFields {
  docType: string;
  status: string;
  refNumber: string;
  date: string | null;
  notes: string;
  currency: string;
  exchangeRate: number;
  vatPercent: number;
  location: string | null;
  docItems: InvoiceDocItem[] | null;
}

export function invoiceFormFromDocument(doc: InvoiceDocumentDetails, fallbackRef: string | undefined): InvoiceFormValues {
  return {
    docType: doc.type || 'invoice',
    status: doc.status || 'proforma',
    refNumber: doc.ref_number || fallbackRef || '',
    date: doc.date ? formatPersianDate(doc.date, { englishDigits: true }) : null,
    buyerName: doc.buyer_name || '',
    buyerCity: doc.buyer_city || '',
    buyerPhone: doc.buyer_phone || '',
    buyerAddress: doc.buyer_address || '',
    notes: doc.notes || '',
    currency: doc.currency || 'IRR',
    exchangeRate: Number(doc.exchangeRate ?? doc.exchange_rate ?? 0) || 0,
    // v7.0.32 (TD-197): بازیابی مالیات ساختاریافته پیش‌فاکتور در حالت ویرایش
    vatPercent: Number(doc.vatPercent ?? doc.vat_percent ?? 0) || 0,
    location: doc.location || null,
    docItems: Array.isArray(doc.items)
      ? doc.items.map(it => ({
        item: {
          id: it.itemId || it.item_id,
          code: it.itemCode || it.item_code || '',
          name: it.itemName || it.item_name || 'کالا',
          unit: it.itemUnit || it.unit || 'عدد',
          current_stock: it.current_stock || 0,
        } as Item,
        quantity: Number(it.quantity || 0),
        unitPrice: Number(it.unitPrice || it.unit_price || 0),
        discount: Number(it.discount || 0),
      }))
      : null,
  };
}

/**
 * v8.0.111 (TD-388): پیش‌نویس فاکتور فروش فقط وقتی ذخیره می‌شود که فرم ردیف یا خریدار داشته باشد. فرمی که پس از ثبت پاک
 * شده (نوع، انبار، ارز و نرخ مالیات سند قبلی را نگه می‌دارد) پیش‌نویس نیست.
 */
export function isEmptyInvoiceDraft(data: { docItems?: unknown[] | null; buyerName?: string | null }): boolean {
  return !(Array.isArray(data.docItems) && data.docItems.length > 0) && !(data.buyerName || '').trim();
}
