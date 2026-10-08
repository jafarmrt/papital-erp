import { PROJECT_PRIORITIES, PROJECT_STATUSES } from './projectStatus.js';

/**
 * v9.0.412 (TD-743، B11-09): قرارداد مشترک سرور و مرورگر برای فهرست پروژه‌های تولید (`GET /projects`).
 * فهرست یک صفحه خلاصه با صافی‌های SQL است: شناسه، کد، عنوان، مشتری، کالا، مقدار، تاریخ‌ها، وضعیت، اولویت، پیشرفت،
 * شمار پیوست‌ها و خلاصه مراحل همان صفحه، هر فیلد یک بار. محصولات، کنترل موجودی، برنامه کارگاه، شرح و خود پیوست‌ها فقط
 * در پرونده پروژه (`GET /projects/:id`) می‌آیند. پیش‌تر فهرست همه پروژه‌ها و همه مراحل را با همه JSONها و هر فیلد دو بار
 * می‌داد (۳۱۲ پروژه ۹٫۱ مگابایت) و `page` / `limit` را نادیده می‌گرفت.
 */

export const PROJECT_LIST_PAGE_SIZE = 50;
export const PROJECT_LIST_MAX_LIMIT = 200;

/** صافی وضعیت و اولویت: `all` یا یکی از مقدارهای ذخیره‌شده */
export const PROJECT_LIST_STATUS_FILTERS = ['all', ...PROJECT_STATUSES] as const;
export const PROJECT_LIST_PRIORITY_FILTERS = ['all', ...PROJECT_PRIORITIES] as const;

export interface ProjectListStage {
  id: number;
  title: string;
  stage_order: number;
  status: string;
  progress_percent: number;
}

export interface ProjectListRow {
  id: number;
  project_code: string;
  title: string;
  customer_name: string;
  item_code: string;
  item_name: string;
  quantity: number;
  unit: string;
  start_date: string;
  end_date: string;
  status: string;
  priority: string;
  progress_percent: number;
  total_stages: number;
  completed_stages: number;
  attachments_count: number;
  stages: ProjectListStage[];
}

/** همه کلیدهای یک ردیف فهرست؛ ردیف کلید دیگری ندارد */
export const PROJECT_LIST_ROW_FIELDS = [
  'id', 'project_code', 'title', 'customer_name', 'item_code', 'item_name', 'quantity', 'unit', 'start_date', 'end_date',
  'status', 'priority', 'progress_percent', 'total_stages', 'completed_stages', 'attachments_count', 'stages',
] as const satisfies ReadonlyArray<keyof ProjectListRow>;

export const PROJECT_LIST_STAGE_FIELDS = ['id', 'title', 'stage_order', 'status', 'progress_percent'] as const satisfies ReadonlyArray<keyof ProjectListStage>;

/** شمار پروژه‌های هر وضعیت با همه صافی‌ها جز وضعیت */
export type ProjectStatusCounts = Record<string, number>;

export interface ProjectListPage {
  data: ProjectListRow[];
  /** شمار پروژه‌های منطبق با همه صافی‌ها */
  total: number;
  page: number;
  limit: number;
  statusCounts: ProjectStatusCounts;
}

export interface ProjectListFilters {
  search: string;
  /** `all` یا یک وضعیت */
  status: string;
  /** `all` یا یک اولویت */
  priority: string;
}

/** پیشرفت پروژه از مراحلش: میانگین درصد مراحل (مرحله تمام‌شده بی درصد ۱۰۰)، همان قاعده پرونده پروژه */
export function projectStageProgress(stages: ReadonlyArray<{ status?: string | null; progressPercent?: number | null }>): {
  totalStages: number;
  completedStages: number;
  progressPercent: number;
} {
  const totalStages = stages.length;
  const completedStages = stages.filter(s => s.status === 'completed').length;
  if (totalStages === 0) return { totalStages, completedStages, progressPercent: 0 };
  const sum = stages.reduce((acc, s) => acc + (s.progressPercent || (s.status === 'completed' ? 100 : 0)), 0);
  return { totalStages, completedStages, progressPercent: Math.round(sum / totalStages) };
}

/** پارامترهای درخواست یک صفحه (همان نام‌هایی که اسکیمای `GET /projects` می‌خواند) */
export function projectListParams(filters: ProjectListFilters, page: number, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set('search', search);
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.priority && filters.priority !== 'all') params.set('priority', filters.priority);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return params;
}

/** پاسخ سرور به شکل صفحه (پاسخ ناقص صفحه خالی است، نه خطا) */
export function toProjectListPage(res: unknown, page: number, limit: number): ProjectListPage {
  const body = (res && typeof res === 'object' ? res : {}) as Partial<ProjectListPage>;
  const data = Array.isArray(body.data) ? body.data : [];
  const counts: ProjectStatusCounts = {};
  for (const [status, count] of Object.entries(body.statusCounts ?? {})) counts[status] = Number(count) || 0;
  return { data, total: Number(body.total ?? data.length) || 0, page, limit, statusCounts: counts };
}

/** شمار همه پروژه‌های منطبق با صافی‌های جز وضعیت */
export const projectStatusCountTotal = (counts: ProjectStatusCounts): number =>
  Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0);
