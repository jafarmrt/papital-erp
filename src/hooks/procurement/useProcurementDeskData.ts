import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../api';
import type { Item, ProcurementInboxSummary } from '../../types';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { getErrorMessage } from '../../utils';

/** خطای هر بخش میز تدارکات؛ بخشی که بارگذاری نشد پیام خودش را دارد و بخش‌های دیگر نشان داده می‌شوند */
export interface ProcurementDeskErrors {
  summary?: string;
  items?: string;
}

/** آرایه داده پاسخ فهرست (`{ data: [...] }` یا آرایه)، با گارد آرایه */
function listOf<T>(res: unknown): T[] {
  const data = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as T[] : [];
}

/**
 * v9.0.277 (TD-702، B10-15): داده‌های میز تدارکات، هر بخش جدا. خطای یک بخش (مثلاً ۴۰۳ خلاصه) فقط همان بخش را با پیامش
 * نشان می‌دهد و بخش‌های دیگر نشان داده می‌شوند. پیش‌تر چهار درخواست در یک `Promise.all` بودند و هر خطا کل میز
 * را خالی می‌کرد؛ بارگذاری تازه درخواست‌های قبلی را لغو می‌کند.
 * v9.0.278 (TD-697): درخواست‌ها و سفارش‌ها صفحه‌به‌صفحه با `useProcurementPage` خوانده می‌شوند؛ `version` با هر
 * بارگذاری تازه بالا می‌رود تا صفحه‌های باز هم دوباره خوانده شوند.
 */
export function useProcurementDeskData() {
  const [warehouseItems, setWarehouseItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<ProcurementInboxSummary | null>(null);
  const [errors, setErrors] = useState<ProcurementDeskErrors>({});
  const [version, setVersion] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const loadSummary = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    const [items, sum] = await Promise.allSettled([
      fetchJson<unknown>(PICK_LIST_URLS.items, { signal }),
      fetchJson<{ data?: ProcurementInboxSummary }>('/api/procurement/inbox/summary', { signal }),
    ]);
    if (signal.aborted) return;
    const next: ProcurementDeskErrors = {};
    if (items.status === 'fulfilled') setWarehouseItems(listOf<Item>(items.value));
    else next.items = getErrorMessage(items.reason);
    if (sum.status === 'fulfilled') setSummary(sum.value?.data ?? null);
    else {
      setSummary(null);
      next.summary = getErrorMessage(sum.reason);
    }
    setErrors(next);
  }, []);

  const reload = useCallback(async () => {
    setVersion(v => v + 1);
    await loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadSummary();
    return () => controllerRef.current?.abort();
  }, [loadSummary]);

  return { warehouseItems, summary, errors, version, reload };
}
