import { inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, transactions } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * Package 6 (inventory and Kardex), TD-492 / B06-13: the «گردش کالا» chart counts the Kardex ledger (AGENTS §12): no
 * warehouse transfer (nothing entered or left the business), no voided document or its reversal, and nothing dated
 * after the current Jalali month. On v9.0.93 a transfer of 4 raised both in and out by 4, a voided receipt still counted
 * and a 2099 row brought month 1477/10 into the chart.
 */
export async function runMovementTrendLedgerTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_movement_trend_ledger_td_492';
  if (!shouldRun(id, 'td492', 'trend', 'chart', 'inventory', 'package6')) return results;

  const name = 'v9.0.94: the stock movement chart counts only ledger in/out rows of the window, without transfers, voids or future rows (TD-492)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const futureRowIds: number[] = [];
  try {
    const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { InventoryStockRepairService } = await import('../../services/inventory/inventoryStockRepair.service.js');
    const { getMonthlyMovementTrends } = await import('../../services/inventory/monthlyMovementTrend.js');
    const { isoToJalaliDate } = await import('../../utils/calendarDate.js');

    const today = await businessTodayIsoDate();
    const month = isoToJalaliDate(today).slice(0, 7);
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const wh2 = await createTestWarehouse();
    const a = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    itemIds.push(a.id);

    const totals = async () => {
      const trends = await getMonthlyMovementTrends();
      const of = (type: 'in' | 'out') => trends.find(t => t.month === month && t.type === type)?.total ?? 0;
      return { in: of('in'), out: of('out'), months: [...new Set(trends.map(t => t.month))] };
    };
    const before = await totals();

    const receipt = (quantity: number) => DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td492', buyerName: 'td492',
      location: main, items: [{ itemId: a.id, quantity, unit_price: 100, location: main }],
    });
    await receipt(10);
    const voided = await receipt(2);
    await InventoryStockRepairService.executeWarehouseTransfer({ itemId: a.id, fromLocation: main, toLocation: wh2.code, quantity: 4, date: today, user: 'td492' });
    await DocumentService.createDocument({
      docType: 'remittance', status: 'final', inOut: 'out', date: today, user: 'td492', buyerName: 'td492',
      location: main, items: [{ itemId: a.id, quantity: 3, unit_price: 0, location: main }],
    });
    await DocumentService.deleteDocument(voided, 'td492');
    // a legacy future-dated row (B06-04), recorded before TD-483 refused it
    const [future] = await orm.insert(transactions).values({
      itemId: a.id, type: 'in', quantity: 1, unitPrice: money(100), date: '2099-01-01', documentType: 'audit', documentRef: 'td492 future', location: main, isDeleted: 0,
    }).returning({ id: transactions.id });
    futureRowIds.push(future.id);

    const after = await totals();
    const wrong: string[] = [];
    const dIn = Math.round((after.in - before.in) * 10000) / 10000;
    const dOut = Math.round((after.out - before.out) * 10000) / 10000;
    if (dIn !== 10) wrong.push(`month ${month} in rose by ${dIn}, expected 10 (the receipt only; no transfer, no voided receipt)`);
    if (dOut !== 3) wrong.push(`month ${month} out rose by ${dOut}, expected 3 (the remittance only; no transfer, no void reversal)`);
    const late = after.months.filter(m => m > month);
    if (late.length > 0) wrong.push(`months after the current month in the chart: ${late.join(', ')}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `in +${dIn}, out +${dOut} in ${month}; no month after it`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (futureRowIds.length > 0) await orm.update(transactions).set({ isDeleted: 1 }).where(inArray(transactions.id, futureRowIds)).catch(() => undefined);
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
