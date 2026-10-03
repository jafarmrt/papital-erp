import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomains } from '../../lib/queryInvalidation';

/**
 * صفحه حسابداری: کلیدهایی که هر ذخیره باطل می‌کند (فقط پرس‌وجوهای فعال دوباره خوانده می‌شوند).
 * هر تغییری که سند حسابداری یا مانده‌ها را عوض می‌کند گزارش‌های مالی (تراز آزمایشی، دفتر کل، صورت‌ها، ...) را هم
 * باطل می‌کند. داشبورد اصلی (stats) آمار انبار است و از این تغییرات اثر نمی‌گیرد.
 */

const A = QUERY_KEYS.accounting;

function invalidateKeys(queryClient: QueryClient, keys: QueryKey[]): Promise<void> {
  return Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey }))).then(() => undefined);
}

/** ایجاد/ویرایش/حذف حساب و همگام‌سازی کدینگ استاندارد: فهرست و درخت حساب‌ها، خلاصه داشبورد مالی و گزارش‌ها */
export function invalidateAfterAccountChange(queryClient: QueryClient): Promise<void> {
  return invalidateKeys(queryClient, [A.accounts(), A.summary(), A.reports()]);
}

/**
 * هر تغییر سند حسابداری (ثبت/ویرایش/حذف/معکوس/اصلاحی/تایید/قطعی، بستن سال مالی، صدور خودکار اسناد):
 * فهرست و جزئیات اسناد، خلاصه، مانده حساب‌ها و همه گزارش‌ها —
 * documents: سند حسابداری فاکتور/رسید در جزئیات و فهرست اسناد —
 * piecework: سند و وضعیت لیست‌های حقوق (لیست حقوق شماره و وضعیت سند خود را نشان می‌دهد)
 */
export function invalidateAfterVoucherChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    invalidateKeys(queryClient, [A.vouchers(), [...A.all, 'voucher-detail'], A.summary(), A.accounts(), A.reports()]),
    invalidateDomains(queryClient, ['documents', 'piecework']),
  ]).then(() => undefined);
}

/**
 * خزانه (تراکنش دریافت/پرداخت، ابطال، انتقال بین‌بانکی، حساب بانکی و سند افتتاحیه آن، همگام‌سازی مانده‌ها):
 * مانده حساب‌های بانکی و تراکنش‌ها به‌علاوه همه کلیدهای تغییر سند (تسویه فاکتور و پرداخت حقوق هم از همین مسیرند)
 */
export function invalidateAfterTreasuryChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: A.treasury() }),
    invalidateAfterVoucherChange(queryClient),
  ]).then(() => undefined);
}

/** چک (ثبت، تغییر وضعیت — وصول/خرج/برگشت که تراکنش خزانه و سند می‌سازد — و حذف): فهرست چک‌ها و کلیدهای خزانه */
export function invalidateAfterChequeChange(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: A.cheques() }),
    invalidateAfterTreasuryChange(queryClient),
  ]).then(() => undefined);
}

/** آشتی‌سنجی بانکی (علامت‌گذاری تراکنش‌ها): فقط تراکنش‌ها و مانده‌های خزانه */
export function invalidateAfterReconciliation(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: A.treasury() });
}
