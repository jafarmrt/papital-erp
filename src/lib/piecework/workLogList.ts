import { jalaliMonthDays } from '../payroll/fixedSalaryProration.js';

/**
 * v9.0.325 (TD-811، B12P-08): قرارداد مشترک فهرست کارکرد میان سرور و مرورگر. پیش‌تر صفحه کارمزدی همه کارکردهای عمر سامانه
 * را با هر باز شدن و پس از هر ثبت می‌گرفت (یک سال کارگاه: ۶۰٬۰۰۰ ردیف، ۳۰ مگابایت، ۲٫۳ ثانیه) و فیلتر، جمع‌ها و «هزینه
 * پروژه‌ها» را در مرورگر حساب می‌کرد. اکنون فیلترها در SQL است، فهرست یک صفحه برمی‌گرداند، جمع‌ها در SQL گرفته می‌شود و صفحه
 * با «ماه جاری» (ماه جلالی) باز می‌شود.
 */

export const WORK_LOG_PAGE_SIZE = 100;

/** فیلتر وضعیت صفحه: «در انتظار تسویه» یعنی بی فیش، «تسویه‌شده» یعنی هر کارکردی که در فیش آمده است */
export const WORK_LOG_STATUS_FILTERS = ['all', 'pending', 'processed'] as const;

export interface WorkLogListFilters {
  /** شناسه پرسنل یا «all» */
  personnelId?: string | number;
  /** شناسه پروژه، «none» برای کارکرد بی پروژه، یا «all» */
  projectId?: string | number;
  /** «all»، «pending»، «processed» یا یک وضعیت کارکرد */
  status?: string;
  /** تاریخ جلالی یا ISO */
  startDate?: string;
  endDate?: string;
  search?: string;
}

export interface WorkLogPage<Row> {
  data: Row[];
  /** شمار همه کارکردهای فیلترشده، نه فقط این صفحه */
  total: number;
  page: number;
  limit: number;
  /** جمع مبلغ همه کارکردهای فیلترشده */
  totalAmount: number;
}

export interface WorkLogProjectCost {
  projectId: number | null;
  title: string;
  totalCost: number;
  logCount: number;
  personnelCount: number;
}

/** کارت‌های صفحه و زبانه «هزینه پروژه‌ها»، جمع SQL روی همه کارکردهای زنده */
export interface WorkLogSummary {
  totalAmount: number;
  pendingAmount: number;
  logCount: number;
  projects: WorkLogProjectCost[];
}

const isAll = (v: unknown) => v === undefined || v === null || v === '' || String(v).toLowerCase() === 'all';

/** query string فهرست کارکرد؛ فیلتر «all» و خالی فرستاده نمی‌شود */
export function workLogListQuery(filters: WorkLogListFilters, page?: number, limit?: number): string {
  const params = new URLSearchParams();
  if (!isAll(filters.personnelId)) params.set('personnelId', String(filters.personnelId));
  if (!isAll(filters.projectId)) params.set('projectId', String(filters.projectId));
  if (!isAll(filters.status)) params.set('status', String(filters.status));
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  if (filters.search && filters.search.trim()) params.set('search', filters.search.trim());
  if (page !== undefined) params.set('page', String(page));
  if (limit !== undefined) params.set('limit', String(limit));
  return params.toString();
}

/** نخستین و واپسین روز ماه جلالی یک تاریخ جلالی `YYYY/MM/DD` (پیش‌فرض بازه صفحه کارکرد) */
export function jalaliMonthRange(jalaliDate: string): { startDate: string; endDate: string } | null {
  const match = /^(\d{4})\/(\d{2})\/\d{2}$/.exec(jalaliDate);
  if (!match) return null;
  const month = `${match[1]}/${match[2]}`;
  return { startDate: `${month}/01`, endDate: `${month}/${String(jalaliMonthDays(month)).padStart(2, '0')}` };
}
