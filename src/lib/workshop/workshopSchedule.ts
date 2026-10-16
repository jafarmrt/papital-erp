import { toStorageDate } from '../../utils/calendarDate';
import { toPersianDigits } from '../../utils/persianNumber';

/**
 * v10.1.38 (N-01 part 2, mobile workshop plan §4.3): the rows of a project's workshop schedule
 * (`production_projects.stage_schedules`: stage id → product id → `{ endDate, productName, tasks: [...] }`) read as the
 * workshop cartable needs them, plus the deadline, report and error rules shared by the server and the cartable screens.
 */

export interface WorkshopScheduleRow {
  stageId: number;
  productId: string;
  rowId: string;
  taskId: number | null;
  taskTitle: string;
  personnelId: number | null;
  quantity: number;
  unit: string;
  /** the row's own end date, else its product schedule's, as stored (ISO or a legacy Jalali text) */
  endDate: string;
  productName: string;
  /** the work log written for the row, when any (its liveness is checked by the server) */
  pieceworkLogId: number | null;
  /** a row marked logged by a version before v9.0.282, without a log id */
  legacyLogged: boolean;
}

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());

/** Every row of a stored schedule that has an id; a malformed part is skipped, never thrown. */
export function workshopScheduleRows(schedules: unknown): WorkshopScheduleRow[] {
  const rows: WorkshopScheduleRow[] = [];
  if (!isObject(schedules)) return rows;
  for (const [stageKey, stage] of Object.entries(schedules)) {
    const stageId = Number(stageKey);
    if (!Number.isInteger(stageId) || stageId <= 0 || !isObject(stage)) continue;
    for (const [productId, product] of Object.entries(stage)) {
      if (!isObject(product) || !Array.isArray(product.tasks)) continue;
      for (const task of product.tasks) {
        if (!isObject(task) || typeof task.id !== 'string' || task.id === '') continue;
        const taskId = Number(task.taskId);
        const personnelId = Number(task.assignedPersonnelId);
        const logId = Number(task.pieceworkLogId);
        const quantity = Number(task.quantity);
        rows.push({
          stageId,
          productId,
          rowId: task.id,
          taskId: Number.isInteger(taskId) && taskId > 0 ? taskId : null,
          taskTitle: text(task.taskTitle),
          personnelId: Number.isInteger(personnelId) && personnelId > 0 ? personnelId : null,
          quantity: Number.isFinite(quantity) ? quantity : 0,
          unit: text(task.unit) || 'عدد',
          endDate: text(task.endDate) || text(product.endDate),
          productName: text(product.productName),
          pieceworkLogId: Number.isInteger(logId) && logId > 0 ? logId : null,
          legacyLogged: task.isLoggedToPiecework === true,
        });
      }
    }
  }
  return rows;
}

/** The row's deadline as an ISO date: its own or its product's end date, else the project's end date; none → null. */
export function taskDeadlineIso(row: Pick<WorkshopScheduleRow, 'endDate'>, projectEndDate: unknown): string | null {
  return toStorageDate(row.endDate) || toStorageDate(projectEndDate) || null;
}

const DAY_MS = 86_400_000;

/** Whole days from `todayIso` to `deadlineIso` (0 = today, negative = past). */
export function daysUntilDeadline(deadlineIso: string, todayIso: string): number {
  return Math.round((Date.parse(`${deadlineIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / DAY_MS);
}

/** «مهلت: ۳ روز مانده», «امروز مهلت است» or «۲ روز از مهلت گذشته» */
export function deadlineLabel(days: number | null): string {
  if (days === null) return 'بی مهلت';
  if (days > 0) return `مهلت: ${toPersianDigits(days)} روز مانده`;
  if (days === 0) return 'امروز مهلت است';
  return `${toPersianDigits(-days)} روز از مهلت گذشته`;
}

/** Decision ت۸ الف: one reminder the day before the deadline (or on it) and one after it. */
export const WORKSHOP_REMINDER_DUE_SOON = 'workshop_task_due_soon';
export const WORKSHOP_REMINDER_OVERDUE = 'workshop_task_overdue';
export function workshopReminderKind(days: number | null): typeof WORKSHOP_REMINDER_DUE_SOON | typeof WORKSHOP_REMINDER_OVERDUE | null {
  if (days === null) return null;
  if (days < 0) return WORKSHOP_REMINDER_OVERDUE;
  if (days <= 1) return WORKSHOP_REMINDER_DUE_SOON;
  return null;
}

export interface WorkshopRowRef {
  projectId: number;
  stageId: number;
  productId: string;
  rowId: string;
}

/** The cartable link of one schedule row; also the key that makes each reminder unique per row. */
export function workshopRowLink(ref: WorkshopRowRef): string {
  return `/workshop?row=${encodeURIComponent(`${ref.projectId}:${ref.stageId}:${ref.productId}:${ref.rowId}`)}`;
}

/** Report statuses (`chk_workshop_task_reports_status`); a submitted or approved report is the row's live report (ت۵ الف). */
export const WORKSHOP_REPORT_STATUSES = ['submitted', 'approved', 'rejected', 'withdrawn'] as const;
export type WorkshopReportStatus = (typeof WORKSHOP_REPORT_STATUSES)[number];
export const WORKSHOP_REPORT_STATUS_LABELS: Record<WorkshopReportStatus, string> = {
  submitted: 'در انتظار تأیید مسئول',
  approved: 'تأییدشده',
  rejected: 'ردشده',
  withdrawn: 'پس‌گرفته',
};

/** Delivery confirmations (`chk_stock_receipt_confirmations_status`, decision ت۱ الف). */
export const DELIVERY_CONFIRMATION_STATUSES = ['received', 'discrepancy'] as const;
export type DeliveryConfirmationStatus = (typeof DELIVERY_CONFIRMATION_STATUSES)[number];
export const DELIVERY_CONFIRMATION_LABELS: Record<DeliveryConfirmationStatus, string> = {
  received: 'تحویل گرفتم',
  discrepancy: 'مغایرت دارد',
};

export const WORKSHOP_NOTE_MAX = 1000;
export const WORKSHOP_QUANTITY_MAX_DECIMALS = 4;

export const WORKSHOP_ERRORS = {
  personnelNotLinked: { code: 'WORKSHOP_PERSONNEL_NOT_LINKED', message: 'حساب شما به پرونده پرسنلی وصل نیست؛ از مدیر سامانه بخواهید آن را وصل کند.' },
  rowNotFound: { code: 'WORKSHOP_ROW_NOT_FOUND', message: 'این کار در برنامه ذخیره‌شده پروژه نیست یا به شما سپرده نشده است.' },
  rowLogged: { code: 'WORKSHOP_ROW_LOGGED', message: 'کارکرد این کار پیش‌تر ثبت شده است.' },
  rowNoTask: { code: 'WORKSHOP_ROW_NO_TASK', message: 'عنوان کار این ردیف در برنامه پروژه مشخص نشده است؛ به مسئول پروژه بگویید.' },
  projectClosed: { code: 'WORKSHOP_PROJECT_CLOSED', message: 'این پروژه بسته یا لغو شده است و گزارش کار نمی‌پذیرد.' },
  reportExists: { code: 'WORKSHOP_REPORT_EXISTS', message: 'برای این کار گزارشی در انتظار تأیید یا تأییدشده هست.' },
  quantityInvalid: { code: 'WORKSHOP_REPORT_QUANTITY_INVALID', message: 'تعداد باید عددی بزرگ‌تر از صفر و حداکثر با چهار رقم اعشار باشد.' },
  quantityExceeded: { code: 'WORKSHOP_REPORT_QUANTITY_EXCEEDED', message: 'تعداد بیش از برنامه است؛ به مسئول پروژه بگویید.' },
  reportNotFound: { code: 'WORKSHOP_REPORT_NOT_FOUND', message: 'گزارش کار پیدا نشد.' },
  reportNotSubmitted: { code: 'WORKSHOP_REPORT_NOT_SUBMITTED', message: 'این گزارش دیگر در انتظار تأیید نیست.' },
  reportStale: { code: 'OCC_CONFLICT', message: 'این گزارش در این میان تغییر کرده است؛ فهرست را دوباره باز کنید.' },
  notProjectManager: { code: 'WORKSHOP_NOT_PROJECT_MANAGER', message: 'فقط مسئولان این پروژه گزارش کار آن را بررسی می‌کنند.' },
  ownReport: { code: 'WORKSHOP_OWN_REPORT', message: 'گزارش کار خودتان را مسئول دیگری از این پروژه بررسی می‌کند.' },
  rejectReasonRequired: { code: 'WORKSHOP_REJECT_REASON_REQUIRED', message: 'دلیل رد گزارش را بنویسید.' },
  deliveryNotFound: { code: 'WORKSHOP_DELIVERY_NOT_FOUND', message: 'این حواله یا تخصیص به نام شما ثبت نشده یا دیگر قطعی نیست.' },
  deliveryConfirmed: { code: 'WORKSHOP_DELIVERY_ALREADY_CONFIRMED', message: 'دریافت این حواله پیش‌تر پاسخ داده شده است.' },
  discrepancyNoteRequired: { code: 'WORKSHOP_DISCREPANCY_NOTE_REQUIRED', message: 'برای «مغایرت دارد» توضیح بنویسید که چه چیزی کم یا متفاوت بود.' },
} as const;

/** A worker's or a manager's quantity: above zero, at most four decimals, not above the planned quantity when one is set. */
export function reportQuantityError(quantity: number, planned: number): { code: string; message: string } | null {
  const scaled = quantity * 10 ** WORKSHOP_QUANTITY_MAX_DECIMALS;
  if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(scaled - Math.round(scaled)) > 1e-6) return WORKSHOP_ERRORS.quantityInvalid;
  if (Number.isFinite(planned) && planned > 0 && quantity > planned + 1e-9) return WORKSHOP_ERRORS.quantityExceeded;
  return null;
}
