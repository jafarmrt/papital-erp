import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../api';
import { getErrorMessage } from '../../utils';

export interface ProcurementPageState<T> {
  rows: T[];
  total: number;
  isLoading: boolean;
  error?: string;
}

/** آرایه داده پاسخ فهرست (`{ data: [...] }` یا آرایه)، با گارد آرایه */
function rowsOf<T>(res: unknown): T[] {
  const data = Array.isArray(res) ? res : (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as T[] : [];
}

/**
 * v9.0.278 (TD-697، B10-10): یک صفحه از فهرست تدارکات با فیلترهای سرور. پیش‌تر میز ۱۰۰ درخواست و ۲۰۰ سفارش آخر را
 * می‌خواند و جست‌وجو و فیلتر را در مرورگر روی همان‌ها انجام می‌داد، پس درخواست‌های قدیمی‌تر دیده نمی‌شدند. `url` تهی یعنی
 * این فهرست اکنون خوانده نمی‌شود؛ `version` تازه همان صفحه را دوباره می‌خواند؛ درخواست قبلی لغو می‌شود.
 */
export function useProcurementPage<T>(
  url: string | null,
  query: Record<string, string | number | undefined>,
  version: number,
): ProcurementPageState<T> {
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return params.toString();
  }, [query]);
  const [state, setState] = useState<ProcurementPageState<T>>({ rows: [], total: 0, isLoading: url !== null });

  useEffect(() => {
    if (url === null) return undefined;
    const controller = new AbortController();
    setState(prev => ({ ...prev, isLoading: true }));
    fetchJson<unknown>(`${url}?${queryString}`, { signal: controller.signal })
      .then(res => {
        if (controller.signal.aborted) return;
        const total = Number((res as { total?: unknown } | null)?.total);
        const rows = rowsOf<T>(res);
        setState({ rows, total: Number.isFinite(total) ? total : rows.length, isLoading: false });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ rows: [], total: 0, isLoading: false, error: getErrorMessage(err) });
      });
    return () => controller.abort();
  }, [url, queryString, version]);

  return state;
}
