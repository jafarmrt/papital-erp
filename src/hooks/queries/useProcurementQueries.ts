import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import type { ProcurementInboxSummary, PurchaseRequisition } from '../../types';
import type { RequisitionWorkflowActions } from '../../lib/procurement/requisitionActions';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomains, INVALIDATION_PRESETS } from '../../lib/queryInvalidation';
import type { QueryDomain } from '../../lib/queryKeys';
import { getErrorMessage } from '../../utils';

/**
 * v10.2 package 11 part 5d (TD-1363, OBS-R2-102): the procurement desk reads its summary, its requisition and order
 * pages, an open requisition and its workflow actions through React Query under `procurement`, so a workflow approval,
 * a document change or a reorder alert purchase (which invalidate that domain) refreshes an open desk, and a delivery or
 * receipt on the desk refreshes stock, documents and vouchers. Every list is read again on each opening of the desk, as
 * before; each request is cancelled when its screen closes.
 */

export interface ProcurementPageState<T> {
  rows: T[];
  total: number;
  isLoading: boolean;
  error?: string;
  /** reads this page again (the «تلاش دوباره» button) */
  reload?: () => void;
}

export type RequisitionActionsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: RequisitionWorkflowActions };

/** آرایه داده پاسخ فهرست (`{ data: [...] }` یا آرایه)، با گارد آرایه */
function rowsOf<T>(res: unknown): T[] {
  const data = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as T[] : [];
}

export function useProcurementSummaryQuery() {
  return useQuery<ProcurementInboxSummary | null>({
    queryKey: QUERY_KEYS.procurement.summary(),
    queryFn: async ({ signal }) => (await fetchJson<{ data?: ProcurementInboxSummary }>('/api/procurement/inbox/summary', { signal }))?.data ?? null,
    refetchOnMount: 'always',
  });
}

/**
 * v9.0.353 (TD-697، B10-10): یک صفحه از فهرست تدارکات با فیلترهای سرور. `url` تهی یعنی این فهرست اکنون خوانده نمی‌شود.
 * فهرست تا رسیدن صفحه بعد ردیف‌های نشان‌داده را نگه می‌دارد و خطای خواندن فهرست را خالی نشان می‌دهد، مثل پیش‌تر.
 */
export function useProcurementListQuery<T>(url: string | null, query: Record<string, string | number | undefined>): ProcurementPageState<T> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params[key] = String(value);
  }
  const result = useQuery<{ rows: T[]; total: number }>({
    queryKey: QUERY_KEYS.procurement.list(url ?? '', params),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<unknown>(`${url}?${new URLSearchParams(params).toString()}`, { signal });
      const total = Number((res as { total?: unknown } | null)?.total);
      const rows = rowsOf<T>(res);
      return { rows, total: Number.isFinite(total) ? total : rows.length };
    },
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
    enabled: url !== null,
  });
  const reload = () => { void result.refetch(); };
  if (result.isError) return { rows: [], total: 0, isLoading: result.isFetching, error: getErrorMessage(result.error), reload };
  return { rows: result.data?.rows ?? [], total: result.data?.total ?? 0, isLoading: result.isFetching, reload };
}

/**
 * The requisition an open window shows, read again whenever procurement changes (a delivery updates its received
 * quantities); until then, and if the read fails, the row the desk opened it with.
 */
export function useRequisitionQuery(requisition: PurchaseRequisition, enabled: boolean): PurchaseRequisition {
  const id = requisition?.id;
  const result = useQuery<PurchaseRequisition>({
    queryKey: QUERY_KEYS.procurement.requisition(id ?? 0),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ data?: PurchaseRequisition }>(`/api/procurement/requisitions/${id}`, { signal });
      if (!res?.data || res.data.id !== id) throw new Error('requisition not returned');
      return res.data;
    },
    enabled: enabled && Boolean(id),
    staleTime: 0,
  });
  return result.data ?? requisition;
}

/** OBS-R2-38 (TD-992): اقدام‌های مجاز گام جاری درخواست برای همین کاربر؛ خطای خواندن نشان داده می‌شود، نه «بی اقدام» */
export function useRequisitionWorkflowActionsQuery(requisitionId: number | undefined, status: string, enabled: boolean): RequisitionActionsState {
  const result = useQuery<RequisitionWorkflowActions>({
    queryKey: QUERY_KEYS.procurement.workflowActions(requisitionId ?? 0, status),
    queryFn: async ({ signal }) => {
      const res = await fetchJson<{ data: RequisitionWorkflowActions }>(`/api/procurement/requisitions/${requisitionId}/workflow-actions`, { signal });
      const data = res?.data;
      return { hasInstance: Boolean(data?.hasInstance), actions: Array.isArray(data?.actions) ? data.actions : [] };
    },
    enabled: enabled && Boolean(requisitionId),
    staleTime: 0,
  });
  if (result.isError) {
    const err = result.error;
    return { status: 'error', message: err instanceof Error && err.message ? err.message : 'اقدام‌های گردش کار این درخواست خوانده نشد.' };
  }
  return result.data ? { status: 'ready', data: result.data } : { status: 'loading' };
}

/**
 * What a procurement write changes:
 * - `requisition` (create, edit, consolidate, delete): the desk, the workflow inbox and the dashboard;
 * - `orders` (convert to orders): those and the documents list, which shows the draft orders;
 * - `workflow` (a workflow action, «دریافت کالا» included): the workflow preset, which also covers stock, documents and vouchers;
 * - `delivery` (an order delivered to the warehouse): the workflow and document presets, stock, Kardex and vouchers included.
 */
export type ProcurementChange = 'requisition' | 'orders' | 'workflow' | 'delivery';

const REQUISITION_DOMAINS: QueryDomain[] = ['procurement', 'workflow', 'dashboard', 'notifications'];
const CHANGE_DOMAINS: Record<ProcurementChange, QueryDomain[]> = {
  requisition: REQUISITION_DOMAINS,
  orders: [...REQUISITION_DOMAINS, 'documents'],
  workflow: [...INVALIDATION_PRESETS.workflowChange],
  delivery: [...new Set<QueryDomain>([...INVALIDATION_PRESETS.workflowChange, ...INVALIDATION_PRESETS.documentChange])],
};

export function invalidateAfterProcurementChange(queryClient: QueryClient, change: ProcurementChange): Promise<void> {
  return invalidateDomains(queryClient, CHANGE_DOMAINS[change]);
}
