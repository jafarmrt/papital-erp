import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../api';
import type { DailyWorkLog } from '../types';

export const DAILY_LOG_NOT_FOUND_MESSAGE = 'این گزارش کار یافت نشد یا اجازه دیدن آن را ندارید';

const withoutId = (prev: URLSearchParams) => {
  const next = new URLSearchParams(prev);
  next.delete('id');
  return next;
};

/**
 * v9.0.251 (TD-645, finding B13-20): the link `/daily-logs?id=N` of a mention or review notification, the dashboard
 * widget and the calendar opens that one log, read with `GET /daily-logs/:id` (the same visibility rule as the list),
 * whatever page of the list it is on; closing it removes `id` from the address.
 */
export function useDailyLogFocus(): { focusedLog: DailyWorkLog | null; closeFocusedLog: () => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawId = searchParams.get('id');
  const id = rawId && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : null;
  const [focusedLog, setFocusedLog] = useState<DailyWorkLog | null>(null);

  const clearId = () => setSearchParams(withoutId, { replace: true });

  useEffect(() => {
    if (id === null) {
      setFocusedLog(null);
      return;
    }
    const controller = new AbortController();
    fetchJson<DailyWorkLog>(`/daily-logs/${id}`, { signal: controller.signal })
      .then((log) => setFocusedLog(log && typeof log === 'object' ? log : null))
      .catch(() => {
        if (controller.signal.aborted) return;
        setFocusedLog(null);
        toast.error(DAILY_LOG_NOT_FOUND_MESSAGE);
        setSearchParams(withoutId, { replace: true });
      });
    return () => controller.abort();
  }, [id, setSearchParams]);

  return { focusedLog, closeFocusedLog: clearId };
}
