import { ConflictError } from '../../errors/customErrors.js';

/** The code every path answers with when a document, movement or allocation names a deleted item */
export const ITEM_DELETED_CODE = 'ITEM_DELETED';

/**
 * v11 phase 6.1j (N3): a deleted item named by another record (a document line, a transfer, a BOM allocation) is a
 * conflict, 409 `ITEM_DELETED` with its name and code, on every path; an id that never existed stays 404. Before, a sales
 * line, a transfer and an allocation answered 404 «کالا یافت نشد» for a deleted item, while a receipt answered 409, so the
 * same item read as missing on one screen and as deleted on the next. The item's own routes (`/items/:id`) keep 404.
 */
export function deletedItemError(item: { id: number; name: string | null; code: string | null }, consequence?: string): ConflictError {
  return new ConflictError(
    `کالای «${item.name ?? ''}» (${item.code ?? ''}) حذف شده است و ${consequence ?? 'در سند، انتقال یا تخصیص تازه به کار نمی‌رود.'}`,
    { itemId: item.id },
    ITEM_DELETED_CODE,
  );
}
