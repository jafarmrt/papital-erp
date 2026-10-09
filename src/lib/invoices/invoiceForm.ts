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
  /** v9.0.300 (TD-790): انبار خود ردیف در پیش‌فاکتور چندانباره؛ بی آن ردیف از انبار بالای فرم است */
  location?: string;
}

/** ردیف اقلام سند در پاسخ GET /documents/:id (کلیدهای camelCase و snake_case) */
export interface InvoiceDocumentLine {
  itemId?: number;
  item_id?: number;
  itemCode?: string;
  item_code?: string;
  code?: string | null;
  itemName?: string;
  item_name?: string;
  name?: string | null;
  itemUnit?: string;
  unit?: string;
  current_stock?: number;
  quantity?: number | string;
  unitPrice?: number | string;
  unit_price?: number | string;
  discount?: number | string;
  /** انبار ردیف (سند ستون انبار ندارد؛ انبار در ردیف است) */
  location?: string | null;
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
  crmLeadId?: number | null;
  /** v9.0.336 (TD-778): طرف حساب سند با شناسه */
  partyId?: number | null;
  /** v10.0.x (TD-972): نسخه سند که ویرایش آن را می‌فرستد */
  version?: number | null;
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
  /** v10.0.x (TD-972): ویرایش نسخه‌ای را می‌فرستد که فرم از آن ساخته شده است */
  version?: number;
  items: Array<{ itemId: number; quantity: number; unit_price: number; discount: number; location: string }>;
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

/**
 * v9.0.299 (TD-789): این فرم فقط سند فروش ثبت می‌کند. نوعی که از سند بارشده، پیش‌نویس یا پرونده فروش می‌آید و فروش نیست
 * (مثلاً پیش‌فاکتور خرید، `receipt` با وضعیت `proforma`) پذیرفته نمی‌شود؛ پیش‌تر همان نوع می‌ماند و فاکتور بعدی «رسید» ثبت می‌شد.
 */
export const SALES_FORM_DOC_TYPES: readonly string[] = ['invoice', 'proforma'];

export function isSalesFormDocType(type: string | null | undefined): boolean {
  return typeof type === 'string' && SALES_FORM_DOC_TYPES.includes(type);
}

/**
 * v9.0.304 (TD-801): ویرایش پیش‌فاکتور آن را قطعی نمی‌کند؛ `PUT /documents/:id` وضعیت «نهایی» را نمی‌پذیرد و پیش‌فاکتور از
 * گردش کار تأیید خودش قطعی می‌شود. پس گزینه «فاکتور نهایی» در ویرایش بسته است و دلیلش کنار آن نوشته می‌شود.
 */
export const EDIT_FINAL_REFUSED = 'پیش‌فاکتور در ویرایش قطعی نمی‌شود؛ آن را از گردش کار تأیید پیش‌فاکتور قطعی کنید.';

export function finalStatusOptionNote(canFinalizeSales: boolean, isEditing: boolean): string {
  if (!canFinalizeSales) return ' - نیاز به مجوز «قطعی کردن سند فروش»';
  if (isEditing) return ' - پیش‌فاکتور از گردش کار تأیید قطعی می‌شود';
  return '';
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
  /** پرونده فروشی که خود سند به آن وصل است (نه پرونده‌ای که فرم پیش‌تر از آن باز شده بود) */
  crmLeadId: number | null;
  /** v9.0.336 (TD-778): طرف حساب ذخیره‌شده سند؛ انتخابگر خریدار با آن پر می‌شود، نه با تطبیق نام */
  partyId: number | null;
  /** v10.0.x (TD-972): نسخه سند بارشده؛ ویرایش بدون آن ۴۰۰ و با نسخه کهنه ۴۰۹ می‌گیرد */
  version: number | null;
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
    crmLeadId: Number(doc.crmLeadId) > 0 ? Number(doc.crmLeadId) : null,
    partyId: Number(doc.partyId) > 0 ? Number(doc.partyId) : null,
    version: Number(doc.version) > 0 ? Number(doc.version) : null,
    docItems: Array.isArray(doc.items)
      ? doc.items.map(it => ({
        item: {
          id: it.itemId || it.item_id,
          // v9.0.304 (TD-801): سرور کد کالای ردیف را با کلید `code` می‌فرستد؛ پیش‌تر کد در ویرایش پیش‌فاکتور خالی می‌ماند
          code: it.itemCode || it.item_code || it.code || '',
          name: it.itemName || it.item_name || it.name || 'کالا',
          unit: it.itemUnit || it.unit || 'عدد',
          current_stock: it.current_stock || 0,
        } as Item,
        quantity: Number(it.quantity || 0),
        unitPrice: Number(it.unitPrice || it.unit_price || 0),
        discount: Number(it.discount || 0),
        location: it.location || undefined,
      }))
      : null,
  };
}

export interface InvoiceLineLocations {
  lines: InvoiceDocItem[];
  /** انبار بالای فرم: انبار مشترک ردیف‌ها، یا در سند چندانباره انبار نخستین ردیف */
  header: string | null;
  multiWarehouse: boolean;
}

/**
 * v9.0.300 (TD-790): انبار سند بارشده از ردیف‌هایش خوانده می‌شود (سند ستون انبار ندارد). پیش‌تر فرم `doc.location` را می‌خواند
 * که نیست و نخستین انبار را برای همه ردیف‌ها می‌فرستاد، پس رزرو انبار ۲ با هر ویرایش به انبار ۱ می‌رفت. انباری که در فهرست
 * انبارهای فعال نیست کنار گذاشته می‌شود. ردیف‌های یک انبار انبار بالا را می‌گیرند و با آن جابه‌جا می‌شوند؛ در سند چندانباره هر
 * ردیف انبار خودش را نگه می‌دارد.
 */
export function invoiceLineLocations(lines: InvoiceDocItem[], warehouseCodes: readonly string[]): InvoiceLineLocations {
  const known = new Set(warehouseCodes);
  const located = lines.map(line => ({ ...line, location: line.location && known.has(line.location) ? line.location : undefined }));
  const distinct = [...new Set(located.map(line => line.location).filter((loc): loc is string => Boolean(loc)))];
  if (distinct.length <= 1) {
    return { lines: located.map(line => ({ ...line, location: undefined })), header: distinct[0] ?? null, multiWarehouse: false };
  }
  return { lines: located, header: located.find(line => line.location)?.location ?? null, multiWarehouse: true };
}

/** انبار مؤثر ردیف: انبار خودش، وگرنه انبار بالای فرم */
export function lineLocationOf(line: Pick<InvoiceDocItem, 'location'>, headerLocation: string): string {
  return line.location || headerLocation;
}

/** افزودن ردیف: کالای تکراری در همان انبار به مقدار ردیف موجود اضافه می‌شود، در انبار دیگر ردیف تازه است */
export function addInvoiceLine(lines: InvoiceDocItem[], line: InvoiceDocItem, headerLocation: string): InvoiceDocItem[] {
  const target = lineLocationOf(line, headerLocation);
  const index = lines.findIndex(p => p.item.id === line.item.id && lineLocationOf(p, headerLocation) === target);
  if (index < 0) return [...lines, line];
  return lines.map((p, i) => (i === index ? { ...p, quantity: p.quantity + line.quantity } : p));
}

/**
 * v8.0.111 (TD-388): پیش‌نویس فاکتور فروش فقط وقتی ذخیره می‌شود که فرم ردیف یا خریدار داشته باشد. فرمی که پس از ثبت پاک
 * شده پیش‌نویس نیست.
 */
export function isEmptyInvoiceDraft(data: { docItems?: unknown[] | null; buyerName?: string | null }): boolean {
  return !(Array.isArray(data.docItems) && data.docItems.length > 0) && !(data.buyerName || '').trim();
}
