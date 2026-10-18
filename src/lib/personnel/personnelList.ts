/**
 * OBS-R2-57 (TD-1321): the contract of the paged personnel list, shared by `GET /personnel?page=` and the personnel page.
 * Without `page` the route still answers the array the pick lists read (filtered and capped by `limit` in SQL).
 */
export interface PersonnelListStats {
  total: number;
  active: number;
  terminated: number;
  onLeave: number;
  usersCount: number;
}

export interface PersonnelPage<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  stats: PersonnelListStats;
}

export interface PersonnelPageParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
}

export function personnelPageUrl({ page, limit, search, status }: PersonnelPageParams): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const q = (search ?? '').trim();
  if (q) params.set('search', q);
  if (status && status !== 'all') params.set('status', status);
  return `/personnel?${params.toString()}`;
}

export const EMPTY_PERSONNEL_STATS: PersonnelListStats = { total: 0, active: 0, terminated: 0, onLeave: 0, usersCount: 0 };
