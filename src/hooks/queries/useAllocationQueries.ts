import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { EMPTY_ALLOCATION_STATUS_COUNTS, bomAllocationListUrl, type BomAllocationListParams, type BomAllocationStatusCounts } from '../../lib/inventory/bomAllocationList';
import { READ_ON_EVERY_OPENING } from './readOnEveryOpening';

/** one row of `GET /inventory/allocations` */
export interface BomAllocationRow {
  id: number;
  projectCode?: string;
  itemName?: string;
  itemCode?: string;
  quantity: number;
  unit?: string;
  sourceLocation?: string | null;
  sourceTransactionId?: number | string | null;
  status: string;
  username?: string | null;
  allocatedAt?: string | null;
  consumedAt?: string | null;
  releasedAt?: string | null;
  notes?: string | null;
}

/** one page of the allocations under a search and status, with the counts of every status (OBS-R2-45, TD-1322) */
export interface AllocationPage {
  allocations: BomAllocationRow[];
  total: number;
  statusCounts: BomAllocationStatusCounts;
}

/** a raw material of the allocation form's picker */
export interface AllocationItemOption {
  id: number;
  name: string;
  code?: string;
  unit?: string;
  currentStock?: number;
  current_stock?: number;
}

const listOf = <T,>(res: unknown): T[] => {
  if (Array.isArray(res)) return res as T[];
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as T[]) : [];
};

/**
 * 10.3 (ARCH review finding 3, part 11): one page of «تخصیص مواد به پروژه‌ها» under `inventory`, so a stock change
 * anywhere refreshes it; read again on each opening of the tab (pair it with `useOpeningRead`)
 */
export function useAllocationPageQuery(params: Required<Pick<BomAllocationListParams, 'page' | 'limit' | 'search' | 'status'>>) {
  return useQuery<AllocationPage>({
    queryKey: QUERY_KEYS.inventory.allocations(params),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<Partial<AllocationPage> | null>(bomAllocationListUrl(params), { signal });
      return {
        allocations: Array.isArray(res?.allocations) ? res.allocations : [],
        total: Number(res?.total) || 0,
        statusCounts: res?.statusCounts ?? EMPTY_ALLOCATION_STATUS_COUNTS,
      };
    },
    ...READ_ON_EVERY_OPENING,
  });
}

/** the raw materials an allocation may take (`GET /items/options?type=raw_material`); under items, so a stock change refreshes them */
export function useRawMaterialOptionsQuery() {
  return useQuery<AllocationItemOption[]>({
    queryKey: [...QUERY_KEYS.items.all, 'options', 'raw-material'] as const,
    queryFn: async ({ signal }) => listOf<AllocationItemOption>(await fetchJson(`${PICK_LIST_URLS.items}?type=raw_material`, { signal })),
    staleTime: 60 * 1000,
  });
}
