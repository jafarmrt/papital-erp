import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../api';
import type { Item, ProcurementInboxSummary, ProcurementOrder, PurchaseRequisition } from '../../types';
import { PICK_LIST_URLS } from '../../lib/permissions/pickLists';
import { getErrorMessage } from '../../utils';

/** خطای هر بخش میز تدارکات؛ بخشی که بارگذاری نشد پیام خودش را دارد و بخش‌های دیگر نشان داده می‌شوند */
export interface ProcurementDeskErrors {
  summary?: string;
  requisitions?: string;
  orders?: string;
  items?: string;
}

/** آرایه داده پاسخ فهرست (`{ data: [...] }` یا آرایه)، با گارد آرایه */
function listOf<T>(res: unknown): T[] {
  const data = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as T[] : [];
}

/**
 * v9.0.277 (TD-702، B10-15): داده‌های میز تدارکات، هر بخش جدا. خطای یک بخش (مثلاً ۴۰۳ خلاصه) فقط همان بخش را با پیامش
 * نشان می‌دهد و درخواست‌ها و سفارش‌ها نشان داده می‌شوند. پیش‌تر چهار درخواست در یک `Promise.all` بودند و هر خطا کل میز
 * را خالی می‌کرد؛ بارگذاری تازه درخواست‌های قبلی را لغو می‌کند.
 */
export function useProcurementDeskData() {
  const [requisitions, setRequisitions] = useState<PurchaseRequisition[]>([]);
  const [orders, setOrders] = useState<ProcurementOrder[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<ProcurementInboxSummary | null>(null);
  const [errors, setErrors] = useState<ProcurementDeskErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    setIsLoading(true);
    const [reqs, items, sum, ords] = await Promise.allSettled([
      fetchJson<unknown>('/api/procurement/requisitions?limit=100', { signal }),
      fetchJson<unknown>(PICK_LIST_URLS.items, { signal }),
      fetchJson<{ data?: ProcurementInboxSummary }>('/api/procurement/inbox/summary', { signal }),
      fetchJson<unknown>('/api/procurement/orders?limit=200', { signal }),
    ]);
    if (signal.aborted) return;
    const next: ProcurementDeskErrors = {};
    if (reqs.status === 'fulfilled') setRequisitions(listOf<PurchaseRequisition>(reqs.value));
    else next.requisitions = getErrorMessage(reqs.reason);
    if (items.status === 'fulfilled') setWarehouseItems(listOf<Item>(items.value));
    else next.items = getErrorMessage(items.reason);
    if (sum.status === 'fulfilled') setSummary(sum.value?.data ?? null);
    else {
      setSummary(null);
      next.summary = getErrorMessage(sum.reason);
    }
    if (ords.status === 'fulfilled') setOrders(listOf<ProcurementOrder>(ords.value));
    else next.orders = getErrorMessage(ords.reason);
    setErrors(next);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    return () => controllerRef.current?.abort();
  }, [reload]);

  return { requisitions, orders, warehouseItems, summary, errors, isLoading, reload };
}
