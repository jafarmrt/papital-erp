import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchJson } from '../api';
import { QUERY_KEYS } from '../lib/queryKeys';
import {
  materialAvailabilityReportOf, type MaterialAvailabilityReport, type MaterialAvailabilityStatus,
} from '../lib/projects/materialAvailability';
import { deliveryCostReportOf, type DeliveryCostReport } from '../lib/projects/deliveryCostSuggestion';
import { issuedMaterialsReportOf, type IssuedMaterialsReport } from '../lib/projects/issuedMaterials';

/**
 * v10.2.3 (TD-1290، بستهٔ ۳ نسخهٔ ۱۰.۲): خواندن سه گزارش فقط‌خواندنی زبانهٔ مواد و «ورود به انبار» پروژه.
 * v10.2 package 11 part 5e (TD-1364): through React Query under the project's key, so a document change (a remittance,
 * waste or receipt, whose preset invalidates `projects`) reads them again on an open tab; each opening of a tab reads
 * them again as before, the request is cancelled when the tab closes, and the figures shown stay while they are read again.
 */
export interface ProjectReadReport<T> {
  status: MaterialAvailabilityStatus;
  /** آخرین پاسخ معتبر؛ هنگام خواندن دوباره می‌ماند و با خطا پاک می‌شود */
  data: T | null;
}

function useProjectReadReport<T>(
  key: readonly unknown[],
  url: string | null,
  accept: (raw: unknown) => T | null,
  reloadKey: unknown,
): ProjectReadReport<T> {
  const result = useQuery<T>({
    queryKey: [...key, reloadKey],
    queryFn: async ({ signal }) => {
      const data = accept(await fetchJson<unknown>(url as string, { signal }));
      if (!data) throw new Error('unreadable project report');
      return data;
    },
    enabled: url !== null,
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
  if (result.isError) return { status: 'error', data: null };
  if (result.isFetching || !result.data) return { status: 'loading', data: result.data ?? null };
  return { status: 'ready', data: result.data };
}

const projectIdOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export type WarehouseItemsState = 'loading' | 'loaded' | 'failed';

/**
 * ارقام آزاد کالاهای مواد پروژه (`GET /projects/:id/material-availability`). بی شناسهٔ کالا درخواستی نیست و گزارش خالی آماده
 * است؛ هنگام خواندن دوباره (پس از ذخیره یا افزودن کالا) ارقام پیشین به کار می‌روند تا ردیف‌ها چشمک نزنند.
 */
export function useProjectMaterialAvailability(
  projectId: unknown,
  itemIds: readonly number[],
  itemsState: WarehouseItemsState,
  reloadKey: unknown,
): { status: MaterialAvailabilityStatus; report: MaterialAvailabilityReport | null } {
  const idsKey = itemIds.join(',');
  const pid = projectIdOf(projectId);
  const validProject = pid !== null;
  const url = validProject && itemsState === 'loaded' && idsKey ? `/projects/${pid}/material-availability?itemIds=${idsKey}` : null;
  const read = useProjectReadReport([...QUERY_KEYS.projects.detail(pid ?? 0), 'material-availability', idsKey], url, materialAvailabilityReportOf, reloadKey);
  const emptyReport = useMemo<MaterialAvailabilityReport | null>(() => (pid !== null ? { projectId: pid, items: [] } : null), [pid]);

  if (!validProject || itemsState === 'failed') return { status: 'error', report: null };
  if (itemsState === 'loading') return { status: 'loading', report: null };
  if (!idsKey) return { status: 'ready', report: emptyReport };
  return { status: read.status === 'loading' && read.data ? 'ready' : read.status, report: read.data };
}

/** ورودی‌های بهای پیشنهادی «ورود به انبار» (`GET /projects/:id/delivery-cost`)؛ فقط وقتی `enabled` */
export function useProjectDeliveryCost(projectId: unknown, enabled: boolean, reloadKey: unknown): ProjectReadReport<DeliveryCostReport> {
  const pid = projectIdOf(projectId);
  const url = enabled && pid !== null ? `/projects/${pid}/delivery-cost` : null;
  return useProjectReadReport([...QUERY_KEYS.projects.detail(pid ?? 0), 'delivery-cost'], url, deliveryCostReportOf, reloadKey);
}

/**
 * 10.3 (ARCH review finding 3): the delivery cost read again right before a delivery is sent, never from the cache, so its
 * prices are checked against the balance as it is now (TD-1290); null when it could not be read or is unreadable
 */
export async function readDeliveryCostNow(projectId: number): Promise<DeliveryCostReport | null> {
  try {
    return deliveryCostReportOf(await fetchJson<unknown>(`/projects/${projectId}/delivery-cost`));
  } catch {
    return null;
  }
}

/** «مواد گرفته‌شده از انبار» پروژه (`GET /projects/:id/issued-materials`) */
export function useProjectIssuedMaterials(projectId: unknown, reloadKey: unknown): ProjectReadReport<IssuedMaterialsReport> {
  const pid = projectIdOf(projectId);
  const url = pid !== null ? `/projects/${pid}/issued-materials` : null;
  return useProjectReadReport([...QUERY_KEYS.projects.detail(pid ?? 0), 'issued-materials'], url, issuedMaterialsReportOf, reloadKey);
}
