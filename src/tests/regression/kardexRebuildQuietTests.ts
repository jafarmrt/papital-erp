import { and, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { activityLogs, items, itemWarehouseStocks, outboxEvents } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-491 / B06-12: rebuilding an item whose warehouse stock already matches its Kardex
 * writes no version bump, no outbox event and no audit row; only an item whose stock really changes gets them. On
 * v9.0.77 every rebuilt item got all three on every run (30 items -> 30 events and 31 audit rows, again on a run with
 * nothing to change).
 */
export async function runKardexRebuildQuietTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_kardex_rebuild_quiet_td_491';
  if (!shouldRun(id, 'td491', 'rebuild', 'kardex', 'inventory', 'package6')) return results;

  const name = 'v9.0.78: the Kardex rebuild writes version, outbox event and audit row only for items whose stock changed (TD-491)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  try {
    const { createTestItem } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { KardexWacRecalculatorService } = await import('../../services/inventory/kardexWacRecalculator.service.js');

    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    for (let i = 0; i < 3; i++) {
      const it = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      itemIds.push(it.id);
      await DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td491', buyerName: 'td491',
        location: main, items: [{ itemId: it.id, quantity: 5 + i, unit_price: 100, location: main }],
      });
    }

    const snapshot = async () => {
      const ids = itemIds.map(String);
      const [ev] = await orm.select({ n: sql<number>`count(*)::int` }).from(outboxEvents)
        .where(and(eq(outboxEvents.aggregateType, 'Item'), inArray(outboxEvents.aggregateId, ids), eq(outboxEvents.eventType, 'StockAdjusted')));
      const [au] = await orm.select({ n: sql<number>`count(*)::int` }).from(activityLogs)
        .where(and(eq(activityLogs.entity, 'کالا'), inArray(activityLogs.entityId, ids), eq(activityLogs.action, 'AUDIT_APPLY')));
      const versions = await orm.select({ id: items.id, v: items.version }).from(items).where(inArray(items.id, itemIds));
      return { events: ev?.n ?? 0, audits: au?.n ?? 0, versions: Object.fromEntries(versions.map(r => [r.id, Number(r.v)])) as Record<number, number> };
    };

    const wrong: string[] = [];
    const before = await snapshot();
    for (const itemId of itemIds) {
      const res = await KardexWacRecalculatorService.rebuildItemFromLedger(itemId, { user: 'td491' });
      if (res.changed !== false) wrong.push(`item ${itemId} with matching stock reported changed=${res.changed}`);
    }
    const quiet = await snapshot();
    if (quiet.events !== before.events || quiet.audits !== before.audits) {
      wrong.push(`unchanged rebuild wrote ${quiet.events - before.events} events and ${quiet.audits - before.audits} audit rows`);
    }
    for (const itemId of itemIds) {
      if (quiet.versions[itemId] !== before.versions[itemId]) wrong.push(`unchanged item ${itemId} version ${before.versions[itemId]} -> ${quiet.versions[itemId]}`);
    }

    // one item whose stock table drifted from the Kardex: only it gets the version, event and audit row
    const drifted = itemIds[1];
    await orm.update(itemWarehouseStocks).set({ currentStock: 99 }).where(eq(itemWarehouseStocks.itemId, drifted));
    for (const itemId of itemIds) await KardexWacRecalculatorService.rebuildItemFromLedger(itemId, { user: 'td491' });
    const after = await snapshot();
    if (after.events !== quiet.events + 1 || after.audits !== quiet.audits + 1) {
      wrong.push(`one drifted item gave ${after.events - quiet.events} events and ${after.audits - quiet.audits} audit rows, expected 1 and 1`);
    }
    for (const itemId of itemIds) {
      const bumped = after.versions[itemId] !== quiet.versions[itemId];
      if (bumped !== (itemId === drifted)) wrong.push(`item ${itemId} version bumped=${bumped}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: '3 matching items: no event, audit row or version bump; 1 drifted item: exactly 1 event, 1 audit row and its own version bump',
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
