import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { documentItems, items, transactions } from '../../db/schema.js';
import { ConflictError } from '../../errors/customErrors.js';
import { nextVersion } from '../../lib/occHelper.js';
import { money } from '../../lib/money.js';
import { businessNowIsoDateTime } from '../../lib/businessClock.js';
import { itemIdsWithOpeningVoucher } from './itemOpening.service.js';
import { OPENING_KARDEX_ROW } from './itemOpeningValue.js';
import { ItemWarehouseStockService } from './itemWarehouseStock.service.js';
import { LEDGER_ROW_FILTER } from './stockMovementDate.js';
import { FiscalPeriodService } from '../accounting/fiscalPeriod.service.js';
import { formatPersianNumber } from '../../utils/persianNumber.js';

/**
 * v11 phase 6.1j (S13): an item whose definition goes through a workflow enters its opening stock when it is defined, and
 * its opening voucher (Dr inventory / Cr opening capital) is issued only when the definition is approved. When the
 * definition is rejected or canceled instead, the opening never got a voucher, so the stock it entered goes too: its
 * kardex rows are voided and the warehouse stock goes back down. Before, the item kept that stock with no ledger entry.
 * When the item has moved since (any other live kardex row or document line), the stock may already be sold or issued
 * and its value is in the ledger; the rejection is then refused (409 `ITEM_OPENING_IN_USE`). An opening dated in a
 * closed fiscal year is not withdrawn either (409 `ITEM_OPENING_IN_CLOSED_YEAR`), as a void there is not (M10).
 */
export async function withdrawUnapprovedOpening(tx: DbExecutor, itemId: number, performedBy?: string): Promise<number> {
  const [item] = await tx.select({ id: items.id, name: items.name, code: items.code, version: items.version })
    .from(items).where(and(eq(items.id, itemId), eq(items.isDeleted, 0))).for('no key update');
  if (!item) return 0;
  if ((await itemIdsWithOpeningVoucher(tx, [itemId])).has(itemId)) return 0;

  const opening = await tx.execute(sql`
    SELECT t.id, t.quantity::text AS quantity, t.location, t.date::text AS date FROM transactions t
     WHERE t.item_id = ${itemId} AND ${OPENING_KARDEX_ROW} ORDER BY t.id`);
  const rows = (opening.rows ?? []) as Array<{ id: number; quantity: string; location: string | null; date: string | null }>;
  if (rows.length === 0) return 0;

  const openingIds = rows.map(r => Number(r.id));
  const closedYears = new Set<number>();
  for (const row of rows) {
    const date = String(row.date ?? '').slice(0, 10);
    if (date && await FiscalPeriodService.isClosedShared(date, tx)) closedYears.add(FiscalPeriodService.yearOf(date));
  }
  if (closedYears.size > 0) {
    const yearList = [...closedYears].sort((a, b) => a - b).map(y => formatPersianNumber(y, 0)).join('، ');
    throw new ConflictError(
      `موجودی اول دوره کالای «${item.name}» (${item.code}) در سال مالی ${yearList} ثبت شده که بسته شده است، پس رد تعریف کالا `
        + 'آن را برنمی‌گرداند. تعریف را تأیید کنید تا سند افتتاحیه صادر شود و موجودی را در سال باز با حواله یا شمارش انبار کم کنید.',
      { itemId, closedYears: [...closedYears] },
      'ITEM_OPENING_IN_CLOSED_YEAR',
    );
  }
  // a voided document's rows and their reversals are not a movement (LEDGER_ROW_FILTER), so a voided sale does not
  // keep the opening in use
  const other = await tx.execute(sql`
    SELECT t.id FROM transactions t
     WHERE t.item_id = ${itemId} AND ${LEDGER_ROW_FILTER}
       AND t.id NOT IN (${sql.join(openingIds.map(id => sql`${id}`), sql`, `)})
     LIMIT 1`);
  const otherRow = other.rows?.[0];
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

  // v11 phase 7.2 (finding F5 of the v11 full test): as a document void does, the opening rows are soft-deleted and each
  // gets an active reversal row (`reversal_of_id`), so the Kardex keeps the trace of what was entered and taken back;
  // before, the rows were only soft-deleted. The item row is locked FOR NO KEY UPDATE, as every stock path locks it. The
  // reversal rows carry the user who rejected the definition. The warehouse stock goes down with `applyMovement` directly,
  // as the document void's `applyStockReversal` does: a withdrawal has no document to run through the stock engine.
  const originals = await tx.select().from(transactions).where(inArray(transactions.id, openingIds));
  const nowIso = await businessNowIsoDateTime();
  await tx.update(transactions).set({ isDeleted: 1 }).where(inArray(transactions.id, openingIds));
  let withdrawn = 0;
  for (const orig of originals) {
    const warehouse = await ItemWarehouseStockService.resolveWarehouse(tx, orig.location ?? '');
    const quantity = Number(orig.quantity);
    await ItemWarehouseStockService.applyMovement(tx, { itemId, warehouse, inOut: 'out', quantity });
    await tx.insert(transactions).values({
      itemId,
      documentId: orig.documentId,
      type: 'out',
      quantity,
      unitPrice: money(orig.unitPrice),
      totalPrice: money(orig.totalPrice),
      date: nowIso,
      documentType: orig.documentType,
      documentRef: `REV-${orig.documentRef ?? ''}`,
      createdBy: performedBy || orig.createdBy,
      notes: `برگشت موجودی اول دوره با رد تعریف کالا (معکوس تراکنش #${orig.id})`,
      location: warehouse.code,
      reversalOfId: orig.id,
      isDeleted: 0,
    });
    withdrawn += quantity;
  }
  await tx.update(items).set({ version: nextVersion(item.version) }).where(eq(items.id, itemId));
  return withdrawn;
}

