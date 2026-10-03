import { fetchJson } from '../../api';
import { safeExtractArray } from '../../utils';

/**
 * صفحه حسابداری با React Query (FE-005): تنظیمات مشترک خواندنی‌ها و ذخیره‌ها.
 *
 * - staleTime پنج دقیقه؛ سیگنال لغو React Query به fetchJson داده می‌شود تا بستن صفحه/تب یا رفتن به پارامتر
 *   دیگر درخواست در جریان را لغو کند.
 * - بدون تلاش مجدد و بدون بازخوانی با فوکوس پنجره (مثل صفحه پیشین که هر خواندن را یک بار می‌فرستاد).
 * - فهرست‌های اصلی صفحه را صفحات دیگر هم تغییر می‌دهند (فاکتور، لیست حقوق، تسویه فاکتور، ...) که همه کش را
 *   باطل نمی‌کنند؛ پس مثل قبل هر بار باز شدن صفحه از سرور خوانده می‌شوند (داده کش‌شده تا رسیدن پاسخ می‌ماند).
 */

export const FIVE_MINUTES = 5 * 60 * 1000;

export const ACCOUNTING_LIST_QUERY_OPTIONS = {
  staleTime: FIVE_MINUTES,
  refetchOnMount: 'always',
  refetchOnWindowFocus: false,
  retry: false,
} as const;

export const ACCOUNTING_REPORT_QUERY_OPTIONS = {
  staleTime: FIVE_MINUTES,
  refetchOnWindowFocus: false,
  retry: false,
  // گزارش خطادار با هر mount دوباره فرستاده نشود؛ «اعمال فیلتر/بروزرسانی» دستی است
  retryOnMount: false,
} as const;

/**
 * خطای ذخیره‌ها مثل قبل به فراخواننده (تب/مودال) برمی‌گردد و همان‌جا با پیام فارسی خودش اعلام می‌شود؛
 * toast پیش‌فرض کلاینت (lib/queryClient.ts) نباید پیام دوم نشان دهد.
 */
export const silentMutationError = (): undefined => undefined;

/**
 * خواندن یک فهرست (پاسخ صفحه‌بندی‌شده { data } یا آرایه) — مثل صفحه پیشین خطا فقط در کنسول ثبت می‌شود.
 */
export async function fetchAccountingList<T>(url: string, signal: AbortSignal, label: string): Promise<T[]> {
  try {
    return safeExtractArray<T>(await fetchJson<unknown>(url, { signal }));
  } catch (err: unknown) {
    if (!signal.aborted) console.error(`Error loading ${label}:`, err);
    throw err;
  }
}
