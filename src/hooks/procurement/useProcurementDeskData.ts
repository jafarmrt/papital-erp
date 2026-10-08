import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '../../api';
import type { ProcurementInboxSummary } from '../../types';
import { getErrorMessage } from '../../utils';

/** خطای خلاصه میز تدارکات؛ بخش‌های دیگر جدا بارگذاری و نشان داده می‌شوند */
export interface ProcurementDeskErrors {
  summary?: string;
}

/**
 * v9.0.352 (TD-702، B10-15): داده‌های میز تدارکات، هر بخش جدا. خطای یک بخش (مثلاً ۴۰۳ خلاصه) فقط همان بخش را با پیامش
 * نشان می‌دهد و بخش‌های دیگر نشان داده می‌شوند. پیش‌تر چهار درخواست در یک `Promise.all` بودند و هر خطا کل میز
 * را خالی می‌کرد؛ بارگذاری تازه درخواست‌های قبلی را لغو می‌کند.
 * v9.0.353 (TD-697): درخواست‌ها و سفارش‌ها صفحه‌به‌صفحه با `useProcurementPage` خوانده می‌شوند؛ `version` با هر
 * بارگذاری تازه بالا می‌رود تا صفحه‌های باز هم دوباره خوانده شوند.
 * v9.0.354 (TD-700): کالاها دیگر خوانده نمی‌شوند؛ انتخابگر کالای فرم درخواست در سرور جست‌وجو می‌کند.
 */
export function useProcurementDeskData() {
  const [summary, setSummary] = useState<ProcurementInboxSummary | null>(null);
  const [errors, setErrors] = useState<ProcurementDeskErrors>({});
  const [version, setVersion] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  const loadSummary = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    const [sum] = await Promise.allSettled([
      fetchJson<{ data?: ProcurementInboxSummary }>('/api/procurement/inbox/summary', { signal }),
    ]);
    if (signal.aborted) return;
    const next: ProcurementDeskErrors = {};
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

  return { summary, errors, version, reload };
}
