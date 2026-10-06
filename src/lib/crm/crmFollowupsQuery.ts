import type { CRMActivity } from '../../types';

/**
 * v9.0.14 (TD-428، تصمیم مالک محصول ت۵ الف): درخواست و پاسخ `GET /crm/followups` (پیگیری‌ها بی بازه تاریخ اقدام، با صفحه‌بندی).
 */
export type FollowupStatusFilter = 'pending' | 'completed' | 'all';

export interface FollowupQuery {
  status: FollowupStatusFilter;
  /** فقط سررسید امروز و معوق */
  dueOnly?: boolean;
  /** شناسه پرسنل مسئول؛ خالی یا «all» یعنی همه */
  assignedPersonnelId?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface FollowupPage {
  data: CRMActivity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** همه پیگیری‌های باز با سررسید امروز یا گذشته */
  dueCount: number;
  /** همه پیگیری‌های باز */
  openCount: number;
}

export const CRM_FOLLOWUPS_QUERY_KEY = ['crm', 'followups'] as const;

export function followupsUrl(q: FollowupQuery): string {
  const params = new URLSearchParams({ status: q.status, page: String(q.page), limit: String(q.limit) });
  if (q.dueOnly) params.set('due', 'due');
  if (q.assignedPersonnelId && q.assignedPersonnelId !== 'all') params.set('assignedPersonnelId', q.assignedPersonnelId);
  if (q.search?.trim()) params.set('search', q.search.trim());
  return `/crm/followups?${params.toString()}`;
}

const count = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** استخراج امن پاسخ (قاعده ۲ AGENTS) */
export function toFollowupPage(res: unknown, q: FollowupQuery): FollowupPage {
  const body = (res && typeof res === 'object' ? res : {}) as Record<string, unknown>;
  const data = Array.isArray(body.data) ? (body.data as CRMActivity[]) : [];
  return {
    data,
    total: count(body.total),
    page: count(body.page) || q.page,
    limit: count(body.limit) || q.limit,
    totalPages: Math.max(1, count(body.totalPages)),
    dueCount: count(body.dueCount),
    openCount: count(body.openCount),
  };
}
