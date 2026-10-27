/**
 * v10.0.249 (TD-1130): مجوز هر دکمه انبار، همان کلیدی که API آن می‌خواهد؛ سرور و صفحه‌ها از همین فهرست می‌خوانند.
 */

/** کاردکس کالا (`GET /inventory/item-kardex/:itemId`): بها نشان می‌دهد، پس فقط کلیدهای صفحه گردش کالا که بها می‌خوانند */
export const ITEM_KARDEX_READ_PERMISSIONS = ['warehouse.view', 'accounting.view'] as const;

/** بازسازی موجودی از کاردکس (`/inventory/rebuild-from-ledger` و هم‌خانواده‌ها) */
export const STOCK_REBUILD_PERMISSION = 'inventory.reconcile';

/** v11 phase 6.1j (S8, card t56-5): opening stock when an item is defined (`POST /items` with stock), as a receipt asks */
export const OPENING_STOCK_PERMISSION = 'warehouse.in';

/** ثبت حواله انتقال انبار (`POST /inventory/transfer`) */
export const WAREHOUSE_TRANSFER_PERMISSION = 'warehouse.transfer';

/** ابطال حواله انتقال (`DELETE /documents/:id`)؛ v11 phase 6.1j (S7): مجوز ابطال سند انبار، نه «حذف فاکتور» */
export const TRANSFER_VOID_PERMISSION = 'documents.void_stock';

/** ساخت و ویرایش طرح ترنسفر (`POST` / `PUT /transfers`) */
export const TRANSFER_DESIGN_SAVE_PERMISSIONS = ['products.create', 'products.edit'] as const;

/** حذف طرح ترنسفر (`DELETE /transfers/:code`) */
export const TRANSFER_DESIGN_DELETE_PERMISSION = 'products.delete';
