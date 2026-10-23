import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { PieceworkPayroll, PieceworkPersonnelRate, PieceworkTask } from '../../types';
import { QUERY_KEYS } from '../../lib/queryKeys';

/**
 * v10.2 package 11 part 5c (TD-1361, OBS-R2-102): the payroll page reads its task titles, categories, payslips and
 * personnel rates through React Query under `piecework`, so every change that invalidates that domain (a voucher,
 * treasury or workshop change) refreshes them. Payroll figures are money: everything here is read again on every
 * opening of the page, as before, and a personnel's rates whenever a window asks for them; each request is cancelled
 * when its screen closes.
 */

export interface PieceworkCategory { id: number | string; name: string; description?: string }

const arrayOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? res as T[] : []);

export function usePieceworkTasksQuery(status: 'active' | 'archived' | 'all') {
  return useQuery<PieceworkTask[]>({
    queryKey: QUERY_KEYS.piecework.tasks(status),
    queryFn: async ({ signal }) => arrayOf<PieceworkTask>(await fetchJson(`/piecework/tasks?status=${status}`, { signal })),
    // the table keeps the titles it shows while another status loads; a late answer never lands under another status
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

export function usePieceworkCategoriesQuery() {
  return useQuery<PieceworkCategory[]>({
    queryKey: QUERY_KEYS.piecework.categories(),
    queryFn: async ({ signal }) => arrayOf<PieceworkCategory>(await fetchJson('/piecework/categories', { signal })),
    refetchOnMount: 'always',
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
