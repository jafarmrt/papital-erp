import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomains, invalidatePreset } from '../../lib/queryInvalidation';
import type { AuditSavePayload } from '../../lib/inventoryAudit/auditSheet';

/**
 * صفحه انبارگردانی: ثبت نهایی سند انبارگردانی با useMutation (همان POST /documents صفحه پیشین).
 * پس از هر تغییر موجودی در این صفحه (انبارگردانی، حواله انتقال، بازسازی از کاردکس، ترمیم موجودی انبارها،
 * تخصیص/مصرف مواد پروژه) کش صفحات دیگری که موجودی را نشان می‌دهند باطل می‌شود.
 */

/** کلیدهایی که تغییر موجودی از صفحه انبارگردانی باطل می‌کند */
export async function invalidateAfterStockAdjustment(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    // documents: فهرست اسناد، سوابق انبارگردانی و حواله‌ها، شماره بعدی سند و جزئیات سند — transactions: کاردکس
    invalidateDomains(queryClient, ['documents', 'transactions']),
    // items، dashboard (آمار انبار)، transfers، pendingMaterials (همان preset نهایی‌سازی و ابطال سند)
    invalidatePreset(queryClient, 'inventoryChange'),
    // inventory: رزرو موجودی، گزارش سلامت سه‌طرفه و اقلام شمارش همین صفحه
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.inventory.all }),
  ]);
}

export function useInventoryAuditSave() {
  const queryClient = useQueryClient();

  return useMutation<unknown, unknown, AuditSavePayload>({
    mutationFn: (payload) => fetchJson('/documents', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
    onSuccess: () => {
      void invalidateAfterStockAdjustment(queryClient);
    },
    // خطا مثل قبل فقط در کادر خطای برگه شمارش نمایش داده می‌شود (نه toast پیش‌فرض کلاینت)
    onError: () => undefined,
  });
}
