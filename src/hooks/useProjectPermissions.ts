import { useHasAnyPermission } from '../contexts/AuthContext';
import {
  BOM_ALLOCATE_PERMISSIONS, BOM_CONSUME_PERMISSIONS, BOM_RELEASE_PERMISSIONS,
  PROJECT_CREATE_PERMISSIONS, PROJECT_DELETE_PERMISSIONS, PROJECT_EDIT_PERMISSIONS, PROJECT_STOCK_IN_PERMISSIONS,
} from '../lib/permissions/projectPermissions';
import { DIRECT_ORDER_PERMISSIONS } from '../lib/projects/projectPurchaseOrder';

/**
 * v9.0.417 (TD-752، B11-18): هر دکمه تغییردهنده بسته کنترل پروژه با کلیدهای گارد API خودش نشان داده می‌شود (مدیر همیشه).
 * فقط برای نمایش است؛ سرور همان کلیدها را خودش می‌سنجد.
 */
export function useProjectPermissions() {
  const canEdit = useHasAnyPermission(PROJECT_EDIT_PERMISSIONS);
  const canStockIn = useHasAnyPermission(PROJECT_STOCK_IN_PERMISSIONS);
  const canRelease = useHasAnyPermission(BOM_RELEASE_PERMISSIONS);
  return {
    canCreate: useHasAnyPermission(PROJECT_CREATE_PERMISSIONS),
    canEdit,
    canDelete: useHasAnyPermission(PROJECT_DELETE_PERMISSIONS),
    canAllocate: useHasAnyPermission(BOM_ALLOCATE_PERMISSIONS),
    canConsumeAllocation: useHasAnyPermission(BOM_CONSUME_PERMISSIONS),
    /** v9.0.454 (TD-923): هر دو گارد آزادسازی، کلید پروژه یا انبار و `warehouse.in` */
    canReleaseAllocation: canRelease && canStockIn,
    /** v9.0.454 (TD-923): «ورود به انبار» پروژه `projects.edit` و `warehouse.in` می‌خواهد */
    canDeliver: canEdit && canStockIn,
    /** درخواست خرید کسری‌ها از کنترل موجودی (`POST /procurement/requisitions`) */
    canRequestPurchase: useHasAnyPermission(DIRECT_ORDER_PERMISSIONS.requisition),
  };
}
