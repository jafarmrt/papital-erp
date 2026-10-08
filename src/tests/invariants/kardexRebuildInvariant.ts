import { fin, FinancialDecimal } from '../../lib/financialDecimal.js';
import { createLedgerLocationResolver } from '../../services/inventory/warehouseResolver.js';
import { replayKardexWac, wacDiffersFromReplay } from '../../services/inventory/kardexReplay.js';
import type { InvariantScope, InvariantViolation } from './businessInvariants.js';
import { QTY_TOLERANCE, rows } from './ledgerRows.js';

/** Parts of the I13 message that the known-findings classifier and the void probe read */
export const I13_NEGATIVE_HISTORY = 'has a negative balance in date order in one warehouse';
export const I13_VOIDED_INCOMING = 'because a consumed incoming row was voided';

interface KardexAllRow extends Record<string, unknown> {
  id: number;
  item_id: number;
  type: string;
  quantity: string;
  unit_price: string;
  document_type: string | null;
  document_ref: string | null;
  reversal_of_id: number | null;
  is_deleted: number;
  location: string | null;
  day: string;
}

const isIn = (t: KardexAllRow) => t.type === 'in' || t.type === 'transfer_in';
const isOut = (t: KardexAllRow) => t.type === 'out' || t.type === 'transfer_out';

/** کالاهایی که مانده یکی از انبارهایشان به ترتیب (روز، شناسه) منفی می‌شود */
function negativeInDateOrder(list: KardexAllRow[], resolve: (raw: unknown) => { id: number } | null): Set<number> {
  const sorted = [...list].sort((a, b) => (a.day === b.day ? a.id - b.id : a.day < b.day ? -1 : 1));
  const balances = new Map<string, FinancialDecimal>();
  const negative = new Set<number>();
  for (const t of sorted) {
    const wh = resolve(t.location);
    const key = `${t.item_id}:${wh ? wh.id : `?${t.location ?? ''}`}`;
    const signed = isIn(t) ? fin(t.quantity) : isOut(t) ? fin(t.quantity).negate() : fin(0);
    const balance = (balances.get(key) ?? fin(0)).add(signed);
    balances.set(key, balance);
    if (balance.lessThan(fin(QTY_TOLERANCE).negate())) negative.add(t.item_id);
  }
  return negative;
}

/**
 * I13: بازسازی کاردکس باید همان WAC زنده را بدهد و کاردکس به ترتیب تاریخ در هیچ انباری منفی نشود.
 * v8.0.4 (TD-258): WAC با `replayKardexWac` (همان تابع KardexWacRecalculatorService.rebuildItemFromLedger، به ترتیب ثبت)
 * بازپخش می‌شود. v8.0.4 (TD-257): مانده هر انبار در دفتر کاردکس (§12) به ترتیب (روز، شناسه) نامنفی است — همان کنترل
 * موجودی تا تاریخ. اگر مانده منفی فقط به‌خاطر ابطال یک ورودیِ مصرف‌شده باشد (با برگرداندن ورودی‌های ابطال‌شده رفع شود)،
 * علت جدا گزارش می‌شود (TD-265).
 */
export async function checkKardexRebuildWac(scope: InvariantScope): Promise<InvariantViolation[]> {
  if (scope.itemIds.length === 0) return [];
  const live = await rows<{ id: number; wac: string; current_stock: string }>(
    `SELECT id, COALESCE(weighted_average_cost, 0)::text AS wac, COALESCE(current_stock, 0)::text AS current_stock
       FROM items WHERE id = ANY($1::int[])`,
    [scope.itemIds]
  );
  const all = await rows<KardexAllRow>(
    `SELECT id, item_id, type, quantity::text AS quantity, COALESCE(unit_price, 0)::text AS unit_price,
            document_type, document_ref, reversal_of_id, COALESCE(is_deleted, 0) AS is_deleted, location,
            to_char(date, 'YYYY-MM-DD') AS day
       FROM transactions WHERE item_id = ANY($1::int[]) ORDER BY id`,
    [scope.itemIds]
  );
  const rowsByItem = new Map<number, KardexAllRow[]>();
  for (const t of all) {
    const list = rowsByItem.get(t.item_id) ?? [];
    list.push(t);
    rowsByItem.set(t.item_id, list);
  }
  const resolve = createLedgerLocationResolver(await rows<{ id: number; code: string; name: string; is_active: number }>(
    'SELECT id, code, name, is_active FROM warehouses').then(ws => ws.map(w => ({ id: w.id, code: w.code, name: w.name, isActive: w.is_active }))));

  const deletedIds = new Set(all.filter(t => t.is_deleted === 1).map(t => t.id));
  const activelyReversed = new Set(all.filter(t => t.is_deleted === 0 && t.reversal_of_id !== null).map(t => t.reversal_of_id as number));
  const ledger = all.filter(t => t.is_deleted === 0 && !(t.reversal_of_id !== null && deletedIds.has(t.reversal_of_id)));
  const voidedIncoming = all.filter(t => t.is_deleted === 1 && isIn(t) && activelyReversed.has(t.id));
  const negative = negativeInDateOrder(ledger, resolve);
  const negativeEvenWithVoidedIncoming = negativeInDateOrder([...ledger, ...voidedIncoming], resolve);

  const violations: InvariantViolation[] = [];
  for (const it of live) {
    const replay = replayKardexWac((rowsByItem.get(it.id) ?? []).map(t => ({
      id: t.id, type: t.type, quantity: t.quantity, unitPrice: t.unit_price, documentType: t.document_type,
      documentRef: t.document_ref, reversalOfId: t.reversal_of_id, isDeleted: t.is_deleted,
    })), it.wac);
    const liveWac = fin(it.wac);
    if (negative.has(it.id)) {
      const byVoid = !negativeEvenWithVoidedIncoming.has(it.id);
      violations.push({
        invariant: 'I13_kardex_rebuild_wac',
        key: `item:${it.id}`,
        message: byVoid
          ? `Kardex of item ${it.id} ${I13_NEGATIVE_HISTORY}, ${I13_VOIDED_INCOMING}`
          : `Kardex of item ${it.id} ${I13_NEGATIVE_HISTORY}`,
        expected: 'non-negative balance in date order',
        actual: 'negative balance',
      });
    } else if (wacDiffersFromReplay(liveWac, replay.wac, it.current_stock)) {
      violations.push({
        invariant: 'I13_kardex_rebuild_wac',
        key: `item:${it.id}`,
        message: `Kardex rebuild changes the WAC of item ${it.id}`,
        expected: liveWac.toString(),
        actual: replay.wac.round(4).toString(),
      });
    }
  }
  return violations;
}
