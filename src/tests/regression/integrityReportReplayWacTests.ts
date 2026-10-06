import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * Package 6 (inventory and Kardex), TD-486 / B06-07: the «inventory health and reconciliation» report compares the
 * live WAC with the same Kardex replay the rebuild and invariant I13 use. On v9.0.81 it compared with the average of
 * every incoming row ever recorded, so receipt 10 x 100, sale 10, receipt 10 x 200 (correct WAC 200) was reported as
 * "recorded 200 differs from computed 150" and no rebuild could clear it.
 */
export async function runIntegrityReportReplayWacTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_integrity_report_replay_wac_td_486';
  if (!shouldRun(id, 'td486', 'integrity', 'wac', 'inventory', 'package6')) return results;

  const name = 'v9.0.82: the inventory integrity report checks WAC against the Kardex replay, not the average of all receipts (TD-486)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  try {
    const { createTestItem } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { StockReconciliationService } = await import('../../services/inventory/stockReconciliation.service.js');

    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const a = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
    itemIds.push(a.id);
    const move = (docType: 'receipt' | 'remittance', quantity: number, price: number) => DocumentService.createDocument({
      docType, status: 'final', inOut: docType === 'receipt' ? 'in' : 'out', date: today, user: 'td486', buyerName: 'td486',
      location: main, items: [{ itemId: a.id, quantity, unit_price: price, location: main }],
    });
    await move('receipt', 10, 100);
    await move('remittance', 10, 0);
    await move('receipt', 10, 200);

    const wrong: string[] = [];
    const auditOf = async () => (await StockReconciliationService.getIntegrityReport({ search: a.code })).audits.find(r => r.itemId === a.id);
    const healthy = await auditOf();
    if (!healthy) throw new Error('item missing from the integrity report');
    if (healthy.recordedWac !== 200 || healthy.computedWac !== 200 || healthy.discrepancies.includes('kardex_wac_mismatch')) {
      wrong.push(`correct WAC reported as recorded ${healthy.recordedWac} computed ${healthy.computedWac} ${JSON.stringify(healthy.discrepancies)}`);
    }

    // a WAC that really differs from the replay is still reported
    await orm.update(items).set({ weightedAverageCost: money(250) }).where(eq(items.id, a.id));
    const broken = await auditOf();
    if (!broken?.discrepancies.includes('kardex_wac_mismatch') || broken.computedWac !== 200) {
      wrong.push(`WAC 250 against replay 200 reported as ${JSON.stringify(broken ? { c: broken.computedWac, d: broken.discrepancies } : null)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'receipt 10x100, sale 10, receipt 10x200: WAC 200 healthy; WAC forced to 250 reported against replay 200',
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
