import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { fetchJson, isAbortError } from '../api';
import { errorMessageOf, toPersianDigits } from '../utils';
import {
  progressTickKey, progressTickRequestItems, resolveTickStatus, tickedProgressPercent, toggledTickStatus,
  type ProductProgressResponse, type ProgressCellStatus, type ProgressProduct,
} from '../lib/projects/progressTicks';

interface ProductProgressTicksOptions {
  /** `projects.edit`: the key `PUT /projects/:id/product-progress` asks; without it nothing is ticked */
  canEdit: boolean;
  onUpdate?: () => void;
  /** the page asks before a tab change or leaving while ticks are not saved */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * v10.2.7 (10.2 package 10): reading, ticking and saving a project's progress matrix, shared by the desktop table and
 * the phone list (rules in `src/lib/projects/progressTicks.ts`). Changes stay on screen until «ثبت», which sends them
 * all in one `PUT /projects/:id/product-progress`; the server then syncs the stages and the project status in the same
 * transaction (TD-738 / TD-739).
 */
export function useProductProgressTicks(projectId: number, { canEdit, onUpdate, onDirtyChange }: ProductProgressTicksOptions) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<ProductProgressResponse | null>(null);
  // pending local edits: key `${itemId}|${stageOrder}` → newStatus
  const [edits, setEdits] = useState<Map<string, ProgressCellStatus>>(new Map());

  // OBS-R2-47: the effect's request is aborted on cleanup (project change, unmount) and a late answer is dropped
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetchJson(`/projects/${projectId}/product-progress`, { signal });
      if (signal?.aborted) return;
      const payload = res?.data ?? res;
      if (payload && Array.isArray(payload.products)) {
        setData(payload);
      } else {
        toast.error('ساختار پاسخ پیشرفت نامعتبر است');
      }
    } catch (err: unknown) {
      if (isAbortError(err) || signal?.aborted) return;
      toast.error(errorMessageOf(err) || 'خطا در دریافت پیشرفت تفکیکی کد کالا');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const stages = useMemo(() => data?.stages || [], [data]);
  const products = useMemo(() => (Array.isArray(data?.products) ? data.products : []), [data]);

  const statusOf = useCallback((p: ProgressProduct, order: number) => resolveTickStatus(p, order, edits), [edits]);
  const percentOf = useCallback((p: ProgressProduct) => tickedProgressPercent(p, edits), [edits]);
  const isEdited = useCallback((p: ProgressProduct, order: number) => edits.has(progressTickKey(p.item_id, order)), [edits]);

  const toggle = (p: ProgressProduct, order: number) => {
    if (!canEdit) return;
    const next = toggledTickStatus(resolveTickStatus(p, order, edits));
    setEdits(prev => new Map(prev).set(progressTickKey(p.item_id, order), next));
  };

  /** every stage of the given products set to one status */
  const setAllStagesOf = (itemIds: ReadonlySet<number>, status: ProgressCellStatus) => {
    if (!canEdit || itemIds.size === 0) return;
    setEdits(prev => {
      const m = new Map(prev);
      for (const p of products) {
        if (p.item_id && itemIds.has(p.item_id)) {
          for (const order of p.applicable_stage_orders) m.set(progressTickKey(p.item_id, order), status);
        }
      }
      return m;
    });
    toast.success(`وضعیت تمام مراحل برای ${toPersianDigits(itemIds.size)} محصول تغییر یافت`);
  };

  /** one stage set to one status for every product it applies to */
  const setStageForAll = (order: number, status: ProgressCellStatus) => {
    if (!canEdit) return;
    setEdits(prev => {
      const m = new Map(prev);
      for (const p of products) {
        if (p.applicable_stage_orders.includes(order)) m.set(progressTickKey(p.item_id, order), status);
      }
      return m;
    });
    toast.success(`وضعیت مرحله برای تمام کالاها به روز شد`);
  };

  const reset = () => {
    setEdits(new Map());
    toast('تغییرات ثبت‌نشده لغو شدند', { icon: '↩️' });
  };

  const hasChanges = edits.size > 0;
  useEffect(() => { onDirtyChange?.(hasChanges && !saving); }, [hasChanges, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const save = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    try {
      const res = await fetchJson(`/projects/${projectId}/product-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: progressTickRequestItems(edits) }),
      });
      if (res?.success) {
        toast.success(`${toPersianDigits(res.applied)} تغییر وضعیت ثبت شد`);
        setEdits(new Map());
        void load();
        onUpdate?.();
      } else {
        toast.error(res?.error || 'خطا در ثبت تغییرات');
      }
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت تغییرات');
    } finally {
      setSaving(false);
    }
  };

  return {
    loading, saving, data, stages, products, summary: data?.summary,
    editCount: edits.size, hasChanges, statusOf, percentOf, isEdited,
    toggle, setAllStagesOf, setStageForAll, reset, save,
  };
}

export type ProductProgressTicks = ReturnType<typeof useProductProgressTicks>;
