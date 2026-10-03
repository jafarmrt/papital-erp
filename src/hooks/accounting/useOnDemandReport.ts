import { useCallback, useState } from 'react';
import { hashKey, skipToken, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { errorMessageOf } from '../../utils';
import { ACCOUNTING_REPORT_QUERY_OPTIONS } from './accountingQueryConfig';

/**
 * گزارشی که با دکمه/تب «اجرا» می‌شود (تراز آزمایشی، صورت‌ها، دفتر روزنامه، جریان نقد، پیش‌نمایش بستن سال، ...).
 *
 * run(params) پارامترها را به کلید کش تبدیل می‌کند و همیشه از سرور می‌خواند (درخواست در جریان همان پارامترها
 * دوباره فرستاده نمی‌شود). نمایش همیشه از کلید آخرین پارامترهاست، پس پاسخ دیررس پارامترهای قدیمی هرگز جای گزارش
 * تازه را نمی‌گیرد؛ با رفتن به پارامتر دیگر یا بسته شدن صفحه، درخواست قبلی لغو می‌شود (P3-8). تا رسیدن نتیجه
 * پارامترهای تازه، گزارش قبلی نمایش داده می‌شود (پس از reset نه).
 */

export interface OnDemandReportSpec<P, T> {
  /** کلید کش با همه پارامترها */
  key: (params: P) => QueryKey;
  /** کلید وضعیت «هنوز اجرا نشده» */
  idleKey: QueryKey;
  url: (params: P) => string;
  /** پاسخ سرور ← داده گزارش */
  parse: (res: unknown) => T;
  /** پیام خطای پیش‌فرض؛ بدون آن خطا فقط در کنسول ثبت می‌شود */
  errorText?: string;
}

export interface OnDemandReport<P, T> {
  data: T | null;
  params: P | null;
  loading: boolean;
  /** اجرای گزارش؛ نتیجه، یا undefined در خطا/لغو */
  run: (params: P) => Promise<T | undefined>;
  /** پاک کردن گزارش نمایش‌داده‌شده (و لغو درخواست در جریان) */
  reset: () => void;
}

/** پاسخ گزارش‌ها { report } یا خود گزارش است */
export function reportFromResponse<T>(res: unknown): T | null {
  if (res && typeof res === 'object' && 'report' in res && (res as { report?: unknown }).report) {
    return (res as { report: T }).report;
  }
  return (res ?? null) as T | null;
}

async function loadReport<P, T>(spec: OnDemandReportSpec<P, T>, params: P, signal: AbortSignal): Promise<T> {
  try {
    return spec.parse(await fetchJson<unknown>(spec.url(params), { signal }));
  } catch (err: unknown) {
    if (!signal.aborted) {
      if (spec.errorText) toast.error(errorMessageOf(err) || spec.errorText);
      else console.error(`Error loading report ${spec.url(params)}:`, err);
    }
    throw err;
  }
}

export function useOnDemandReport<P, T>(spec: OnDemandReportSpec<P, T>): OnDemandReport<P, T> {
  const queryClient = useQueryClient();
  const [params, setParams] = useState<P | null>(null);

  const query = useQuery<T>({
    queryKey: params === null ? spec.idleKey : spec.key(params),
    queryFn: params === null ? skipToken : ({ signal }) => loadReport(spec, params, signal),
    ...ACCOUNTING_REPORT_QUERY_OPTIONS,
    // تا رسیدن نتیجه پارامترهای تازه گزارش قبلی می‌ماند، مگر گزارش پاک شده باشد (reset؛ مثلاً تغییر سال مالی)
    placeholderData: (previousData, previousQuery) =>
      previousQuery && hashKey(previousQuery.queryKey) === hashKey(spec.idleKey) ? undefined : previousData,
  });

  const run = useCallback(async (next: P): Promise<T | undefined> => {
    setParams(next);
    try {
      return await queryClient.fetchQuery<T>({
        queryKey: spec.key(next),
        queryFn: ({ signal }) => loadReport(spec, next, signal),
        staleTime: 0,
        retry: false,
      });
    } catch {
      return undefined;
    }
  }, [queryClient, spec]);

  const reset = useCallback(() => setParams(null), []);

  return {
    data: params === null ? null : (query.data ?? null),
    params,
    loading: query.isFetching,
    run,
    reset,
  };
}
