import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, items, transactions } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { nextVersion } from '../../lib/occHelper.js';
import { itemIdsWithOpeningVoucher } from './itemOpening.service.js';
import { OPENING_KARDEX_ROW } from './itemOpeningValue.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';

/**
 * v11 phase 6.1j (S13): an item whose definition goes through a workflow enters its opening stock when it is defined, and
 * its opening voucher (Dr inventory / Cr opening capital) is issued only when the definition is approved. When the
 * definition is rejected or canceled instead, the opening never got a voucher, so the stock it entered goes too: its
 * kardex rows are voided and the warehouse stock goes back down. Before, the item kept that stock with no ledger entry.
 * When the item has moved since (any other live kardex row or document line), the stock may already be sold or issued
 * and its value is in the ledger; the rejection is then refused (409 `ITEM_OPENING_IN_USE`).
 */
export async function withdrawUnapprovedOpening(tx: DbExecutor, itemId: number): Promise<number> {
  const [item] = await tx.select({ id: items.id, name: items.name, code: items.code, version: items.version })
    .from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0))).for('update');
  if (!item) return 0;
  if ((await itemIdsWithOpeningVoucher(tx, [itemId])).has(itemId)) return 0;

  const opening = await tx.execute(sql`
    SELECT t.id, t.quantity::text AS quantity, t.location FROM transactions t
     WHERE t.item_id = ${itemId} AND ${OPENING_KARDEX_ROW} ORDER BY t.id`);
  const rows = (opening.rows ?? []) as Array<{ id: number; quantity: string; location: string | null }>;
  if (rows.length === 0) return 0;

  const openingIds = rows.map(r => Number(r.id));
  const [otherRow] = await tx.select({ id: transactions.id }).from(transactions)
    .where(and(eq(transactions.itemId, itemId), eq(transactions.isDeleted, 0), sql`${transactions.id} NOT IN (${sql.join(openingIds.map(id => sql`${id}`), sql`, `)})`))
    .limit(1);
  const [line] = await tx.select({ id: documentItems.id }).from(documentItems)
    .where(and(eq(documentItems.itemId, itemId), eq(documentItems.isDeleted, 0))).limit(1);
  if (otherRow || line) {
    throw new ConflictError(
      `موجودی اول دوره کالای «${item.name}» (${item.code}) پس از تعریف در گردش یا سند دیگری به کار رفته است، پس رد تعریف کالا `
        + 'آن را برنمی‌گرداند. تعریف را تأیید کنید تا سند افتتاحیه صادر شود، یا اول آن سندها را باطل کنید.',
      { itemId },
      'ITEM_OPENING_IN_USE',
    );
  }

  let withdrawn = 0;
  for (const row of rows) {
    const warehouse = await ItemWarehouseStockService.resolveWarehouse(tx, row.location ?? '');
    const quantity = Number(row.quantity);
    await ItemWarehouseStockService.applyMovement(tx, { itemId, warehouse, inOut: 'out', quantity });
    withdrawn += quantity;
  }
  await tx.update(transactions).set({ isDeleted: 1 }).where(inArray(transactions.id, openingIds));
  await tx.update(items).set({ version: nextVersion(item.version) }).where(eq(items.id, itemId));
  return withdrawn;
}

