import { keepPreviousData, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import type { CRMLead } from '../../types';
import type { CrmStats } from '../../lib/crm/leadCurrencyTotals';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { normalizeLeadStage } from '../useCRMFilters';
import { PERSONNEL_ACTIVE_PICK_URL, PERSONNEL_PICK_CAP_TOAST_ID, PERSONNEL_PICK_CAP_TOAST_MS, takePersonnelPick } from '../../lib/personnel/personnelList';

/**
 * v10.2 package 11 part 5a (TD-1329, OBS-R2-102): the sales page reads through React Query like the rest of the app.
 * The statistics and the board's sales files are cached under `crm`, so every change that invalidates that domain (a
 * document or a party change, `INVALIDATION_PRESETS`) refreshes them; the pick lists share the cache of the other forms
 * and are read once for the sales page and the customers page. Each request is cancelled when its screen closes.
 */

/** The board's list for one set of search conditions (`leadFilterQuery`); the newest `CRM_BOARD_LEAD_CAP` files */
export const crmBoardLeadsKey = (filterQuery: string) => QUERY_KEYS.crm.leads({ board: filterQuery });

/** The personnel who have not left, as the seller and assignee pickers read them */
export const CRM_ACTIVE_PERSONNEL_KEY = QUERY_KEYS.personnel.lookup({ activeOnly: 1 });

const rowsOf = <T,>(res: unknown): T[] => {
  const body = res as { data?: unknown } | null;
  return Array.isArray(res) ? (res as T[]) : (Array.isArray(body?.data) ? (body.data as T[]) : []);
};

export function useCrmStatsQuery(enabled: boolean) {
  return useQuery<Partial<CrmStats>>({
    queryKey: QUERY_KEYS.crm.stats(),
    queryFn: async ({ signal }) => ((await fetchJson('/crm/stats', { signal })) || {}) as Partial<CrmStats>,
    // opening the page reads again what other users changed, as it did before; the cached figures show meanwhile
    refetchOnMount: 'always',
    enabled,
  });
}

export function useCrmBoardLeadsQuery(filterQuery: string, enabled: boolean) {
  return useQuery<CRMLead[]>({
    queryKey: crmBoardLeadsKey(filterQuery),
    queryFn: async ({ signal }) => rowsOf<CRMLead>(await fetchJson(`/crm/leads?${filterQuery}`, { signal }))
      .map((l) => ({ ...l, stage: normalizeLeadStage(l.stage) })),
    // the board keeps the files it shows while the next search conditions load
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
    enabled,
  });
}

export function useCrmActivePersonnelQuery<T>() {
  return useQuery<T[]>({
    queryKey: CRM_ACTIVE_PERSONNEL_KEY,
    queryFn: async ({ signal }) => {
      // OBS-R1-69 (TD-1321): a list cut at the cap says so once instead of hiding the rest
      const { rows, notice } = takePersonnelPick(rowsOf<T>(await fetchJson(PERSONNEL_ACTIVE_PICK_URL, { signal })));
      if (notice) toast(notice, { id: PERSONNEL_PICK_CAP_TOAST_ID, duration: PERSONNEL_PICK_CAP_TOAST_MS });
      return rows;
    },
    staleTime: 60 * 1000,
  });
}
