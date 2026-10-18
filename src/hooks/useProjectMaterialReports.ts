import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../api';
import {
  materialAvailabilityReportOf, type MaterialAvailabilityReport, type MaterialAvailabilityStatus,
} from '../lib/projects/materialAvailability';
import { deliveryCostReportOf, type DeliveryCostReport } from '../lib/projects/deliveryCostSuggestion';
import { issuedMaterialsReportOf, type IssuedMaterialsReport } from '../lib/projects/issuedMaterials';

/**
 * v10.2.1 (TD-1290، بستهٔ ۳ نسخهٔ ۱۰.۲): خواندن سه گزارش فقط‌خواندنی زبانهٔ مواد و «ورود به انبار» پروژه. با `fetchJson`، نه
 * react-query، چون این زبانه‌ها بیرون از QueryClientProvider هم ساخته می‌شوند؛ درخواست پیشین با برگشت از اثر لغو می‌شود.
 */
export interface ProjectReadReport<T> {
  status: MaterialAvailabilityStatus;
  /** آخرین پاسخ معتبر؛ هنگام خواندن دوباره می‌ماند و با خطا پاک می‌شود */
  data: T | null;
}

function useProjectReadReport<T>(url: string | null, accept: (raw: unknown) => T | null, reloadKey: unknown): ProjectReadReport<T> {
  const [state, setState] = useState<ProjectReadReport<T>>({ status: 'loading', data: null });
  useEffect(() => {
    if (url === null) return undefined;
    const controller = new AbortController();
    setState(prev => ({ status: 'loading', data: prev.data }));
    void (async () => {
      try {
        const raw = await fetchJson<unknown>(url, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const data = accept(raw);
        setState(data ? { status: 'ready', data } : { status: 'error', data: null });
      } catch {
        if (controller.signal.aborted) return;
        setState({ status: 'error', data: null });
      }
    })();
    return () => { controller.abort(); };
  }, [url, accept, reloadKey]);
  return state;
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
  const read = useProjectReadReport(url, materialAvailabilityReportOf, reloadKey);
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
  return useProjectReadReport(url, deliveryCostReportOf, reloadKey);
}

/** «مواد گرفته‌شده از انبار» پروژه (`GET /projects/:id/issued-materials`) */
export function useProjectIssuedMaterials(projectId: unknown, reloadKey: unknown): ProjectReadReport<IssuedMaterialsReport> {
  const pid = projectIdOf(projectId);
  const url = pid !== null ? `/projects/${pid}/issued-materials` : null;
  return useProjectReadReport(url, issuedMaterialsReportOf, reloadKey);
}
