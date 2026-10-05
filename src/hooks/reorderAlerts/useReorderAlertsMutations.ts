import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchJson } from '../../api';
import { QUERY_KEYS } from '../../lib/queryKeys';
import { invalidateDomain, invalidateDomains, invalidatePreset } from '../../lib/queryInvalidation';
import { invalidateAfterStockAdjustment } from '../inventoryAudit/useInventoryAuditSave';
import type { ReorderItem } from '../../lib/reorderAlerts/reorderItems';
import type { PurchaseReceiptPayload } from '../../lib/reorderAlerts/reorderPurchaseReceipt';

/**
 * صفحه نقطه سفارش: ذخیره‌های صفحه با useMutation (همان درخواست‌ها و بدنه‌های صفحه پیشین).
 * پس از هر ذخیره، کش صفحات دیگری که همان داده را نشان می‌دهند باطل می‌شود تا تازه شوند
 * (فهرست و جزئیات کالاها در صفحه کالاها، آمار داشبورد، تدارکات، اسناد و ...).
 * خطاها مثل قبل با toast همان صفحه/مودال اعلام می‌شوند (نه toast پیش‌فرض کلاینت).
 */

const REORDER_ALERTS_KEY = QUERY_KEYS.items.reorderAlerts();

/**
 * تغییر نقطه سفارش (PUT /items/:id): همان preset ذخیره کالا در صفحه کالاها —
 * items (فهرست‌ها، جزئیات و همین فهرست هشدار نقطه سفارش که زیر items است)، dashboard (شمار کالاهای کم‌موجودی)،
 * transfers و pendingMaterials
 */
export async function invalidateAfterReorderPointChange(queryClient: QueryClient): Promise<void> {
  await invalidatePreset(queryClient, 'inventoryChange');
}

/** ثبت درخواست خرید: کارتابل تدارکات، صندوق گردش‌کار (درخواست، فرایند تایید را آغاز می‌کند) و فهرست هشدار همین صفحه */
export async function invalidateAfterRequisitionCreated(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateDomains(queryClient, ['procurement', 'workflow']),
    queryClient.invalidateQueries({ queryKey: REORDER_ALERTS_KEY }),
  ]);
}

/**
 * صدور مستقیم رسید/سفارش خرید (POST /documents، docType receipt): همان کلیدهای تغییر موجودی صفحه انبارگردانی
 * (اسناد، کاردکس، کالاها و هشدار نقطه سفارش، داشبورد، رزروها) به‌علاوه accounting برای سند حسابداری رسید قطعی
 */
export async function invalidateAfterPurchaseReceipt(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    invalidateAfterStockAdjustment(queryClient),
    invalidateDomain(queryClient, 'accounting'),
  ]);
}

/** تعریف پروژه تولید از همین صفحه (مودال مشترک پروژه): فهرست پروژه‌ها و فهرست هشدار همین صفحه */
export async function invalidateAfterProductionProjectCreated(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.projects.all }),
    queryClient.invalidateQueries({ queryKey: REORDER_ALERTS_KEY }),
  ]);
}

export interface ReorderPointVariables {
  item: ReorderItem;
  reorderPoint: number;
}

export function useUpdateReorderPoint() {
  const queryClient = useQueryClient();

  return useMutation<unknown, unknown, ReorderPointVariables>({
    mutationFn: ({ item, reorderPoint }) => fetchJson(`/items/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...item,
        reorder_point: reorderPoint
      })
    }),
    onSuccess: () => {
      void invalidateAfterReorderPointChange(queryClient);
    },
    onError: () => undefined,
  });
}

export interface RequisitionPayload {
  title: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  requiredDate: string;
  notes: string;
  items: Array<{
    itemId: number;
    itemCode: string;
    itemName: string;
    unit: string;
    requestedQty: number;
    unitPriceEstimate: number;
    notes: string;
  }>;
}

/** v8.0.88 (TD-387): بدنه POST /documents از `reorderPurchaseReceiptPayload` */
export type { PurchaseReceiptPayload } from '../../lib/reorderAlerts/reorderPurchaseReceipt';

export type ReorderPurchaseVariables =
  | { target: 'requisition'; payload: RequisitionPayload }
  | { target: 'direct_document'; payload: PurchaseReceiptPayload };

export interface ReorderPurchaseResult {
  /** پیام سرور برای درخواست خرید (برای سند مستقیم خالی) */
  message?: string;
}

/** مودال سفارش خرید مواد اولیه: ارسال درخواست خرید به تدارکات یا صدور مستقیم سند خرید انبار */
export function useReorderPurchaseSubmit() {
  const queryClient = useQueryClient();

  return useMutation<ReorderPurchaseResult, unknown, ReorderPurchaseVariables>({
    mutationFn: async (variables) => {
      if (variables.target === 'requisition') {
        // Submit Purchase Requisition to Procurement Workflow
        const res = await fetchJson<{ success: boolean; message?: string }>('/api/procurement/requisitions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(variables.payload)
        });
        return { message: res.message };
      }
      // Direct Document (Purchase Order / Receipt)
      await fetchJson<{ success: boolean; message?: string }>('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables.payload)
      });
      return {};
    },
    onSuccess: (_result, variables) => {
      if (variables.target === 'requisition') void invalidateAfterRequisitionCreated(queryClient);
      else void invalidateAfterPurchaseReceipt(queryClient);
    },
    onError: () => undefined,
  });
}
