/**
 * v9.0.314 (TD-688، B10-01): قرارداد یک‌جای درخواست خرید، مشترک سرور (Zod و سرویس) و مرورگر (فرم‌ها و میز تدارکات).
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
 * v9.0.319 (TD-696، B10-09): وضعیت‌هایی که درخواست در آن‌ها ویرایش می‌شود: پیش از تأیید (`pending`) یا پس از رد شدن
 * (`rejected`)، و فقط وقتی هیچ ردیفی سفارش نشده است. پس از تأیید، ویرایش از بازگشت گردش کار (رد و بازگشایی) می‌گذرد.
 */
export const EDITABLE_REQUISITION_STATUSES: ReadonlySet<string> = new Set(['pending', 'rejected']);

export function canEditRequisition(req: { status?: string | null; items?: RequisitionRowLike[] | null }): boolean {
  return EDITABLE_REQUISITION_STATUSES.has(String(req.status)) && !requisitionHasOrders(req);
}

/** v9.0.342 (TD-694، ت۳): وضعیت درخواستی که در درخواست دیگری تجمیع شده است؛ بسته است و هیچ اقدامی نمی‌پذیرد */
export const CONSOLIDATED_REQUISITION_STATUS = 'consolidated';

/** گام‌های پیش از تأیید درخواست خرید (گام‌های `pending`، `procurement_review` و `manager_approval` گردش کار) */
export const OPEN_REQUISITION_STATUSES: ReadonlySet<string> = new Set(['pending', 'under_review', 'manager_approval']);

/** v9.0.342 (TD-694، B10-07، ت۳ الف): وضعیت‌های پیش از تأیید که درخواست در آن‌ها تجمیع می‌شود */
export const CONSOLIDATABLE_REQUISITION_STATUSES: ReadonlySet<string> = OPEN_REQUISITION_STATUSES;

/** درخواست فقط پیش از تأیید و وقتی هیچ ردیفش سفارش نشده تجمیع می‌شود؛ کادر انتخاب میز تدارکات همین را می‌خواند */
export function canConsolidateRequisition(req: { status?: string | null; items?: RequisitionRowLike[] | null }): boolean {
  return CONSOLIDATABLE_REQUISITION_STATUSES.has(String(req.status)) && !requisitionHasOrders(req);
}

/** v9.0.318 (TD-695، B10-08): درخواستی که سفارش یا دریافت شده حذف نمی‌شود؛ دکمه حذف میز تدارکات همین را می‌خواند.
 *  v9.0.342 (TD-694): درخواستِ تجمیع‌شده هم حذف نمی‌شود تا پیوندش به درخواست تجمیعی بماند. */
const UNDELETABLE_REQUISITION_STATUSES: ReadonlySet<string> = new Set(['ordered', 'received', 'completed', CONSOLIDATED_REQUISITION_STATUS]);

export function canDeleteRequisition(req: { status?: string | null; items?: RequisitionRowLike[] | null }): boolean {
  return !UNDELETABLE_REQUISITION_STATUSES.has(String(req.status)) && !requisitionHasOrders(req);
}

interface OrderableRowLike extends RequisitionRowLike {
  requestedQty?: number | string | null;
  remainingQty?: number | string | null;
  closed?: boolean;
}

/**
 * v9.0.345 (TD-702، B10-15): دکمه «تفکیک و صدور سفارش» میز و جزئیات درخواست، با همان قاعده سرور (TD-689، ت۱): درخواست
 * تأییدشده (`ordered`) که ردیف باز با مانده دارد برای دارنده `procurement.order`، و درخواست پیش از تأیید فقط وقتی کاربر
 * حق تأیید هم دارد (سرور نخست انتقال تأیید را به نام او اجرا می‌کند).
 */
export function canOrderRequisition(
  req: { status?: string | null; items?: OrderableRowLike[] | null },
  access: { canOrder: boolean; canApprove: boolean },
): boolean {
  if (!access.canOrder) return false;
  const status = String(req.status);
  if (OPEN_REQUISITION_STATUSES.has(status)) return access.canApprove;
  if (status !== 'ordered') return false;
  return (Array.isArray(req.items) ? req.items : []).some(row => {
    if (row.closed) return false;
    const remaining = row.remainingQty ?? Math.max(0, Number(row.requestedQty || 0) - Number(row.orderedQty || 0));
    return Number(remaining) > 0;
  });
}

/**
 * v9.0.348 (TD-901، ت۵): نام فارسی اقدام‌های گردش کار درخواست خرید (عنوان انتقال‌های گردش کار پیش‌فرض). پیام خطا نام
 * اقدام را نشان می‌دهد، نه کلیدش؛ پیش‌تر «اقدام «cancel_order» … مجاز نیست» نمایش داده می‌شد.
 */
export const REQUISITION_ACTION_LABELS: Readonly<Record<string, string>> = {
  approve_request: 'تأیید و صدور دستور خرید',
  approve_order: 'تأیید سفارش',
  direct_order: 'سفارش مستقیم',
  direct_admin_order: 'سفارش مستقیم',
  receive_items: 'تحویل و ورود به انبار',
  mark_received: 'تحویل و ورود به انبار',
  receive: 'تحویل و ورود به انبار',
  reject_request: 'رد درخواست خرید',
  cancel_order: 'لغو یا رد سفارش',
  reopen: 'بازگشایی و بررسی دوباره',
};

/** نام اقدام: عنوان انتقال گردش کار، وگرنه نام فارسی کلید، وگرنه «اقدام درخواست‌شده»؛ هرگز خود کلید */
export function requisitionActionLabel(actionKey: string, transitionTitle?: string | null): string {
  const title = transitionTitle?.trim();
  if (title) return title;
  return REQUISITION_ACTION_LABELS[actionKey] ?? 'اقدام درخواست‌شده';
}

interface RequisitionFormRow {
  itemId?: number | null;
  itemName?: string;
  requestedQty?: number | string | null;
  unitPriceEstimate?: number | string | null;
}

/**
 * v9.0.348 (TD-901، ت۵): خطاهای فرم ثبت درخواست خرید به تفکیک فیلد، با همان پیام و کلید Zod سرور (`createRequisitionSchema`)
 * تا فرم هر پیام را زیر همان فیلد نشان دهد. کلید: `title`، `items` و `items.<ردیف>.<فیلد>`.
 */
export function requisitionFormErrors(title: string, rows: RequisitionFormRow[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!title.trim()) errors.title = 'عنوان درخواست خرید را وارد کنید';
  if (rows.length === 0) errors.items = 'دست‌کم یک قلم کالا برای درخواست خرید لازم است';
  rows.forEach((row, index) => {
    if ((row.itemId ?? null) === null && !String(row.itemName ?? '').trim()) {
      errors[`items.${index}.itemName`] = 'برای هر ردیف کالایی از فهرست کالا انتخاب کنید یا نام کالا را بنویسید';
    }
    const qty = row.requestedQty === '' || row.requestedQty === null || row.requestedQty === undefined ? NaN : Number(row.requestedQty);
    if (Number.isNaN(qty)) errors[`items.${index}.requestedQty`] = 'مقدار درخواستی را وارد کنید';
    else if (!(qty > 0)) errors[`items.${index}.requestedQty`] = 'مقدار درخواستی باید بیشتر از صفر باشد';
    if (Number(row.unitPriceEstimate || 0) < 0) errors[`items.${index}.unitPriceEstimate`] = 'برآورد قیمت واحد نمی‌تواند منفی باشد';
  });
  return errors;
}
