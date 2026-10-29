import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { ConflictError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { logActivity } from '../../lib/auditLogger.js';
import type { OldOpeningItem, OldOpeningList, OldOpeningWithdrawResult } from '../../lib/historyImport/oldOpening.js';
import { isoToJalaliDate, toPersianDigits } from '../../utils.js';
import { FiscalPeriodService } from '../accounting/fiscalPeriod.service.js';
import { ItemOpeningService } from './itemOpening.service.js';
import { OPENING_KARDEX_ROW } from './itemOpeningValue.js';
import { reverseOpeningRows } from './itemOpeningWithdraw.js';
import { lockStockItems } from './stockItemLocks.js';
import { LEDGER_ROW_FILTER } from './stockMovementDate.js';

/**
 * v11 history import, tool 8 (1405 replay, decision of the owner 6 Aban 1405): before the warehouse rows of 1405 are entered
 * again from 1 Farvardin, the opening stock entered earlier through the item form (Kardex rows «ثبت اولیه کالا», dated the
 * day the item was defined, with a draft opening voucher) is taken back. Otherwise every replayed movement dated before
 * that day is refused (a movement never before the item's last movement), and the replay's own opening is refused too (the
 * item already has an opening voucher).
 *
 * Only an opening nothing else rests on is taken back: no other live Kardex row or document line of the item, every live
 * opening voucher of the item still a draft, no opening row in a closed fiscal year, and every other item of a shared
 * (Excel import) voucher taken back with it. The opening rows are soft-deleted with a reversal row on their own day (as a
 * rejected item definition takes back its opening), the warehouse stock goes back down, and the draft voucher is
 * soft-deleted. Afterwards the item has no movement and no opening voucher, so the replay's opening row is accepted.
 */

interface OpeningRow extends Record<string, unknown> {
  itemId: number;
  code: string;
  name: string;
  unit: string | null;
  quantity: string;
  value: string;
  day: string;
  lastDay: string;
  moved: boolean;
  onDocument: boolean;
  inWorkflow: boolean;
  vouchers: Array<{ id: number; number: string | number; status: string }> | null;
}

const faDate = (iso: string) => toPersianDigits(isoToJalaliDate(iso));

/**
 * The old openings only: the replay's own opening rows (written by the stock import on 1 Farvardin with these notes) are
 * the data the replay entered, not an old opening, so this step never lists or takes them back.
 */
export const REPLAY_OPENING_NOTES = 'موجودی اولیه از ورود سابقه اکسل';
const OLD_OPENING_ROW = sql`(${OPENING_KARDEX_ROW} AND t.notes IS DISTINCT FROM ${REPLAY_OPENING_NOTES})`;

async function openingRows(tx: DbExecutor, itemIds?: number[]): Promise<OpeningRow[]> {
  const only = itemIds ? sql`AND t.item_id IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})` : sql``;
  const res = await tx.execute(sql`
    WITH op AS (
      SELECT t.item_id, SUM(t.quantity) AS quantity, SUM(t.quantity * t.unit_price) AS value,
             to_char(MIN(t.date), 'YYYY-MM-DD') AS day, to_char(MAX(t.date), 'YYYY-MM-DD') AS last_day
        FROM transactions t
       WHERE ${OLD_OPENING_ROW} ${only}
       GROUP BY t.item_id
    )
    SELECT op.item_id AS "itemId", i.code, i.name, i.unit, op.quantity::text AS quantity, round(op.value, 4)::text AS value,
           op.day, op.last_day AS "lastDay",
           EXISTS (SELECT 1 FROM transactions t
                    WHERE t.item_id = op.item_id AND ${LEDGER_ROW_FILTER} AND NOT ${OLD_OPENING_ROW}) AS moved,
           EXISTS (SELECT 1 FROM document_items di WHERE di.item_id = op.item_id AND di.is_deleted = 0) AS "onDocument",
           EXISTS (SELECT 1 FROM workflow_instances w
                    WHERE w.entity_type = 'item' AND w.entity_id = op.item_id::text AND w.status = 'IN_PROGRESS') AS "inWorkflow",
           (SELECT json_agg(json_build_object('id', jv.id, 'number', jv.voucher_number, 'status', jv.status) ORDER BY jv.id)
              FROM item_opening_voucher_items l
              JOIN journal_vouchers jv ON jv.id = l.voucher_id AND jv.is_deleted = 0
             WHERE l.item_id = op.item_id) AS vouchers
      FROM op
      JOIN items i ON i.id = op.item_id AND i.is_deleted = 0
     ORDER BY i.code, op.item_id`);
  return (res.rows ?? []) as OpeningRow[];
}

/** The items of each live opening voucher (an Excel import's voucher holds several). */
async function voucherItems(tx: DbExecutor, voucherIds: number[]): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (voucherIds.length === 0) return result;
  const res = await tx.execute(sql`
    SELECT l.voucher_id AS "voucherId", l.item_id AS "itemId" FROM item_opening_voucher_items l
     WHERE l.voucher_id IN (${sql.join(voucherIds.map(id => sql`${id}`), sql`, `)})`);
  for (const r of (res.rows ?? []) as Array<{ voucherId: number; itemId: number }>) {
    result.set(Number(r.voucherId), [...(result.get(Number(r.voucherId)) ?? []), Number(r.itemId)]);
  }
  return result;
}

async function classify(tx: DbExecutor, rows: OpeningRow[]): Promise<OldOpeningItem[]> {
  const list: OldOpeningItem[] = [];
  for (const r of rows) {
    const vouchers = (r.vouchers ?? []).map(v => ({ id: Number(v.id), number: String(v.number), status: String(v.status) }));
    const item: OldOpeningItem = {
      itemId: Number(r.itemId), code: r.code, name: r.name, unit: r.unit ?? '',
      quantity: fin(r.quantity).toString(), value: fin(r.value).toString(), day: r.day, vouchers, withdrawable: true,
    };
    const refuse = (reason: string) => { item.withdrawable = false; item.reason = reason; };
    if (r.moved || r.onDocument) refuse('این کالا گردش یا سند دیگری هم دارد؛ موجودی اولیه‌اش برداشته نمی‌شود.');
    // an opening without a voucher (a zero cost, a voucher deleted by hand) is taken back too, unless the item's definition
    // still waits in its workflow: its approval issues the voucher, its rejection takes the opening back
    else if (vouchers.length === 0 && r.inWorkflow) refuse('تعریف این کالا هنوز در گردش کار است؛ اول آن را تأیید یا رد کنید.');
    else if (vouchers.some(v => v.status !== 'draft')) refuse(`سند افتتاحیهٔ ${toPersianDigits(vouchers.filter(v => v.status !== 'draft').map(v => v.number).join('، '))} تأیید شده است؛ اول آن را به پیش‌نویس برگردانید.`);
    else if (await FiscalPeriodService.isClosedShared(r.day, tx) || await FiscalPeriodService.isClosedShared(r.lastDay, tx)) refuse(`موجودی اولیهٔ این کالا (${faDate(r.day)}) در سال مالی بسته است.`);
    list.push(item);
  }
  // a voucher shared with an item that stays keeps all its items: the voucher is deleted whole or not at all
  const byId = new Map(list.map(i => [i.itemId, i]));
  const shared = await voucherItems(tx, [...new Set(list.flatMap(i => i.vouchers.map(v => v.id)))]);
  for (let changed = true; changed;) {
    changed = false;
    for (const [voucherId, ids] of shared) {
      const blocker = ids.map(id => byId.get(id)).find(i => i !== undefined && !i.withdrawable);
      const missing = ids.filter(id => !byId.has(id));
      if (!blocker && missing.length === 0) continue;
      for (const id of ids) {
        const i = byId.get(id);
        if (i?.withdrawable) {
          i.withdrawable = false;
          const number = toPersianDigits(i.vouchers.find(v => v.id === voucherId)?.number ?? String(voucherId));
          i.reason = blocker
            ? `سند افتتاحیهٔ ${number} کالای «${blocker.name}» را هم دارد که موجودی‌اش برداشته نمی‌شود.`
            : `سند افتتاحیهٔ ${number} ${toPersianDigits(String(missing.length))} کالای دیگر هم دارد که انتخاب نشده‌اند؛ همهٔ کالاهای یک سند با هم برداشته می‌شوند.`;
          changed = true;
        }
      }
    }
  }
  return list;
}

/** Every item with a live opening on the Kardex, and whether its opening can be taken back before the replay. */
export async function listOldOpenings(tx: DbExecutor): Promise<OldOpeningList> {
  return { items: await classify(tx, await openingRows(tx)) };
}

/**
 * Takes back the opening of the chosen items, all or nothing: an item that cannot be taken back, or a voucher shared
 * with an item not chosen, refuses the whole request (409 `OLD_OPENING_NOT_WITHDRAWABLE`).
 */
export async function withdrawOldOpenings(
  tx: DbExecutor,
  itemIds: number[],
  actor: { userId?: number; username?: string; userFullName?: string; req?: unknown },
): Promise<OldOpeningWithdrawResult> {
  const ids = [...new Set(itemIds)].sort((a, b) => a - b);
  await lockStockItems(tx, ids);
  const list = await classify(tx, await openingRows(tx, ids));
  const found = new Map(list.map(i => [i.itemId, i]));
  const problems: string[] = [];
  for (const id of ids) {
    const item = found.get(id);
    if (!item) problems.push(`کالای ${toPersianDigits(String(id))} موجودی اولیهٔ فعالی ندارد.`);
    else if (!item.withdrawable) problems.push(`${item.name} (${item.code}): ${item.reason}`);
  }
  // `classify` saw only the chosen items, so a voucher with an item not chosen has already refused its items above
  if (problems.length > 0) {
    throw new ConflictError(`موجودی اولیهٔ هیچ کالایی برداشته نشد:\n${problems.slice(0, 20).join('\n')}`, { problems }, 'OLD_OPENING_NOT_WITHDRAWABLE');
  }

  const voucherIds = [...new Set(list.flatMap(i => i.vouchers.map(v => v.id)))].sort((a, b) => a - b);
  for (const voucherId of voucherIds) await ItemOpeningService.deleteDraftOpeningVoucher(tx, voucherId, actor);
  for (const item of list) {
    const opening = await tx.execute(sql`SELECT t.id FROM transactions t WHERE t.item_id = ${item.itemId} AND ${OLD_OPENING_ROW} ORDER BY t.id`);
    const openingIds = ((opening.rows ?? []) as Array<{ id: number }>).map(r => Number(r.id));
    const quantity = await reverseOpeningRows(tx, item.itemId, openingIds, {
      performedByUserId: actor.userId,
      notes: id => `برداشتن موجودی اولیهٔ قبلی پیش از ورود سابقه اکسل (معکوس تراکنش #${id})`,
      date: 'sameDay',
    });
    await logActivity({
      tx,
      req: actor.req,
      userId: actor.userId,
      username: actor.username,
      userFullName: actor.userFullName,
      action: 'UPDATE',
      entity: 'کالا',
      entityId: String(item.itemId),
      description: `برداشتن موجودی اولیهٔ قبلی کالای «${item.name}» (${item.code})، ${quantity} واحد از ${faDate(item.day)}، پیش از ورود سابقه اکسل${item.vouchers.length > 0 ? `؛ سند افتتاحیهٔ پیش‌نویس ${item.vouchers.map(v => v.number).join('، ')} حذف شد` : ''}`,
      details: { quantity: item.quantity, value: item.value, day: item.day, vouchers: item.vouchers.map(v => v.id) },
    });
  }
  return { items: list.length, vouchers: voucherIds.length };
}
