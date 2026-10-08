/**
 * TD-080 (بخش ۳): منطق خالص صفحه «لیست اسناد، فاکتورها و رسیدهای انبار» — منتقل‌شده بدون تغییر رفتار
 * از InvoicesListPage. هر جمع و هر نگاشت دقیقاً همان عبارت جای اصلی خود را دارد (از جمله تفاوت‌ها:
 * جمع ردیف‌های جدول با `|| 0` و جمع‌های مودال جزئیات بدون آن).
 * v7.0.98 (TD-235 بند ۴): جمع و تفریق مبالغ و تعدادها با FinancialDecimal است، نه `+` جاوااسکریپت
 * (مثلاً ۰٫۱ + ۰٫۲ دلار دقیقاً ۰٫۳ می‌شود)؛ مقدار نامعتبر صفر حساب می‌شود.
 */
import { fin } from '../financialDecimal';
import { documentTypeTitle } from '../documents/documentTypeTitles';

/** یک ردیف کالا در سند (پاسخ GET /documents/:id یا لیست) */
export interface InvoiceListLine {
  id?: number;
  item_id?: number;
  code?: string;
  name?: string;
  unit?: string;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  discount?: number | string | null;
}

/** یک سند در لیست GET /documents (و همان سند با اقلام کامل در مودال جزئیات) */
export interface InvoiceListDocument {
  id: number;
  type?: string;
  status?: string;
  ref_number?: string;
  date?: string;
  currency?: string;
  user?: string;
  buyer_name?: string | null;
  /** v9.0.336 (TD-778): طرف حساب سند با شناسه؛ فرم تسویه آن را می‌فرستد (v9.0.459، TD-907) */
  partyId?: number | null;
  buyer_phone?: string | null;
  buyer_city?: string | null;
  notes?: string;
  items?: InvoiceListLine[];
  itemsCount?: number;
  totalQuantity?: number | string;
  totalAmount?: number;
  vatAmount?: number;
  /** v7.0.103 (TD-191): هزینه ارسال و کارمزد فاکتور (سفارش ووکامرس) */
  serviceChargeAmount?: number;
  payableAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  settlementStatus?: string;
}

/** پاسخ صفحه‌بندی‌شده GET /documents */
export interface InvoiceListResponse {
  data?: InvoiceListDocument[];
  total?: number;
  totalPages?: number;
}

/** reducer جمع خالص یک ردیف: (تعداد × قیمت واحد) − تخفیف */
export const addLineNet = (acc: number, i: InvoiceListLine): number =>
  fin(acc).add(fin(i.quantity).multiply(i.unit_price)).subtract(i.discount).toNumber();

/** reducer جمع ناخالص: تعداد × قیمت واحد */
export const addLineGross = (acc: number, i: InvoiceListLine): number =>
  fin(acc).add(fin(i.quantity).multiply(i.unit_price)).toNumber();

/** reducer جمع تخفیف */
export const addLineDiscount = (acc: number, i: InvoiceListLine): number => fin(acc).add(i.discount).toNumber();

/** reducer جمع تعداد */
export const addLineQuantity = (acc: number, i: InvoiceListLine): number => fin(acc).add(i.quantity).toNumber();

/** مبلغ کل سند: totalAmount سرور، وگرنه جمع خالص اقلام */
export function documentAmountOf(d: InvoiceListDocument): number {
  return Number(d.totalAmount !== undefined
    ? d.totalAmount
    : (d.items?.reduce(addLineNet, 0) || 0)
  );
}

/**
 * v7.0.94 (TD-235 بند ۱): مبلغ قابل پرداخت سند = خالص اقلام + مالیات ساختاریافته (AGENTS §۶)؛ payableAmount سرور،
 * وگرنه مبلغ خالص به‌علاوه vatAmount (و از v7.0.103 هزینه ارسال و خدمات، TD-191). ستون «مبلغ سند» جدول و «جمع کل ارزش نهایی سند» پنجره جزئیات همین را نشان می‌دهند.
 */
export function documentPayableOf(d: InvoiceListDocument): number {
  if (d.payableAmount !== undefined && d.payableAmount !== null) return Number(d.payableAmount);
  return fin(documentAmountOf(d)).add(d.vatAmount).add(d.serviceChargeAmount).toNumber();
}

/**
 * v7.0.95 (TD-235 بند ۳): نام وضعیت سند؛ پیش‌تر هر وضعیتی جز پیش‌فاکتور (از جمله پیش‌نویس) «نهایی» نمایش داده می‌شد.
 * finalLabel متن وضعیت نهایی همان محل نمایش است («نهایی» یا «نهایی‌شده»).
 */
export function documentStatusLabelOf(status: string | undefined, finalLabel = 'نهایی'): string {
  if (status === 'proforma') return 'پیش‌فاکتور';
  if (status === 'draft') return 'پیش‌نویس';
  return finalLabel;
}

/**
 * v7.0.96 (TD-235 بند ۲): رقم اعشار مبالغ یک سند؛ سند ارزی تا ۲ رقم (مثل ۲۰۰٫۵ دلار)، ریالی بدون اعشار.
 * پیش‌تر مبلغ و مانده ردیف بدون ارز قالب‌بندی و اعشار سند ارزی گرد می‌شد.
 */
export function amountDecimalsOf(currency: string | undefined): number {
  return currency && currency !== 'IRR' ? 2 : 0;
}

export interface InvoiceListSummary {
  salesTotals: Record<string, number>;
  salesCount: number;
  purchaseTotals: Record<string, number>;
  purchaseCount: number;
  proformaTotals: Record<string, number>;
  proformaCount: number;
  otherCount: number;
}

/**
 * کارت‌های خلاصه بالای صفحه — V9 Phase 3: گروه‌بندی مبالغ بر اساس ارز هر سند
 * (رفع جمع‌شدن ارزهای ناهمگون در یک عدد واحد با برچسب ثابت «ریال»)
 * v9.0.343 (TD-798، یافته B08-29): جمع هر کارت مبلغ قابل پرداخت (`documentPayableOf`: خالص + مالیات + هزینه خدمات)
 * است، همان رقمی که ردیف هر سند نشان می‌دهد؛ پیش‌تر فقط خالص اقلام جمع می‌شد.
 */
export function computeInvoiceListSummary(docs: InvoiceListDocument[]): InvoiceListSummary {
  const salesTotals: Record<string, number> = {};
  let salesCount = 0;
  const purchaseTotals: Record<string, number> = {};
  let purchaseCount = 0;
  const proformaTotals: Record<string, number> = {};
  let proformaCount = 0;
  let otherCount = 0;

  const addTo = (bucket: Record<string, number>, cur: string, amount: number) => {
    bucket[cur] = fin(bucket[cur]).add(amount).toNumber();
  };

  for (const d of docs) {
    const docAmount = documentPayableOf(d);
    const cur = String(d.currency || 'IRR');

    if (d.status === 'proforma' || d.type === 'proforma') {
      addTo(proformaTotals, cur, docAmount);
      proformaCount++;
    } else if (d.type === 'invoice' && d.status !== 'draft') {
      // v7.0.95 (TD-235 بند ۳): پیش‌نویس جزو «فاکتور فروش نهایی» شمرده نمی‌شود
      addTo(salesTotals, cur, docAmount);
      salesCount++;
    } else if (d.type === 'receipt' && d.status !== 'draft') {
      addTo(purchaseTotals, cur, docAmount);
      purchaseCount++;
    } else {
      otherCount++;
    }
  }

  return {
    salesTotals,
    salesCount,
    purchaseTotals,
    purchaseCount,
    proformaTotals,
    proformaCount,
    otherCount
  };
}

/**
 * v9.0.344 (TD-800، یافته B08-31): صافی «پیش‌فاکتور فروش». پیش‌فاکتور فروش دو شکل دارد: نوع `proforma` (کاربر بی مجوز
 * `documents.finalize`) و نوع `invoice` با وضعیت `proforma`؛ پس این صافی وضعیت `proforma` را روی هر دو نوع فروش می‌خواهد
 * (مثل فهرست پیش‌فاکتورهای باز فرم فاکتور)، نه فقط `type=proforma`. پیش‌فاکتور خرید (رسید با وضعیت `proforma`) در آن نیست.
 */
export const SALES_PROFORMA_FILTER = 'proforma';

export function invoiceListTypeFilter(filterType: string, filterStatus: string): { type: string; types?: string; status: string } {
  if (filterType === SALES_PROFORMA_FILTER) return { type: 'all', types: 'invoice,proforma', status: 'proforma' };
  return { type: filterType, status: filterStatus };
}

export type InvoiceTypeBadgeKind = 'stock' | 'receipt' | 'invoice' | 'proforma' | 'remittance' | 'return' | 'waste';

export interface InvoiceRowFigures {
  isReceipt: boolean;
  isInvoice: boolean;
  isProforma: boolean;
  badgeKind: InvoiceTypeBadgeKind;
  itemsCount: number;
  totalQty: number | string;
  totalDocAmount: number;
  isCommercial: boolean;
  settlementStatus: string;
  remainingAmt: number;
}

/** ارقام و نوع یک ردیف جدول اسناد (تعداد، مبلغ، وضعیت تسویه و مانده) */
export function resolveInvoiceRowFigures(doc: InvoiceListDocument): InvoiceRowFigures {
  const isReceipt = doc.type === 'receipt';
  const isInvoice = doc.type === 'invoice';
  const isProforma = doc.status === 'proforma' || doc.type === 'proforma';
  const isRemittance = doc.type === 'remittance';
  const isReturn = doc.type === 'return';
  const isWaste = doc.type === 'waste';

  let badgeKind: InvoiceTypeBadgeKind = 'stock';
  if (isReceipt) badgeKind = 'receipt';
  else if (isInvoice) badgeKind = 'invoice';
  else if (isProforma) badgeKind = 'proforma';
  else if (isRemittance) badgeKind = 'remittance';
  else if (isReturn) badgeKind = 'return';
  else if (isWaste) badgeKind = 'waste';

  // Numerical Calculations
  const itemsCount = doc.itemsCount !== undefined ? doc.itemsCount : (doc.items?.length || 0);
  const totalQty = doc.totalQuantity !== undefined
    ? doc.totalQuantity
    : (doc.items?.reduce(addLineQuantity, 0) || 0);

  const totalDocAmount = documentPayableOf(doc);

  // Settlement calculations
  const isCommercial = (isInvoice || isReceipt) && totalDocAmount > 0;
  const settlementStatus = doc.settlementStatus || (isCommercial ? 'unpaid' : 'none');
  const paidAmt = Number(doc.paidAmount || 0);
  const remainingAmt = doc.remainingAmount !== undefined ? Number(doc.remainingAmount) : Math.max(0, fin(totalDocAmount).subtract(paidAmt).toNumber());

  return { isReceipt, isInvoice, isProforma, badgeKind, itemsCount, totalQty, totalDocAmount, isCommercial, settlementStatus, remainingAmt };
}

/** برچسب و رنگ نشان نوع سند در جدول (آیکون در کامپوننت) */
export const INVOICE_TYPE_BADGES: Record<InvoiceTypeBadgeKind, { label: string; bg: string }> = {
  stock: { label: 'سند انبار', bg: 'bg-slate-100 text-slate-800 border-slate-200' },
  receipt: { label: 'رسید ورود (خرید کالا)', bg: 'bg-emerald-50 text-emerald-800 border-emerald-200 font-bold' },
  invoice: { label: 'فاکتور فروش', bg: 'bg-blue-50 text-blue-800 border-blue-200 font-bold' },
  proforma: { label: 'پیش‌فاکتور', bg: 'bg-amber-50 text-amber-800 border-amber-200 font-bold' },
  remittance: { label: 'حواله خروج / مصرف', bg: 'bg-purple-50 text-purple-800 border-purple-200 font-bold' },
  return: { label: 'برگشت از فروش', bg: 'bg-orange-50 text-orange-800 border-orange-200 font-bold' },
  waste: { label: 'حواله ضایعات', bg: 'bg-rose-50 text-rose-800 border-rose-200 font-bold' },
};

/** متن طرف حساب در ردیف جدول */
export function partyLabelOf(doc: InvoiceListDocument, figures: Pick<InvoiceRowFigures, 'isReceipt' | 'isInvoice' | 'isProforma'>): string | null | undefined {
  const { isReceipt, isInvoice, isProforma } = figures;
  return isReceipt ? `تامین‌کننده: ${doc.buyer_name}` : isInvoice || isProforma ? `مشتری: ${doc.buyer_name}` : doc.buyer_name;
}

/** عنوان سربرگ مودال جزئیات سند */
export function detailsTitleOf(type: string | undefined): string {
  return type === 'receipt' ? 'رسید ورود و فاکتور خرید' : type === 'invoice' ? 'صورتحساب فروش کالا' : 'جزئیات سند انبارداری';
}

/**
 * v9.0.344 (TD-800، یافته B08-31): نام فارسی نوع سند در پنجره جزئیات و گردش کار؛ پیش‌تر هر نوعی جز فاکتور و رسید
 * (حواله، پیش‌فاکتور، برگشت، ضایعات، رسید تولید) با نام لاتین خامش نمایش داده می‌شد. نوع‌های جدول همان برچسب
 * `INVOICE_TYPE_BADGES` را دارند و بقیه نام `DOCUMENT_TYPE_TITLES`.
 */
function documentTypeLabelOf(type: string): string {
  const badge = (INVOICE_TYPE_BADGES as Record<string, { label: string } | undefined>)[type];
  return type !== 'stock' && badge ? badge.label : documentTypeTitle(type);
}

/** «نوع سند» در کارت اطلاعات مودال جزئیات */
export function detailsTypeLabelOf(type: string | undefined): string | undefined {
  if (!type) return type;
  return type === 'receipt' ? 'رسید ورود (خرید کالا)' : documentTypeLabelOf(type);
}

/** «نوع سند» در مودال گردش‌کار */
export function workflowTypeLabelOf(type: string | undefined): string | undefined {
  if (!type) return type;
  return type === 'receipt' ? 'رسید ورود' : documentTypeLabelOf(type);
}

/** برچسب و رنگ‌های وضعیت تسویه در کارت تسویه مودال جزئیات */
export function detailsSettlementViewOf(settlementStatus: string | undefined): { label: string; iconClass: string; badgeClass: string } {
  if (settlementStatus === 'fully_paid') {
    return { label: 'تسویه کامل', iconClass: 'bg-emerald-100 text-emerald-700', badgeClass: 'bg-emerald-100 text-emerald-800' };
  }
  if (settlementStatus === 'partially_paid') {
    return { label: 'تسویه ناقص', iconClass: 'bg-amber-100 text-amber-700', badgeClass: 'bg-amber-100 text-amber-800' };
  }
  return { label: 'تسویه نشده', iconClass: 'bg-rose-100 text-rose-700', badgeClass: 'bg-rose-100 text-rose-800' };
}

/** مانده تسویه در مودال جزئیات: remainingAmount سرور، وگرنه مبلغ قابل پرداخت − paidAmount (حداقل صفر، v7.0.94) */
export function detailsRemainingOf(doc: InvoiceListDocument): number {
  return doc.remainingAmount !== undefined ? doc.remainingAmount : Math.max(0, fin(documentPayableOf(doc)).subtract(doc.paidAmount).toNumber());
}

/** v9.0.402 (TD-828): the search a link put in the documents list address (`?search=`), or '' */
export function invoiceListSearchFromAddress(locationSearch: string): string {
  return (new URLSearchParams(locationSearch).get('search') ?? '').trim();
}
