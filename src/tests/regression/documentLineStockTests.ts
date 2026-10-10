import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';

/**
 * Phase 3 lane L4 (TD-1175, fresh-eyes guide finding B8 / roles-b R2 #4): the warehouse approval task window shows each
 * outgoing line's source warehouse with its stock and sellable quantity, read with the sellable gate's rule.
 */
type ShouldRun = (id: string, ...extra: string[]) => boolean;
type Tx = Parameters<Parameters<typeof orm.transaction>[0]>[0];

class Rollback extends Error {}

async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await orm.transaction(async (tx) => {
      out = await fn(tx);
      throw new Rollback('rollback');
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return out as T;
}

async function lineStockCase(): Promise<string> {
  const { createTestItem, createTestDocument } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const { documentLineStock } = await import('../../services/documents/documentSellableGate.js');
  return inRolledBackTx(async (tx) => {
    const today = await businessTodayIsoDate();
    const wh = await getDefaultWarehouseCode(tx) ?? '';
    const item = await createTestItem({ weightedAverageCost: 5000, currentStock: 5 }, tx);
    const line = (quantity: number) => [{ itemId: item.id, quantity, unitPrice: 9000, location: wh }];
    // another customer's proforma reserves 2
    await createTestDocument({ type: 'invoice', status: 'proforma', date: today }, line(2), tx);
    const { document: remittance } = await createTestDocument({ type: 'remittance', status: 'draft', date: today }, line(8), tx);
    const rows = await documentLineStock(tx, remittance.id);
    const row = rows.find(r => r.itemId === item.id);
    const wrong: string[] = [];
    if (!row) throw new Error(`no line stock for the item: ${JSON.stringify(rows)}`);
    if (row.location !== wh) wrong.push(`location ${row.location}, expected ${wh}`);
    if (!row.warehouseName) wrong.push('no warehouse name');
    if (row.requested !== 8) wrong.push(`requested ${row.requested}, expected 8`);
    if (row.locationStock !== 5) wrong.push(`locationStock ${row.locationStock}, expected 5`);
    if (row.reservedForOthers !== 2) wrong.push(`reservedForOthers ${row.reservedForOthers}, expected 2`);
    if (row.sellable !== 3) wrong.push(`sellable ${row.sellable}, expected 3`);
    // a proforma's own reservation is not counted against it
    const { document: own } = await createTestDocument({ type: 'invoice', status: 'proforma', date: today }, line(1), tx);
    const ownRow = (await documentLineStock(tx, own.id)).find(r => r.itemId === item.id);
    if (ownRow?.reservedForOthers !== 2) wrong.push(`own proforma reservedForOthers ${ownRow?.reservedForOthers}, expected 2`);
    // an incoming document has no outgoing line stock
    const { document: receipt } = await createTestDocument({ type: 'receipt', status: 'draft', date: today }, line(3), tx);
    if ((await documentLineStock(tx, receipt.id)).length !== 0) wrong.push('a receipt answered line stock');
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return 'remittance of 8 with stock 5 and 2 reserved by another proforma: sellable 3; own proforma excluded; receipt none';
  });
}

export async function runDocumentLineStockTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_document_line_stock_td_1175';
  if (!shouldRun(id, 'td1175', 'documents', 'workflow', 'package14')) return results;
  const name = 'v10.0.151: an outgoing document answers each line\'s source warehouse, its stock, the reservations of others and the sellable quantity (TD-1175)';
  const tStart = Date.now();
  try {
    const details = await lineStockCase();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart, error: err instanceof Error ? err.message : String(err) }));
  }
  return results;
}
