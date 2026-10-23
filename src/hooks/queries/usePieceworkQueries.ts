import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { PieceworkPayroll, PieceworkPersonnelRate, PieceworkTask } from '../../types';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

/**
 * v10.2 package 11 part 5c (TD-1361, OBS-R2-102): the payroll page reads its task titles, categories, payslips and
 * personnel rates through React Query under `piecework`, so every change that invalidates that domain (a voucher,
 * treasury or workshop change) refreshes them. Payroll figures are money: everything here is read again on every
 * opening of the page, as before, and a personnel's rates whenever a window asks for them; each request is cancelled
 * when its screen closes.
 */

export interface PieceworkCategory { id: number | string; name: string; description?: string }

const arrayOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? res as T[] : []);

/** `readOnEveryOpening`: a settings tab's read (10.3, part 13), which says a failure at once instead of retrying */
interface PieceworkReadOptions { readOnEveryOpening?: boolean }
const readOptionsOf = (options: PieceworkReadOptions) => (options.readOnEveryOpening ? READ_ON_EVERY_OPENING : {});

export function usePieceworkTasksQuery(status: 'active' | 'archived' | 'all', options: PieceworkReadOptions = {}) {
  return useQuery<PieceworkTask[]>({
    queryKey: QUERY_KEYS.piecework.tasks(status),
    queryFn: async ({ signal }) => arrayOf<PieceworkTask>(await fetchJson(`/piecework/tasks?status=${status}`, { signal })),
    // the table keeps the titles it shows while another status loads; a late answer never lands under another status
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
    ...readOptionsOf(options),
  });
}

export function usePieceworkCategoriesQuery(options: PieceworkReadOptions = {}) {
  return useQuery<PieceworkCategory[]>({
    queryKey: QUERY_KEYS.piecework.categories(),
    queryFn: async ({ signal }) => arrayOf<PieceworkCategory>(await fetchJson('/piecework/categories', { signal })),
    refetchOnMount: 'always',
    ...readOptionsOf(options),
  });
}

export function usePieceworkPayrollsQuery(enabled: boolean) {
  return useQuery<PieceworkPayroll[]>({
    queryKey: QUERY_KEYS.piecework.payrolls(),
    queryFn: async ({ signal }) => arrayOf<PieceworkPayroll>(await fetchJson('/piecework/payrolls', { signal })),
    refetchOnMount: 'always',
    enabled,
  });
}

/** A personnel's custom rates (`GET /piecework/personnel-rates/:id`), read again each time a window asks for them */
export function usePieceworkPersonnelRatesQuery(personnelId: number | null) {
  return useQuery<PieceworkPersonnelRate[]>({
    queryKey: QUERY_KEYS.piecework.personnelRates(personnelId ?? 0),
    queryFn: async ({ signal }) => arrayOf<PieceworkPersonnelRate>(await fetchJson(`/piecework/personnel-rates/${personnelId}`, { signal })),
    enabled: personnelId !== null,
    staleTime: 0,
  });
}

/** task id → custom rate */
export function personnelRateMap(rates: readonly PieceworkPersonnelRate[] | undefined): Record<number, number> {
  const map: Record<number, number> = {};
  (rates ?? []).forEach((r) => { map[r.taskId] = Number(r.customRate); });
  return map;
}

/**
 * 10.3 (ARCH review finding 3, part 13): the rows of a payroll rate setting (`GET /piecework/statutory-rates` or
 * `/piecework/eidi-rates`, one row per Jalali year), read again on each opening of the settings tab; under `piecework`,
 * so a save refreshes the payslip previews that use them too
 */
function usePayrollRateRowsQuery<T>(queryKey: readonly string[], url: string) {
  return useQuery<T[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ data?: unknown } | null>(url, { signal });
      return arrayOf<T>(res?.data);
    },
    ...READ_ON_EVERY_OPENING,
  });
}

export const useStatutoryRatesQuery = <T,>() => usePayrollRateRowsQuery<T>(QUERY_KEYS.piecework.statutoryRates(), '/piecework/statutory-rates');
export const useEidiRatesQuery = <T,>() => usePayrollRateRowsQuery<T>(QUERY_KEYS.piecework.eidiRates(), '/piecework/eidi-rates');

/**
 * A saved year's row (the answer of its PUT, with its new version) put into the cached rows at once, so the form filled
 * again after the save shows what was saved and sends that version next, even when the refresh after the save fails
 */
export async function putPayrollRateRow<T extends { jalaliYear: number }>(queryClient: QueryClient, queryKey: readonly string[], row: T) {
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<T[]>(queryKey, prev => {
    const rows = prev ?? [];
    return rows.some(r => r.jalaliYear === row.jalaliYear) ? rows.map(r => (r.jalaliYear === row.jalaliYear ? row : r)) : [...rows, row];
  });
}
