import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, transactions } from '../../db/schema.js';
import { money } from '../../lib/money.js';

/**
 * Package 6 (inventory and Kardex), TD-483 / B06-04 (decision t1): no stock movement may be dated after the business
 * today (transfers and stock documents alike), a transfer date is normalized with requireStorageDate (Jalali accepted,
 * text refused with 422 instead of a database 500), and existing future-dated Kardex rows are listed by the financial
 * health check without being rewritten. On v9.0.56 a transfer dated 2099-01-01 was accepted and blocked every later
 * movement of the item.
 */

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function runStockMovementFutureDateTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_stock_movement_future_date_td_483';
  if (!shouldRun(id, 'td483', 'transfer', 'future', 'inventory', 'package6')) return results;

  const name = 'v9.0.66: a stock movement dated after today is refused, a transfer date is normalized, and future Kardex rows are listed by the health check (TD-483)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  const txIds: number[] = [];
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestItem, createTestWarehouse } = await import('../fixtures/factories.js');
    const { ItemWarehouseStockService } = await import('../../services/inventory/itemWarehouseStock.service.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { isoToJalaliDate } = await import('../../utils/calendarDate.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { findFutureStockMovements } = await import('../../services/inventory/futureStockMovements.js');
    const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');

    const app = await getTestApp();
    const admin = await getAdminSession();
    const today = await businessTodayIsoDate();
    const tomorrow = addDays(today, 1);
    const code = (await getDefaultWarehouseCode(orm)) as string;
    const wh2 = await createTestWarehouse();
    const a = await createTestItem({ type: 'raw_material', stocks: { [code]: 10 }, weightedAverageCost: 1000 });
    itemIds.push(a.id);

    const wrong: string[] = [];
    const stockOf = async (whCode: string) => (await ItemWarehouseStockService.getStocksForItems(orm, [a.id])).get(a.id)?.byCode[whCode] ?? 0;
    const transfer = (date: string | undefined) => request(app)
      .post('/api/inventory/transfer')
      .set('Cookie', admin.cookie).set('x-csrf-token', admin.csrfToken)
      .send({ itemId: a.id, fromLocation: code, toLocation: wh2.code, quantity: 1, ...(date === undefined ? {} : { date }) });

    // future transfer (admin included): 422 with its own code, nothing moves
    for (const date of ['2099-01-01', tomorrow]) {
      const res = await transfer(date);
      if (res.status !== 422 || res.body?.details?.code !== 'STOCK_MOVEMENT_FUTURE_DATE') {
        wrong.push(`transfer dated ${date} answered ${res.status} ${res.body?.details?.code ?? res.body?.code}, expected 422 STOCK_MOVEMENT_FUTURE_DATE`);
      }
    }
    if ((await stockOf(code)) !== 10 || (await stockOf(wh2.code)) !== 0) wrong.push(`stock moved after a refused future transfer`);

    // text is 422 (was a database 500)
    const text = await transfer('not-a-date');
    if (text.status !== 422) wrong.push(`transfer dated "not-a-date" answered ${text.status}, expected 422`);

    // a Jalali date is accepted and stored as Gregorian ISO
    const jalali = await transfer(isoToJalaliDate(today));
    if (jalali.status !== 200) wrong.push(`transfer dated ${isoToJalaliDate(today)} answered ${jalali.status}: ${JSON.stringify(jalali.body).slice(0, 200)}`);
    const rows = await orm.select({ id: transactions.id, date: transactions.date }).from(transactions)
      .where(and(eq(transactions.itemId, a.id), eq(transactions.documentType, 'transfer'), eq(transactions.isDeleted, 0)));
    if (rows.length !== 2 || rows.some(r => String(r.date).slice(0, 10) !== today)) {
      wrong.push(`Jalali-dated transfer rows ${JSON.stringify(rows)}, expected two rows dated ${today}`);
    }
    if ((await stockOf(code)) !== 9 || (await stockOf(wh2.code)) !== 1) wrong.push(`after the transfer ${code}=${await stockOf(code)} ${wh2.code}=${await stockOf(wh2.code)}, expected 9 and 1`);

    // a final stock document dated tomorrow is refused the same way
    let receiptError = '';
    try {
      await DocumentService.createDocument({
        docType: 'receipt', status: 'final', inOut: 'in', date: tomorrow, user: 'td483', buyerName: 'td483',
        location: code, items: [{ itemId: a.id, quantity: 1, unit_price: 1000, location: code }],
      });
    } catch (err) {
      receiptError = (err as { details?: { code?: string } })?.details?.code ?? String(err);
    }
    if (receiptError !== 'STOCK_MOVEMENT_FUTURE_DATE') wrong.push(`final receipt dated ${tomorrow}: ${receiptError || 'accepted'}, expected STOCK_MOVEMENT_FUTURE_DATE`);

    // an existing future-dated row (recorded before v9.0.66) is listed by the health check and left as it is
    const [future] = await orm.insert(transactions).values({
      itemId: a.id, type: 'in', quantity: 0.0001, unitPrice: money(0), totalPrice: money(0), date: '2099-01-01 00:00:00',
      documentType: 'receipt', documentRef: 'TD483-LEGACY', location: wh2.code, notes: 'td483', createdBy: 'td483', isDeleted: 0,
    }).returning({ id: transactions.id });
    txIds.push(future.id);
    const listed = await findFutureStockMovements(orm);
    if (!listed.some(r => r.id === future.id)) wrong.push('future Kardex row not found by findFutureStockMovements');
    if (listed.some(r => rows.some(t => t.id === r.id))) wrong.push('a today-dated transfer row was listed as future');
    const report = await FinancialHealthService.runHealthCheck();
    const test = report.tests.find(t => t.id === 'stock_future_movements');
    if (!test || test.status !== 'warning' || !test.items?.some(i => i.id === future.id)) {
      wrong.push(`health check test stock_future_movements = ${JSON.stringify(test ? { status: test.status, count: test.count } : null)}, expected a warning listing row ${future.id}`);
    }
    const [kept] = await orm.select({ date: transactions.date }).from(transactions).where(eq(transactions.id, future.id));
    if (String(kept?.date).slice(0, 10) !== '2099-01-01') wrong.push(`future row was rewritten to ${kept?.date}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'future transfers (2099 and tomorrow) 422 with STOCK_MOVEMENT_FUTURE_DATE; text date 422; Jalali date stored as ISO; final receipt dated tomorrow refused; legacy future row listed by the health check and kept',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (txIds.length > 0) await orm.update(transactions).set({ isDeleted: 1 }).where(inArray(transactions.id, txIds)).catch(() => undefined);
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
