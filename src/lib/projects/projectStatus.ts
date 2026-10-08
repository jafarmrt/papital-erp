/**
 * وضعیت‌های پروژه تولید و برچسب فارسی آن‌ها، مشترک میان سرور و مرورگر.
 *
 * v9.0.334 (TD-738، تصمیم ت۱ الف): وضعیت پروژه را ماتریس پیشرفت فقط در مسیرهای نوشتن (تیک ماتریس، افزودن، ویرایش و
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

/** وضعیت‌های مرحله پروژه (همان وضعیت‌های خانه ماتریس پیشرفت) */
export const STAGE_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const;
export type StageStatus = typeof STAGE_STATUSES[number];

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: 'در انتظار شروع',
  in_progress: 'در حال انجام',
  completed: 'تکمیل‌شده',
  blocked: 'متوقف / مانع',
};

/** بزرگ‌ترین شماره مرحله (ستون integer؛ v9.0.337، TD-755) */
export const MAX_STAGE_ORDER = 10000;

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
