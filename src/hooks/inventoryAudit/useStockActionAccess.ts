import { useHasAnyPermission, useHasPermission } from '../../contexts/AuthContext';
import {
  ITEM_KARDEX_READ_PERMISSIONS,
  STOCK_REBUILD_PERMISSION,
  TRANSFER_DESIGN_DELETE_PERMISSION,
  TRANSFER_DESIGN_SAVE_PERMISSIONS,
  TRANSFER_VOID_PERMISSION,
  WAREHOUSE_TRANSFER_PERMISSION,
} from '../../lib/permissions/stockActionPermissions';

/** v10.0.249 (TD-1130): دکمه‌های صفحه انبارگردانی هر کدام با کلید API خودشان */
export function useInventoryAuditActionAccess() {
  return {
    canOpenKardex: useHasAnyPermission(ITEM_KARDEX_READ_PERMISSIONS),
    canRebuild: useHasPermission(STOCK_REBUILD_PERMISSION),
    canTransfer: useHasPermission(WAREHOUSE_TRANSFER_PERMISSION),
    canVoidTransfer: useHasPermission(TRANSFER_VOID_PERMISSION),
  };
}

/** v10.0.249 (TD-1130): ساخت، ویرایش و حذف طرح ترنسفر با کلیدهای مسیرهای `/transfers` */
export function useTransferDesignAccess() {
  return {
    canSave: useHasAnyPermission(TRANSFER_DESIGN_SAVE_PERMISSIONS),
    canDelete: useHasPermission(TRANSFER_DESIGN_DELETE_PERMISSION),
  };
}
