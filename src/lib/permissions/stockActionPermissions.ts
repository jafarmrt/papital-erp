/**
 * v10.0.249 (TD-1130): مجوز هر دکمه انبار، همان کلیدی که API آن می‌خواهد؛ سرور و صفحه‌ها از همین فهرست می‌خوانند.
 */

/** کاردکس کالا (`GET /inventory/item-kardex/:itemId`): بها نشان می‌دهد، پس فقط کلیدهای صفحه گردش کالا که بها می‌خوانند */
export const ITEM_KARDEX_READ_PERMISSIONS = ['warehouse.view', 'accounting.view'] as const;

/** بازسازی موجودی از کاردکس (`/inventory/rebuild-from-ledger` و هم‌خانواده‌ها) */
export const STOCK_REBUILD_PERMISSION = 'inventory.reconcile';

/** ثبت حواله انتقال انبار (`POST /inventory/transfer`) */
export const WAREHOUSE_TRANSFER_PERMISSION = 'warehouse.transfer';

/** ابطال حواله انتقال (`DELETE /documents/:id`) */
export const TRANSFER_VOID_PERMISSION = 'documents.delete';

/** ساخت و ویرایش طرح ترنسفر (`POST` / `PUT /transfers`) */
export const TRANSFER_DESIGN_SAVE_PERMISSIONS = ['products.create', 'products.edit'] as const;

/** حذف طرح ترنسفر (`DELETE /transfers/:code`) */
export const TRANSFER_DESIGN_DELETE_PERMISSION = 'products.delete';
