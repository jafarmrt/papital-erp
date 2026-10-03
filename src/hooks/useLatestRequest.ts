import { useCallback, useEffect, useRef } from 'react';

export interface LatestRequest {
  signal: AbortSignal;
  /** هنوز آخرین درخواست است (لغو یا جایگزین نشده و کامپوننت باز است) */
  isCurrent: () => boolean;
}

/**
 * P3-8 (v7.0.104): فقط پاسخ آخرین درخواست یک گزارش اعمال می‌شود. begin() درخواست قبلی را لغو می‌کند و با
 * unmount همه لغو می‌شوند؛ نتیجه، خطا و پایان «در حال بارگذاری» فقط وقتی isCurrent() است اعمال شوند.
 */
export function useLatestRequest(): () => LatestRequest {
  const current = useRef<AbortController | null>(null);

  useEffect(() => () => current.current?.abort(), []);

  return useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return {
      signal: controller.signal,
      isCurrent: () => current.current === controller && !controller.signal.aborted,
    };
  }, []);
}
