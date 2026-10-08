import { useHasAnyPermission } from '../contexts/AuthContext';
import {
  BOM_ALLOCATE_PERMISSIONS, BOM_CONSUME_PERMISSIONS, BOM_RELEASE_PERMISSIONS,
  PROJECT_CREATE_PERMISSIONS, PROJECT_DELETE_PERMISSIONS, PROJECT_EDIT_PERMISSIONS,
} from '../lib/permissions/projectPermissions';
import { DIRECT_ORDER_PERMISSIONS } from '../lib/projects/projectPurchaseOrder';

/**
 * v9.0.417 (TD-752، B11-18): هر دکمه تغییردهنده بسته کنترل پروژه با کلیدهای گارد API خودش نشان داده می‌شود (مدیر همیشه).
 * فقط برای نمایش است؛ سرور همان کلیدها را خودش می‌سنجد.
 */
export function useProjectPermissions() {
  return {
    canCreate: useHasAnyPermission(PROJECT_CREATE_PERMISSIONS),
    canEdit: useHasAnyPermission(PROJECT_EDIT_PERMISSIONS),
    canDelete: useHasAnyPermission(PROJECT_DELETE_PERMISSIONS),
    canAllocate: useHasAnyPermission(BOM_ALLOCATE_PERMISSIONS),
    canConsumeAllocation: useHasAnyPermission(BOM_CONSUME_PERMISSIONS),
    canReleaseAllocation: useHasAnyPermission(BOM_RELEASE_PERMISSIONS),
    /** درخواست خرید کسری‌ها از کنترل موجودی (`POST /procurement/requisitions`) */
    canRequestPurchase: useHasAnyPermission(DIRECT_ORDER_PERMISSIONS.requisition),
  };
}
