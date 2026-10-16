import type { WorkshopDelivery, WorkshopTaskCard } from './workshopContract';
import { reportQuantityError, WORKSHOP_REPORT_STATUS_LABELS, type WorkshopReportStatus } from './workshopSchedule';

/**
 * v10.1.40 (N-01 part 3, mobile workshop plan §4.3 and §5): what the workshop cartable screens show, as pure rules shared
 * by the page and its tests. The worker page is `/workshop` (`workshop.self`), the project manager's review page
 * `/workshop/review` (`workshop.review`); both are one page with tabs.
 */

export const WORKSHOP_PAGE_PATH = '/workshop';
export const WORKSHOP_REVIEW_PAGE_PATH = '/workshop/review';

export type WorkshopTab = 'tasks' | 'deliveries' | 'review';
export const WORKSHOP_TAB_LABELS: Record<WorkshopTab, string> = {
  tasks: 'کارهای من',
  deliveries: 'حواله‌های من',
  review: 'بررسی گزارش‌ها',
};

/** The tabs a viewer sees: the worker's two with `workshop.self`, the review tab with `workshop.review`. */
export function workshopTabsFor(access: { self: boolean; review: boolean }): WorkshopTab[] {
  return [...(access.self ? ['tasks', 'deliveries'] as const : []), ...(access.review ? ['review'] as const : [])];
}

/** The tab an address opens: the review page opens «بررسی»; `?tab=deliveries` the deliveries; otherwise the first one. */
export function workshopTabOf(pathname: string, search: string, tabs: readonly WorkshopTab[]): WorkshopTab | null {
  const wanted: WorkshopTab = pathname.startsWith(WORKSHOP_REVIEW_PAGE_PATH)
    ? 'review'
    : new URLSearchParams(search).get('tab') === 'deliveries' ? 'deliveries' : 'tasks';
  return tabs.includes(wanted) ? wanted : tabs[0] ?? null;
}

/** The address of a tab, so a reload and the bell's links open the same tab. */
export function workshopTabPath(tab: WorkshopTab): string {
  if (tab === 'review') return WORKSHOP_REVIEW_PAGE_PATH;
  return tab === 'deliveries' ? `${WORKSHOP_PAGE_PATH}?tab=deliveries` : WORKSHOP_PAGE_PATH;
}

/** A reminder's `?row=projectId:stageId:productId:rowId` (`workshopRowLink`), to bring that card to the top. */
export function highlightedRowKey(search: string): string | null {
  const row = new URLSearchParams(search).get('row');
  return row ? row : null;
}

export const taskCardKey = (t: Pick<WorkshopTaskCard, 'projectId' | 'stageId' | 'productId' | 'rowId'>): string =>
  `${t.projectId}:${t.stageId}:${t.productId}:${t.rowId}`;

/** The highlighted card first, the rest as the server sent them (by deadline). */
export function orderTaskCards(tasks: readonly WorkshopTaskCard[], highlighted: string | null): WorkshopTaskCard[] {
  if (!highlighted) return [...tasks];
  return [...tasks].sort((a, b) => Number(taskCardKey(b) === highlighted) - Number(taskCardKey(a) === highlighted));
}

export type DeadlineTone = 'overdue' | 'soon' | 'normal' | 'none';
/** Warning colour from the day before the deadline, danger after it (plan §4.3 «کارهای من»). */
export function deadlineTone(daysLeft: number | null): DeadlineTone {
  if (daysLeft === null) return 'none';
  if (daysLeft < 0) return 'overdue';
  return daysLeft <= 1 ? 'soon' : 'normal';
}

export const DEADLINE_TONE_CLASSES: Record<DeadlineTone, string> = {
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  soon: 'bg-amber-50 text-amber-800 border-amber-200',
  normal: 'bg-slate-50 text-slate-600 border-slate-200',
  none: 'bg-slate-50 text-slate-500 border-slate-200',
};

export const reportStatusLabel = (status: WorkshopReportStatus): string => WORKSHOP_REPORT_STATUS_LABELS[status];

/**
 * A card takes a new report when it has a task and a planned quantity above zero (the server's rule) and no report, or its
 * last one was rejected or withdrawn.
 */
export function canReportTask(task: Pick<WorkshopTaskCard, 'report' | 'taskId' | 'quantity'>): boolean {
  return task.taskId !== null && task.quantity > 0 && (!task.report || task.report.status === 'rejected' || task.report.status === 'withdrawn');
}

/** A submitted report is the worker's to edit or withdraw until the manager reviews it. */
export const isPendingReport = (task: Pick<WorkshopTaskCard, 'report'>): boolean => task.report?.status === 'submitted';

/**
 * The quantity a form sends: the Latin text `DecimalInput` gives, read as a number and checked with the server's own rule
 * (`reportQuantityError`), so the worker sees «تعداد بیش از برنامه است؛ به مسئول پروژه بگویید» before sending.
 */
export function workshopQuantityError(text: string, planned: number): string | null {
  if (text.trim() === '') return 'تعداد را بنویسید.';
  return reportQuantityError(Number(text), planned)?.message ?? null;
}

/** A discrepancy needs a note; «تحویل گرفتم» does not. */
export function deliveryNoteError(status: 'received' | 'discrepancy', note: string): string | null {
  return status === 'discrepancy' && note.trim() === '' ? 'برای «مغایرت دارد» توضیح بنویسید که چه چیزی کم یا متفاوت بود.' : null;
}

export const isOpenDelivery = (d: Pick<WorkshopDelivery, 'confirmation'>): boolean => d.confirmation === null;

export const deliveryKindLabel = (d: Pick<WorkshopDelivery, 'kind'>): string => (d.kind === 'document' ? 'حواله خروج' : 'تخصیص مواد به پروژه');
