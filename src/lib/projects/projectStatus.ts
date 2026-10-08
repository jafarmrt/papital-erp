/**
 * وضعیت‌های پروژه تولید و برچسب فارسی آن‌ها، مشترک میان سرور و مرورگر.
 *
 * v9.0.365 (TD-738، تصمیم ت۱ الف): وضعیت پروژه را ماتریس پیشرفت فقط در مسیرهای نوشتن (تیک ماتریس، افزودن، ویرایش و
 * حذف مرحله، ویرایش پروژه) تعیین می‌کند و «متوقف‌شده» و «لغوشده» را هرگز تغییر نمی‌دهد. پیش‌تر خواندن پروژه
 * (`GET /projects/:id` و `/product-progress`) همگام‌ساز را بی قفل و ممیزی اجرا می‌کرد: پروژه لغوشده با ماتریس کامل با یک
 * `GET` کاربری که فقط مجوز خواندن داشت «تکمیل‌شده» و تحویل‌پذیر می‌شد.
 */

export const PROJECT_STATUSES = ['planned', 'in_progress', 'paused', 'completed', 'cancelled'] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال انجام',
  paused: 'متوقف‌شده',
  completed: 'تکمیل‌شده',
  cancelled: 'لغوشده',
};

export const projectStatusLabel = (status: string | null | undefined): string =>
  (PROJECT_STATUS_LABELS as Record<string, string>)[String(status ?? '')] ?? String(status ?? '');

/**
 * v9.0.418 (TD-761): ستون کانبان هر وضعیت؛ «متوقف‌شده» و «لغوشده» ستون «متوقف / لغوشده» دارند و وضعیت ناشناخته قدیمی در
 * «برنامه‌ریزی‌شده» می‌آید (همان نشان پیش‌فرض). پیش‌تر کانبان فقط سه ستون داشت و این پروژه‌ها در نمای پیش‌فرض دیده نمی‌شدند.
 */
export const PROJECT_KANBAN_COLUMNS = ['planned', 'in_progress', 'completed', 'stopped'] as const;
export type ProjectKanbanColumn = typeof PROJECT_KANBAN_COLUMNS[number];

export function projectKanbanColumn(status: string | null | undefined): ProjectKanbanColumn {
  if (status === 'paused' || status === 'cancelled') return 'stopped';
  if (status === 'in_progress' || status === 'completed') return status;
  return 'planned';
}

export function groupProjectsForKanban<T extends { status?: string | null }>(projects: readonly T[]): Record<ProjectKanbanColumn, T[]> {
  const groups: Record<ProjectKanbanColumn, T[]> = { planned: [], in_progress: [], completed: [], stopped: [] };
  for (const p of projects) groups[projectKanbanColumn(p.status)].push(p);
  return groups;
}

/** اولویت‌های پروژه (همان گزینه‌های فرم پروژه؛ v9.0.380، TD-754) */
export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type ProjectPriority = typeof PROJECT_PRIORITIES[number];

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: 'کم',
  medium: 'متوسط',
  high: 'زیاد',
  urgent: 'فوری / اضطراری',
};

export const projectPriorityLabel = (priority: string | null | undefined): string =>
  (PROJECT_PRIORITY_LABELS as Record<string, string>)[String(priority ?? '')] ?? String(priority ?? '');

/** وضعیت‌های مرحله پروژه (همان وضعیت‌های خانه ماتریس پیشرفت) */
export const STAGE_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const;
export type StageStatus = typeof STAGE_STATUSES[number];

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: 'در انتظار شروع',
  in_progress: 'در حال انجام',
  completed: 'تکمیل‌شده',
  blocked: 'متوقف / مانع',
};

export const stageStatusLabel = (status: string | null | undefined): string =>
  (STAGE_STATUS_LABELS as Record<string, string>)[String(status ?? '')] ?? String(status ?? '');

/** بزرگ‌ترین شماره مرحله (ستون integer؛ v9.0.368، TD-755) */
export const MAX_STAGE_ORDER = 10000;

/**
 * v9.0.410 (TD-759، تصمیم ت۹ الف): پروژه لغوشده یا تکمیل‌شده مواد تازه نمی‌گیرد (آزادسازی تخصیص‌های پیشین آزاد است) و
 * فرم تخصیص آن را پیشنهاد نمی‌کند
 */
export const ALLOCATION_CLOSED_PROJECT_STATUSES: readonly string[] = ['completed', 'cancelled'];

export const isProjectOpenForAllocation = (status: string | null | undefined): boolean =>
  !ALLOCATION_CLOSED_PROJECT_STATUSES.includes(String(status ?? ''));

/** وضعیت‌هایی که فقط کاربر تعیین می‌کند و همگام‌ساز ماتریس تغییر نمی‌دهد */
export const MATRIX_HELD_PROJECT_STATUSES: readonly string[] = ['paused', 'cancelled'];

export interface MatrixStatusInput {
  /** همه محصولات یا همه مراحل پروژه تکمیل شده‌اند */
  allDone: boolean;
  /** دست‌کم یک خانه یا مرحله پیشرفت دارد */
  anyProgress: boolean;
}

/** وضعیت پروژه پس از نوشتن ماتریس یا مراحل */
export function matrixProjectStatus(current: string | null | undefined, input: MatrixStatusInput): string {
  const status = String(current ?? 'planned') || 'planned';
  if (MATRIX_HELD_PROJECT_STATUSES.includes(status)) return status;
  if (input.allDone) return 'completed';
  if (input.anyProgress) return status === 'planned' || status === 'completed' ? 'in_progress' : status;
  return status === 'completed' ? 'in_progress' : status;
}
