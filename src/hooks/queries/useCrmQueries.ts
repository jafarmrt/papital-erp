import { keepPreviousData, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fetchJson } from '../../api';
import type { CRMActivity, CRMLead, Item } from '../../types';
import type { CrmStats } from '../../lib/crm/leadCurrencyTotals';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { normalizeLeadStage } from '../useCRMFilters';
import { PERSONNEL_ACTIVE_PICK_URL, PERSONNEL_PICK_CAP_TOAST_ID, PERSONNEL_PICK_CAP_TOAST_MS, takePersonnelPick } from '../../lib/personnel/personnelList';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { crmAttachmentsPath, type CrmAttachmentOwner, type CrmAttachmentView } from '../../lib/crm/crmAttachments';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

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

/** every sales file's detail: a change to a file, its activities or its attachments refreshes the open drawer */
export const CRM_LEAD_DETAIL_KEY = [...QUERY_KEYS.crm.all, 'lead'] as const;
export const crmLeadDetailKey = (leadId: number) => [...CRM_LEAD_DETAIL_KEY, leadId] as const;

/** `GET /crm/leads/:id`: the sales file as read now, its activities (newest first) and, for `crm.view` holders, its attachments */
export interface CrmLeadDetail {
  lead: CRMLead;
  activities: CRMActivity[];
  attachments?: CrmAttachmentView[];
}

/**
 * 10.3 (ARCH review finding 3, part 12): the sales file drawer's detail, read again on each opening of a file; a change
 * that invalidates `crm` (a stage, an activity, a follow-up) refreshes it while the drawer is open
 */
export function useCrmLeadDetailQuery(leadId: number | null) {
  return useQuery<CrmLeadDetail>({
    queryKey: crmLeadDetailKey(leadId ?? 0),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<(CRMLead & { activities?: unknown; attachments?: unknown }) | null>(`/crm/leads/${leadId}`, { signal });
      if (!res) throw new Error('پرونده فروش یافت نشد');
      const { activities, attachments, ...lead } = res;
      return {
        lead: { ...lead, stage: normalizeLeadStage(lead.stage) },
        activities: Array.isArray(activities) ? (activities as CRMActivity[]) : [],
        attachments: Array.isArray(attachments) ? (attachments as CrmAttachmentView[]) : undefined,
      };
    },
    enabled: leadId !== null,
    ...READ_ON_EVERY_OPENING,
  });
}

export const crmAttachmentsKey = (owner: CrmAttachmentOwner, ownerId: number) => [...QUERY_KEYS.crm.all, 'attachments', owner, ownerId] as const;

/** 10.3 (part 12): the attachments of one sales file or activity, read again on each opening of its box */
export function useCrmAttachmentsQuery(owner: CrmAttachmentOwner, ownerId: number) {
  return useQuery<CrmAttachmentView[]>({
    queryKey: crmAttachmentsKey(owner, ownerId),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ data?: unknown } | null>(crmAttachmentsPath(owner, ownerId), { signal });
      return Array.isArray(res?.data) ? (res.data as CrmAttachmentView[]) : [];
    },
    ...READ_ON_EVERY_OPENING,
  });
}

/**
 * 10.3 (part 12): the items with their stock by warehouse, for the sales file drawer's «موجودی انبار» tab; under the
 * items key, so a stock change refreshes it, and read again each time the tab opens
 */
export function useCrmStockItemsQuery(enabled: boolean) {
  return useQuery<Item[]>({
    queryKey: [...QUERY_KEYS.items.all, 'options', 'crm-stock'] as const,
    queryFn: async ({ signal }) => rowsOf<Item>(await fetchJson(PICK_LIST_URLS.items, { signal })),
    enabled,
    ...READ_ON_EVERY_OPENING,
  });
}
