/**
 * v9.0.278 (TD-697، B10-10): قرارداد فهرست‌های تدارکات، مشترک سرور (Zod و سرویس) و میز تدارکات. پیش‌تر فیلتر وضعیت
 * فهرست درخواست‌ها `draft|approved|delivered|cancelled` را می‌پذیرفت که هرگز نوشته نمی‌شوند و `under_review`،
 * `manager_approval` و `received` را با ۴۰۰ رد می‌کرد؛ سرویس سقف ۱۰۰ داشت و Zod سقف ۲۰۰، و پاسخ همان `limit` درخواستی
 * را برمی‌گرداند؛ میز ۱۰۰ درخواست آخر را می‌خواند و جست‌وجو و فیلتر را در مرورگر روی همان ۱۰۰ ردیف انجام می‌داد.
 */

/** سقف ردیف‌های یک صفحه فهرست درخواست‌ها و سفارش‌های تدارکات؛ پاسخ همان سقفی را برمی‌گرداند که به کار رفته است */
export const PROCUREMENT_LIST_MAX_LIMIT = 200;
export const PROCUREMENT_LIST_DEFAULT_LIMIT = 50;
/** اندازه صفحه میز تدارکات */
export const PROCUREMENT_DESK_PAGE_SIZE = 20;

/**
 * فیلترهای وضعیت فهرست درخواست‌ها و وضعیت‌های ذخیره‌شده هر یک. `open` گام‌های پیش از تأیید است؛ وضعیت‌های قدیمی
 * (`approved`، `completed`، `cancelled`) در گروه هم‌معنای خود شمرده می‌شوند.
 */
export const REQUISITION_STATUS_FILTERS = {
  all: [],
  open: ['pending', 'under_review', 'manager_approval'],
  pending: ['pending'],
  under_review: ['under_review'],
  manager_approval: ['manager_approval'],
  ordered: ['ordered', 'approved'],
  received: ['received', 'completed'],
  rejected: ['rejected', 'cancelled'],
  consolidated: ['consolidated'],
} as const satisfies Record<string, readonly string[]>;

export type RequisitionStatusFilter = keyof typeof REQUISITION_STATUS_FILTERS;
export const REQUISITION_STATUS_FILTER_KEYS = Object.keys(REQUISITION_STATUS_FILTERS) as [RequisitionStatusFilter, ...RequisitionStatusFilter[]];

/** وضعیت‌های ذخیره‌شده یک فیلتر؛ `null` یعنی همه وضعیت‌ها */
export function requisitionStatusesOf(filter: string | undefined): readonly string[] | null {
  if (!filter || !(filter in REQUISITION_STATUS_FILTERS)) return null;
  const statuses: readonly string[] = REQUISITION_STATUS_FILTERS[filter as RequisitionStatusFilter];
  return statuses.length > 0 ? statuses : null;
}

/** زبانه‌های وضعیت میز تدارکات */
export const REQUISITION_DESK_STATUS_TABS: ReadonlyArray<{ id: RequisitionStatusFilter; label: string }> = [
  { id: 'all', label: 'همه درخواست‌ها' },
  { id: 'open', label: 'در انتظار بررسی و تأیید' },
  { id: 'ordered', label: 'تأییدشده (در حال خرید)' },
  { id: 'received', label: 'خرید و تحویل انبار شده (تکمیل)' },
  { id: 'rejected', label: 'ردشده / لغو' },
  { id: 'consolidated', label: 'تجمیع‌شده' },
];

/** فیلترهای وضعیت فهرست سفارش‌های تدارکات */
export const PROCUREMENT_ORDER_STATUS_FILTERS = ['all', 'draft', 'pending_delivery', 'final', 'delivered'] as const;
export type ProcurementOrderStatusFilter = typeof PROCUREMENT_ORDER_STATUS_FILTERS[number];

/** صفحه و سقف به‌کاررفته: صفحه از ۱، سقف میان ۱ و سقف فهرست */
export function procurementListPage(page: number | undefined, limit: number | undefined): { page: number; limit: number } {
  const safePage = Number.isInteger(page) && Number(page) > 0 ? Number(page) : 1;
  const wanted = Number.isInteger(limit) && Number(limit) > 0 ? Number(limit) : PROCUREMENT_LIST_DEFAULT_LIMIT;
  return { page: safePage, limit: Math.min(wanted, PROCUREMENT_LIST_MAX_LIMIT) };
}

/** شمار صفحه‌های یک فهرست (دست‌کم ۱) */
export function procurementPageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, limit)));
}
