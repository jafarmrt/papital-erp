/**
 * v9.0.266 (TD-688، B10-01): قرارداد یک‌جای درخواست خرید، مشترک سرور (Zod و سرویس) و مرورگر (فرم‌ها و میز تدارکات).
 * پیش‌تر Zod اولویت را از `low|medium|high|emergency` و مقدار را از `quantity` می‌خواند، ولی فرم‌ها و سرویس
 * `urgent|high|normal|low` و `requestedQty` داشتند: هر ثبتی از فرم‌ها ۴۰۰ می‌گرفت و بدنه‌ای که از Zod می‌گذشت مقدار صفر
 * و نام «کالای سفارشی» ذخیره می‌کرد.
 */

/** اولویت‌های درخواست خرید؛ شمارنده «فوری» میز تدارکات همان `urgent` را می‌شمارد */
export const REQUISITION_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type RequisitionPriority = typeof REQUISITION_PRIORITIES[number];

export const REQUISITION_PRIORITY_LABELS: Record<RequisitionPriority, string> = {
  urgent: 'فوری',
  high: 'بالا',
  normal: 'عادی',
  low: 'پایین',
};

/** سقف شمار ردیف‌های یک درخواست خرید */
export const REQUISITION_MAX_ROWS = 200;

interface RequisitionRowLike {
  orderedQty?: number | string | null;
  receivedQty?: number | string | null;
  linkedDocumentIds?: unknown;
}

/** ردیفی که سفارش یا دریافت شده، یا به سندی پیوند خورده است */
export function requisitionRowHasOrder(row: RequisitionRowLike): boolean {
  return Number(row.orderedQty || 0) > 0
    || Number(row.receivedQty || 0) > 0
    || (Array.isArray(row.linkedDocumentIds) && row.linkedDocumentIds.length > 0);
}

/** درخواستی که دست‌کم یک ردیفش سفارش، دریافت یا به سندی پیوند خورده است */
export function requisitionHasOrders(req: { items?: RequisitionRowLike[] | null }): boolean {
  return (Array.isArray(req.items) ? req.items : []).some(requisitionRowHasOrder);
}

/**
 * v9.0.271 (TD-696، B10-09): وضعیت‌هایی که درخواست در آن‌ها ویرایش می‌شود: پیش از تأیید (`pending`) یا پس از رد شدن
 * (`rejected`)، و فقط وقتی هیچ ردیفی سفارش نشده است. پس از تأیید، ویرایش از بازگشت گردش کار (رد و بازگشایی) می‌گذرد.
 */
export const EDITABLE_REQUISITION_STATUSES: ReadonlySet<string> = new Set(['pending', 'rejected']);

export function canEditRequisition(req: { status?: string | null; items?: RequisitionRowLike[] | null }): boolean {
  return EDITABLE_REQUISITION_STATUSES.has(String(req.status)) && !requisitionHasOrders(req);
}

/** v9.0.274 (TD-694، ت۳): وضعیت درخواستی که در درخواست دیگری تجمیع شده است؛ بسته است و هیچ اقدامی نمی‌پذیرد */
export const CONSOLIDATED_REQUISITION_STATUS = 'consolidated';

/** v9.0.274 (TD-694، B10-07، ت۳ الف): وضعیت‌های پیش از تأیید که درخواست در آن‌ها تجمیع می‌شود */
export const CONSOLIDATABLE_REQUISITION_STATUSES: ReadonlySet<string> = new Set(['pending', 'under_review', 'manager_approval']);

/** درخواست فقط پیش از تأیید و وقتی هیچ ردیفش سفارش نشده تجمیع می‌شود؛ کادر انتخاب میز تدارکات همین را می‌خواند */
export function canConsolidateRequisition(req: { status?: string | null; items?: RequisitionRowLike[] | null }): boolean {
  return CONSOLIDATABLE_REQUISITION_STATUSES.has(String(req.status)) && !requisitionHasOrders(req);
}

/** v9.0.270 (TD-695، B10-08): درخواستی که سفارش یا دریافت شده حذف نمی‌شود؛ دکمه حذف میز تدارکات همین را می‌خواند.
 *  v9.0.274 (TD-694): درخواستِ تجمیع‌شده هم حذف نمی‌شود تا پیوندش به درخواست تجمیعی بماند. */
const UNDELETABLE_REQUISITION_STATUSES: ReadonlySet<string> = new Set(['ordered', 'received', 'completed', CONSOLIDATED_REQUISITION_STATUS]);

export function canDeleteRequisition(req: { status?: string | null; items?: RequisitionRowLike[] | null }): boolean {
  return !UNDELETABLE_REQUISITION_STATUSES.has(String(req.status)) && !requisitionHasOrders(req);
}
