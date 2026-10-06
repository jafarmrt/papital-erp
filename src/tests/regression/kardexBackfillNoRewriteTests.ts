import { asc, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, transactions } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-488 / B06-09 (decision t3): the initial Kardex backfill only adds rows for items
 * with stock and no incoming Kardex row; it never reprices its own earlier rows. On v9.0.91 a second run repriced the
 * row it had written at 0 with the WAC of that day, so the Kardex replay no longer reached the live WAC (I13).
 */
export async function runKardexBackfillNoRewriteTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_kardex_backfill_no_rewrite_td_488';
  if (!shouldRun(id, 'td488', 'backfill', 'kardex', 'inventory', 'package6')) return results;

  const name = 'v9.0.92: the initial Kardex backfill never reprices its earlier rows, so the replay keeps the live WAC (TD-488)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  try {
    const { createTestItem } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { KardexBackfillService, KARDEX_BACKFILL_REF } = await import('../../services/inventory/kardexBackfill.service.js');
    const { replayKardexWac, wacDiffersFromReplay } = await import('../../services/inventory/kardexReplay.js');

    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    // legacy data: 5 in stock, no WAC and no Kardex row
    const a = await createTestItem({ type: 'raw_material', stocks: { [main]: 5 }, weightedAverageCost: 0 });
    itemIds.push(a.id);

    const wrong: string[] = [];

    const first = await KardexBackfillService.syncMissingInitialTransactions();
    const [row] = await orm.select({ id: transactions.id, unitPrice: transactions.unitPrice, ref: transactions.documentRef })
      .from(transactions).where(eq(transactions.itemId, a.id));
    if (!row || row.ref !== KARDEX_BACKFILL_REF || Number(row.unitPrice) !== 0) wrong.push(`first run row ${JSON.stringify(row)}`);
    if (first.zeroWacItems < 1) wrong.push(`first run zeroWacItems ${first.zeroWacItems}`);

    // a receipt 10 x 100 moves the live WAC to (5 x 0 + 10 x 100) / 15 = 66.6667
    await DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td488', buyerName: 'td488',
      location: main, items: [{ itemId: a.id, quantity: 10, unit_price: 100, location: main }],
    });
    const liveWac = Number((await orm.select({ w: items.weightedAverageCost }).from(items).where(eq(items.id, a.id)))[0]?.w);

    const second = await KardexBackfillService.syncMissingInitialTransactions();
    if ('repairedRows' in second) wrong.push(`second run still reports repairedRows ${JSON.stringify(second)}`);
    const [after] = row ? await orm.select({ unitPrice: transactions.unitPrice }).from(transactions).where(eq(transactions.id, row.id)) : [];
    if (Number(after?.unitPrice) !== 0) wrong.push(`second run repriced the backfill row to ${after?.unitPrice}`);

    const rows = await orm.select({
      id: transactions.id, type: transactions.type, quantity: transactions.quantity, unitPrice: transactions.unitPrice,
      documentType: transactions.documentType, documentRef: transactions.documentRef, reversalOfId: transactions.reversalOfId, isDeleted: transactions.isDeleted,
    }).from(transactions).where(eq(transactions.itemId, a.id)).orderBy(asc(transactions.id));
    const replay = replayKardexWac(rows, liveWac);
    if (wacDiffersFromReplay(liveWac, replay.wac.round(4).toNumber(), 15)) wrong.push(`Kardex replay WAC ${replay.wac.toString()}, live WAC ${liveWac}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `backfill row kept at 0 after a second run; replay WAC ${replay.wac.round(4).toString()} = live WAC ${liveWac}`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
