/**
 * کاردکس تفصیلی یک کالا (GET /inventory/item-kardex/:itemId): شکل پاسخ و نرمال‌سازی دفاعی آن.
 * V10-0.2: هر شکل پاسخ (پاکت کامل، آرایه خام legacy یا پاکت داخل data) به { item, summary, entries } تبدیل می‌شود
 * تا هیچ deref بدون گارد در مودال نماند.
 */
import { kardexDocumentTypeLabel } from '../documents/documentTypeTitles.js';
import { normalizeSearchText } from '../search/searchText.js';

export interface RunningKardexItem {
  id?: number;
  code?: string;
  name?: string;
  unit?: string;
  category?: string | null;
  type?: string | null;
  currentStock?: number;
  weightedAverageCost?: number;
}

export interface RunningKardexSummary {
  totalIn?: number;
  totalOut?: number;
  netBalance?: number;
  transactionCount?: number;
  valuation?: number;
}

export interface RunningKardexEntry {
  transactionId?: number;
  date: string;
  type: string;
  documentType?: string;
  documentRef?: string;
  location?: string;
  quantity: number;
  unitPrice: number;
  totalAmount?: number;
  runningBalance?: number;
  runningLocationStock?: number;
  runningGlobalStock?: number;
  runningWac?: number;
  runningTotalValue?: number;
  notes?: string;
  createdBy?: string;
  reversalOfId?: number | null;
  /** ردیف معکوسِ ابطال یک سند (در تاریخ ابطال) */
  isReversal?: boolean;
  /** v8.0.7 (TD-266): ردیف اصلی سند ابطال‌شده (در تاریخ خود سند) */
  isVoided?: boolean;
}

/** v8.0.7 (TD-266): برچسب ردیف سند ابطال‌شده و ردیف معکوس آن در کاردکس تفصیلی؛ رشته خالی برای گردش عادی */
export function runningKardexEntryLabel(entry: Pick<RunningKardexEntry, 'isVoided' | 'isReversal'>): string {
  if (entry.isVoided) return 'باطل‌شده';
  if (entry.isReversal) return 'معکوس ابطال';
  return '';
}

export interface RunningKardexData {
  item: RunningKardexItem | null;
  summary: RunningKardexSummary | null;
  entries: RunningKardexEntry[];
  /** v11 phase 6.1ch (S11): the balance before the first day of the range (`from`), or null without one */
  opening: RunningKardexOpening | null;
  /** the warehouses of the item's rows, for the warehouse filter */
  locations: string[];
  /** the rows that match the range and the filters (the page shows `limit` of them) */
  total: number;
  page: number;
  limit: number;
}

/**
 * v11 phase 6.1ch (S11): the Kardex window reads one page of rows (`page`, `limit`), within a range of days (`from`, `to`)
 * and the filters of the window (in or out, a warehouse, a search), all applied on the server. The running balance,
 * warehouse balance and WAC of each row stay those of the whole ledger, and the range opens with the balance before its
 * first day. `export=true` answers every matching row (the Excel file). Before, the whole ledger went to the browser:
 * 25 MB and 3 s for an item with 61k rows.
 */
export const RUNNING_KARDEX_PAGE_SIZE = 200;
export const RUNNING_KARDEX_MAX_PAGE_SIZE = 1000;
export const RUNNING_KARDEX_DIRECTIONS = ['all', 'in', 'out'] as const;
export type RunningKardexDirection = typeof RUNNING_KARDEX_DIRECTIONS[number];

export interface RunningKardexOpening {
  /** the range's first day; the balances are those at the end of the day before */
  date: string;
  runningBalance: number;
  runningWac: number;
  runningTotalValue: number;
}

export interface RunningKardexQuery {
  from?: string;
  to?: string;
  type?: RunningKardexDirection;
  location?: string;
  search?: string;
  page?: number;
}

/** the address of one page of an item's Kardex (`exportAll`: every matching row) */
export function runningKardexUrl(itemId: number, query: RunningKardexQuery = {}, exportAll = false): string {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.type && query.type !== 'all') params.set('type', query.type);
  if (query.location && query.location !== 'all') params.set('location', query.location);
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (exportAll) params.set('export', 'true');
  else if ((query.page ?? 1) > 1) params.set('page', String(query.page));
  const text = params.toString();
  return `/inventory/item-kardex/${itemId}${text ? `?${text}` : ''}`;
}

/** whether a row passes the window's filters (in or out, warehouse, search over reference, notes, document kind and user) */
export function runningKardexEntryMatches(
  entry: Pick<RunningKardexEntry, 'type' | 'location' | 'documentRef' | 'notes' | 'documentType' | 'createdBy' | 'isVoided' | 'isReversal'>,
  query: Pick<RunningKardexQuery, 'type' | 'location' | 'search'>,
): boolean {
  if (query.type && query.type !== 'all' && entry.type !== query.type) return false;
  if (query.location && query.location !== 'all' && entry.location !== query.location) return false;
  const search = normalizeSearchText(query.search);
  if (!search) return true;
  return [entry.documentRef, entry.notes, entry.documentType, kardexDocumentTypeLabel(entry.documentType, entry.documentRef), entry.createdBy,
    runningKardexEntryLabel(entry)]
    .some(text => normalizeSearchText(text).includes(search));
}

/** شمار صفحه‌های کاردکس (دست‌کم یک) */
export function runningKardexPageCount(data: Pick<RunningKardexData, 'total' | 'limit'> | null | undefined): number {
  if (!data || !data.limit || data.total <= 0) return 1;
  return Math.ceil(data.total / data.limit);
}

interface KardexEnvelope {
  item?: RunningKardexItem | null;
  summary?: RunningKardexSummary | null;
  entries?: unknown;
  opening?: RunningKardexOpening | null;
  locations?: unknown;
  total?: number;
  page?: number;
  limit?: number;
}

const isObject = (value: unknown): value is KardexEnvelope => typeof value === 'object' && value !== null;

const locationsOf = (entries: RunningKardexEntry[]) => [...new Set(entries.map(entry => entry.location ?? '').filter(Boolean))];

const PAGE_OF_ALL = (entries: RunningKardexEntry[]) => ({
  opening: null, locations: locationsOf(entries), total: entries.length, page: 1, limit: Math.max(entries.length, 1),
});

export function normalizeRunningKardex(res: unknown): RunningKardexData {
  if (Array.isArray(res)) {
    const entries = res as RunningKardexEntry[];
    return { item: null, summary: null, entries, ...PAGE_OF_ALL(entries) };
  }
  if (isObject(res) && Array.isArray(res.entries)) {
    const entries = res.entries as RunningKardexEntry[];
    return {
      item: res.item ?? null,
      summary: res.summary ?? null,
      entries,
      opening: res.opening ?? null,
      locations: Array.isArray(res.locations) ? res.locations.map(String) : locationsOf(entries),
      total: Number(res.total ?? entries.length),
      page: Number(res.page ?? 1),
      limit: Number(res.limit ?? Math.max(entries.length, 1)),
    };
  }
  // هر شکل دیگر (از جمله { data: [...] } که شاخه قبلی مودال هم به کاردکس خالی تبدیلش می‌کرد): کاردکس خالی
  return { item: null, summary: null, entries: [], ...PAGE_OF_ALL([]) };
}
