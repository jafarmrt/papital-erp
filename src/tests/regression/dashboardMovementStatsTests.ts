import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';

/**
 * Package 16 (dashboard and shell), TD-671 / B16-07: the warehouse dashboard counts the Kardex ledger (AGENTS §12).
 * «recent documents» counts documents, not Kardex rows, and leaves out voided documents and their reversals; «fast
 * moving» never lists the reversal of a voided receipt; a warehouse transfer is not an outflow, so it never takes an item
 * out of «dead stock». On v9.0.278 three documents with five rows counted 5 (and 5 again after one was voided), a voided
 * receipt of 99,999,999 units topped «fast moving», and a transfer removed an untouched item from «dead stock».
 */
export async function runDashboardMovementStatsTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_dashboard_movement_stats_td_671';
  if (!shouldRun(id, 'td671', 'b16-07', 'dashboard', 'package16')) return results;

  const name = 'v9.0.279: dashboard counts documents and real outflows of the ledger, without voids or transfers (TD-671)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  try {
    const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { InventoryStockRepairService } = await import('../../services/inventory/inventoryStockRepair.service.js');
    const { recentDocumentCount, dashboardMovementRows, movementWindowStart } = await import('../../services/inventory/dashboardMovementStats.js');

    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const wh2 = await createTestWarehouse();
    const newItem = async () => {
      const it = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
      itemIds.push(it.id);
      return it;
    };
    const [a, b, v, d] = [await newItem(), await newItem(), await newItem(), await newItem()];

    const receipt = (date: string, lines: Array<{ itemId: number; quantity: number }>) => DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date, user: 'td671', buyerName: 'td671', location: main,
      items: lines.map(l => ({ ...l, unit_price: 1, location: main })),
    });

    const before = await recentDocumentCount(7, today);
    await receipt(today, [{ itemId: a.id, quantity: 10 }]);
    await receipt(today, [{ itemId: a.id, quantity: 5 }, { itemId: b.id, quantity: 5 }]);
    const voidedPair = await receipt(today, [{ itemId: a.id, quantity: 1 }, { itemId: b.id, quantity: 1 }]);
    await DocumentService.deleteDocument(voidedPair, 'td671');
    const voidedHuge = await receipt(today, [{ itemId: v.id, quantity: 99_999_999 }]);
    await DocumentService.deleteDocument(voidedHuge, 'td671');
    // an untouched item: received 90 days ago, then only moved between warehouses today
    await receipt(movementWindowStart(today, 91), [{ itemId: d.id, quantity: 99_999_999 }]);
    await InventoryStockRepairService.executeWarehouseTransfer({ itemId: d.id, fromLocation: main, toLocation: wh2.code, quantity: 3, date: today, user: 'td671' });
    const after = await recentDocumentCount(7, today);

    const rows = await dashboardMovementRows({ fastDays: 30, slowDays: 45, deadDays: 60 }, today);
    const ids = (list: Record<string, unknown>[]) => list.map(r => Number(r.id));

    const wrong: string[] = [];
    // two live receipts and the transfer document; the voided receipts and the 90-day-old receipt do not count
    if (after - before !== 3) wrong.push(`recent documents rose by ${after - before}, expected 3`);
    if (ids(rows.fastMoving).includes(v.id)) wrong.push('the reversal of a voided receipt is listed as fast moving');
    if (!ids(rows.deadStock).includes(d.id)) wrong.push('a warehouse transfer took an untouched item out of dead stock');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `recent documents +${after - before}; voided receipt not fast moving; transferred item still dead stock`,
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
