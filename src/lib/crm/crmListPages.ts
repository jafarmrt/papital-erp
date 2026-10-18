import type { CRMActivity, CRMLead } from '../../types';

/**
 * v10.2 package 7 (OBS-R2-28): the sales file table and the activity book page on the server. The table reads one page of
 * `GET /crm/leads?page=` and the book one page of `GET /crm/activities?page=` with its own search and type; neither is cut
 * at a fixed count any more. The sales funnel (board) still reads the newest `CRM_BOARD_LEAD_CAP` files and says so when
 * the list reaches that cap. Shared by the hooks and the tests.
 */
export const CRM_LEAD_PAGE_QUERY_KEY = ['crm', 'lead-page'] as const;
export const CRM_ACTIVITY_PAGE_QUERY_KEY = ['crm', 'activity-page'] as const;
export const CRM_PARTY_RECORDS_QUERY_KEY = ['crm', 'party-records'] as const;

/** The board's list (and the server's unpaged answer) holds at most this many files, newest first */
export const CRM_BOARD_LEAD_CAP = 500;

export const CRM_LEAD_PAGE_SIZES = [10, 20, 50, 100] as const;
export const CRM_ACTIVITY_PAGE_SIZE = 20;

/** The note under the board when its list reached the cap, else null */
export function boardCapNotice(count: number): string | null {
  return count >= CRM_BOARD_LEAD_CAP
    ? 'قیف فروش تازه‌ترین پرونده‌ها را نشان می‌دهد؛ برای دیدن همه پرونده‌ها جدول پرونده‌ها یا شرط‌های جست‌وجو را به کار ببرید.'
    : null;
}

export interface CrmPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const count = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Safe reading of a paged answer (AGENTS rule 2) */
export function toCrmPage<T>(res: unknown, page: number, limit: number): CrmPage<T> {
  const body = (res && typeof res === 'object' ? res : {}) as Record<string, unknown>;
  const data = Array.isArray(body.data) ? (body.data as T[]) : (Array.isArray(res) ? (res as T[]) : []);
  const total = count(body.total) || data.length;
  const pageLimit = count(body.limit) || limit;
  return { data, total, page: count(body.page) || page, limit: pageLimit, totalPages: Math.max(1, Math.ceil(total / pageLimit)) };
}

/** One page of the sales file table under the page's search conditions */
export function leadPageUrl(filters: URLSearchParams, page: number, limit: number): string {
  const params = new URLSearchParams(filters);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return `/crm/leads?${params.toString()}`;
}

export interface ActivityPageQuery {
  fromDate?: string;
  toDate?: string;
  search?: string;
  /** an activity type, or `all` */
  type?: string;
  /** a party: its own activities and those of its sales files */
  partyId?: number;
  page: number;
  limit: number;
}

export function activityPageUrl(q: ActivityPageQuery): string {
  const params = new URLSearchParams({ page: String(q.page), limit: String(q.limit) });
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.search?.trim()) params.set('search', q.search.trim());
  if (q.type && q.type !== 'all') params.set('type', q.type);
  if (q.partyId) params.set('partyId', String(q.partyId));
  return `/crm/activities?${params.toString()}`;
}

export type LeadPage = CrmPage<CRMLead>;
export type ActivityPage = CrmPage<CRMActivity>;
