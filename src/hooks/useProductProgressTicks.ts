import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { fetchJson } from '../api';
import { errorMessageOf, toPersianDigits } from '../utils';
import {
  progressPercentOf, progressTickKey, progressTickRequestItems, resolveTickStatus, stageProgressPercent, stageTickCounts, toggledTickStatus,
  type ProgressCellStatus, type ProgressProduct,
} from '../lib/projects/progressTicks';
import { useOpeningRead } from './queries/readOnEveryOpening';
import { useProductProgressQuery } from './queries/useProjectWorkspaceQueries';

interface ProductProgressTicksOptions {
  /** `projects.edit`: the key `PUT /projects/:id/product-progress` asks; without it nothing is ticked */
  canEdit: boolean;
  onUpdate?: () => void;
  /** the page asks before a tab change or leaving while ticks are not saved */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * ticks not saved or a save under way: the page keeps the layout that holds this hook until it settles, since the
   * other layout builds its own list and would drop the ticks or read the matrix before the save
   */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * v10.2.9 (10.2 package 10): reading, ticking and saving a project's progress matrix, shared by the desktop table and
 * the phone list (rules in `src/lib/projects/progressTicks.ts`). Changes stay on screen until «ثبت», which sends them
 * all in one `PUT /projects/:id/product-progress`; the server then syncs the stages and the project status in the same
 * transaction (TD-738 / TD-739).
 * 10.3 (ARCH review finding 3): the matrix comes from the shared cache (`useProductProgressQuery`), read again on each
 * opening of the tab; a save elsewhere that invalidates the project (a stock document, a workshop approval) refreshes it,
 * and the unsent ticks stay on top of the newer matrix. After «ثبت» the ticks stay on screen until the matrix they were
 * saved into is read, so none flips back meanwhile; if that read fails they stay on screen as saved (never offered to
 * send again) until a read succeeds.
 */
export function useProductProgressTicks(projectId: number, { canEdit, onUpdate, onDirtyChange, onBusyChange }: ProductProgressTicksOptions) {
  const [sending, setSending] = useState(false);
  const query = useProductProgressQuery(projectId);
  const read = useOpeningRead(query, true);
  const data = read.data ?? null;
  const loading = query.isFetching;
  // the last read's error, so a screen can say the matrix was not read instead of «no products»; it stays said while
  // «تلاش دوباره» reads again (delta D3: a read again clears the query's error at once), until a read succeeds
  const [failure, setFailure] = useState<{ at: number; message: string } | null>(null);
  if (read.failedAt && read.failedAt !== failure?.at) {
    setFailure({ at: read.failedAt, message: errorMessageOf(read.error) || 'خطا در دریافت پیشرفت تفکیکی کد کالا' });
  }
  const loadError = failure && query.dataUpdatedAt < failure.at ? failure.message : null;
  // pending local edits: key `${itemId}|${stageOrder}` → newStatus
  const [edits, setEdits] = useState<Map<string, ProgressCellStatus>>(new Map());
  // 10.3 (review of part 10): when the save answered. The hook reads its matrix again right then, replacing any read
  // under way, so a read that lands later started after the save; the ticks clear only on that read's success
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // ticks the server took whose matrix the read after the save could not bring: shown over the older matrix, not counted
  // as unsent (no «ثبت», no leave warning), until a later read succeeds
  const [unread, setUnread] = useState<{ ticks: Map<string, ProgressCellStatus>; since: number } | null>(null);
  // (the data moves only on a successful read, so its time alone says whether one landed after the save)
  if (savedAt !== null && !query.isFetching) {
    // a layer left by an earlier save stays under this one: the server holds both
    if (query.dataUpdatedAt < savedAt) setUnread({ ticks: new Map([...(unread?.ticks ?? []), ...edits]), since: savedAt });
    setEdits(new Map());
    setSavedAt(null);
  }
  if (unread && query.dataUpdatedAt > unread.since) setUnread(null);
  const saving = sending || savedAt !== null;
  const shown = useMemo(() => (unread ? new Map([...unread.ticks, ...edits]) : edits), [unread, edits]);

  const sayLoadFailed = useEffectEvent(() => { toast.error(errorMessageOf(read.error) || 'خطا در دریافت پیشرفت تفکیکی کد کالا'); });
  useEffect(() => {
    if (read.failedAt) sayLoadFailed();
  }, [read.failedAt]);
  const { refetch } = query;
  const reload = useCallback(() => { void refetch({ cancelRefetch: false }); }, [refetch]);

  const stages = useMemo(() => data?.stages || [], [data]);
  const products = useMemo(() => (Array.isArray(data?.products) ? data.products : []), [data]);

  const statusOf = useCallback((p: ProgressProduct, order: number) => resolveTickStatus(p, order, shown), [shown]);
  const percentOf = useCallback((p: ProgressProduct) => progressPercentOf(p, shown), [shown]);
  const stagePercentOf = useCallback((order: number) => stageProgressPercent(products, order, shown), [products, shown]);
  const stageCountsOf = useCallback((order: number) => stageTickCounts(products, order, shown), [products, shown]);
  const isEdited = useCallback((p: ProgressProduct, order: number) => edits.has(progressTickKey(p.item_id, order)), [edits]);

  // 10.2 package 12 (backlog: the desktop table ticked during a save): nothing is ticked while a save is under way,
  // since the save clears every unsent change when it returns
  const toggle = (p: ProgressProduct, order: number) => {
    if (!canEdit || saving) return;
    const next = toggledTickStatus(resolveTickStatus(p, order, shown));
    setEdits(prev => new Map(prev).set(progressTickKey(p.item_id, order), next));
  };

  /** every stage of the given products set to one status */
  const setAllStagesOf = (itemIds: ReadonlySet<number>, status: ProgressCellStatus) => {
    if (!canEdit || saving || itemIds.size === 0) return;
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
    if (!canEdit || saving) return;
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
    if (saving) return;
    setEdits(new Map());
    toast('تغییرات ثبت‌نشده لغو شدند', { icon: '↩️' });
  };

  const hasChanges = edits.size > 0;
  useEffect(() => { onDirtyChange?.(hasChanges && !saving); }, [hasChanges, saving, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => { onBusyChange?.(hasChanges || saving); }, [hasChanges, saving, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const save = async () => {
    if (!hasChanges || saving) return;
    setSending(true);
    try {
      const res = await fetchJson<{ success?: boolean; applied?: number; error?: string } | null>(`/projects/${projectId}/product-progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: progressTickRequestItems(edits) }),
      });
      if (res?.success) {
        toast.success(`${toPersianDigits(res.applied)} تغییر وضعیت ثبت شد`);
        onUpdate?.();
        setSavedAt(Date.now());
        void refetch();
      } else {
        toast.error(res?.error || 'خطا در ثبت تغییرات');
      }
    } catch (err: unknown) {
      toast.error(errorMessageOf(err) || 'خطا در ثبت تغییرات');
    } finally {
      setSending(false);
    }
  };

  return {
    loading, saving, loadError, reload, data, stages, products, summary: data?.summary,
    editCount: edits.size, hasChanges, statusOf, percentOf, stagePercentOf, stageCountsOf, isEdited,
    toggle, setAllStagesOf, setStageForAll, reset, save,
  };
}

export type ProductProgressTicks = ReturnType<typeof useProductProgressTicks>;
