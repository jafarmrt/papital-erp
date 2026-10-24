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

/**
 * OBS-R1-69 (TD-1321): a personnel pick list (accounting parties, the sales seller) keeps at most this many, newest first.
 * It asks the server for one row more, so it knows the server had more than the cap (total above the cap), never guesses
 * it from a list that only reached the cap.
 */
export const PERSONNEL_PICK_LIMIT = 5000;
/** The highest `limit` the array form of `GET /personnel` takes: the cap and the one row that says there are more */
export const PERSONNEL_PICK_REQUEST_LIMIT = PERSONNEL_PICK_LIMIT + 1;
export const PERSONNEL_PICK_URL = `/personnel?limit=${PERSONNEL_PICK_REQUEST_LIMIT}`;
/** The sales seller picker: personnel who have not left only, so a leaver takes no place under the cap */
export const PERSONNEL_ACTIVE_PICK_URL = `${PERSONNEL_PICK_URL}&activeOnly=1`;
export const PERSONNEL_PICK_CAP_TOAST_ID = 'personnel-pick-cap';
// 10.3 package 6 (TD-1362): a cut list's picker searches on the server too (`personnelServerSearchUrl`), so the notice
// says how an older personnel is found
export const PERSONNEL_PICK_CAP_NOTICE =
  `فهرست انتخاب فقط ${PERSONNEL_PICK_LIMIT.toLocaleString('fa-IR')} پرسنلِ آخرِ ثبت‌شده را نشان می‌دهد؛ پرسنل قدیمی‌تر را با نوشتن نامشان در جست‌وجوی انتخابگر پیدا کنید.`;
/** long enough to read the notice once */
export const PERSONNEL_PICK_CAP_TOAST_MS = 8000;

let capNoticeShown = false;

/**
 * The rows a picker keeps (at most the cap) and the notice it shows: only when the server answered more rows than the cap,
 * and once per session (each picker reloads its list, the notice is not repeated)
 */
export function takePersonnelPick<T>(rows: readonly T[]): { rows: T[]; notice: string | null } {
  if (rows.length <= PERSONNEL_PICK_LIMIT) return { rows: [...rows], notice: null };
  const notice = capNoticeShown ? null : PERSONNEL_PICK_CAP_NOTICE;
  capNoticeShown = true;
  return { rows: rows.slice(0, PERSONNEL_PICK_LIMIT), notice };
}

/**
 * 10.3 package 6 (TD-1362): the server search of a personnel picker whose list may be cut at the cap: a list of the cap's
 * length (`takePersonnelPick` cut it, or the server held exactly that many, which only costs a request) also reads
 * `GET /personnel?search=&limit=` for a typed search (`activeOnly` for the CRM pickers, as their list) and lists the
 * matches it does not show. A shorter list holds every personnel, so its picker searches in the browser as before and
 * asks the server nothing.
 */
export function personnelServerSearchUrl(list: readonly unknown[], { activeOnly = false }: { activeOnly?: boolean } = {}): string | undefined {
  if (list.length < PERSONNEL_PICK_LIMIT) return undefined;
  return activeOnly ? '/personnel?activeOnly=1' : '/personnel';
}

/** A personnel picker option labelled by the full name (the CRM filters), for its list and its server search */
export function personnelNameOption(p: { id: number | string; fullName?: string | null }): { value: string; label: string } {
  return { value: String(p.id), label: p.fullName || '' };
}

/** The same with the job title (the CRM seller and follow-up pickers) */
export function personnelSellerOption(p: { id: number | string; fullName?: string | null; jobTitle?: string | null }): { value: string; label: string } {
  return { value: String(p.id), label: `${p.fullName}${p.jobTitle ? ` — ${p.jobTitle}` : ''}` };
}

/** Tests only: the next list above the cap shows the notice again */
export function resetPersonnelPickNotice(): void {
  capNoticeShown = false;
}

/** TD-1321 (review): whether a window's list of every personnel has arrived, so its checks may run */
export type PersonnelListState = 'loading' | 'ready' | 'failed';

export const PERSONNEL_LIST_STATE_TEXT: Record<Exclude<PersonnelListState, 'ready'>, string> = {
  loading: 'در حال خواندن فهرست پرسنل…',
  failed: 'فهرست پرسنل خوانده نشد؛ پنجره را ببندید و دوباره باز کنید.',
};
