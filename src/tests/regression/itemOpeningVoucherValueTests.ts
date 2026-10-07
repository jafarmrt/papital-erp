import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { items, journalVoucherItems, journalVouchers, transactions, workflowDefinitions } from '../../db/schema.js';

/**
 * Package 6 (inventory and Kardex), TD-481 / B06-02 (decision t4): the item opening voucher is worth the item's opening
 * Kardex rows (quantity x cost recorded at creation), with or without the item workflow, and never rewrites a Kardex row.
 * Opening vouchers that do not match their opening rows are listed by the financial health check. On v9.0.92 an opening
 * approved after a receipt 5 x 200 was valued at current stock x current WAC (15 x 133.3333 = 1999.9995 instead of 1000)
 * and the opening Kardex row was repriced to 133.3333, so the Kardex replay reached 155.5555 (I3 and I13).
 */
export async function runItemOpeningVoucherValueTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_item_opening_voucher_value_td_481';
  if (!shouldRun(id, 'td481', 'opening', 'voucher', 'kardex', 'inventory', 'package6')) return results;

  const name = 'v9.0.93: the item opening voucher is worth its opening Kardex rows, with or without the workflow, and rewrites no row (TD-481)';
  const tStart = Date.now();
  const itemIds: number[] = [];
  let workflowId: number | null = null;
  try {
    const { createTestUser, createTestWorkflow } = await import('../fixtures/factories.js');
    const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const { DocumentService } = await import('../../services/document.service.js');
    const { ItemCatalogService } = await import('../../services/items/itemCatalog.service.js');
    const { ItemOpeningService } = await import('../../services/inventory/itemOpening.service.js');
    const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
    const { replayKardexWac, wacDiffersFromReplay } = await import('../../services/inventory/kardexReplay.js');
    const { findOpeningVoucherMismatches } = await import('../../services/inventory/itemOpeningValue.js');
    const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');

    const today = await businessTodayIsoDate();
    const main = (await getDefaultWarehouseCode(orm)) as string;
    const user = await createTestUser({ role: 'admin' });
    const wf = await createTestWorkflow({
      definition: { entityType: 'item' },
      states: [{ key: 'draft', title: 'پیش‌نویس', type: 'initial' }, { key: 'approved', title: 'تأییدشده', type: 'terminal' }],
      transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_td481', title: 'تأیید نهایی' }],
    });
    workflowId = wf.definition.id;

    const createItem = async (label: string, quantity: number, wac: number) => {
      const s = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const created = await orm.transaction(tx => ItemCatalogService.createItem({
        type: 'raw_material', name: `td481 ${label} ${s}`, code: `TD481_${label}_${s}`, unit: 'عدد', category: '',
        weighted_average_cost: wac, [`stock_${main}`]: quantity,
      }, { id: user.id, username: user.username }, tx));
      itemIds.push(created.insertedId);
      return created.insertedId;
    };
    const receipt = (itemId: number) => DocumentService.createDocument({
      docType: 'receipt', status: 'final', inOut: 'in', date: today, user: 'td481', buyerName: 'td481',
      location: main, items: [{ itemId, quantity: 5, unit_price: 200, location: main }],
    });
    const openingAmount = async (itemId: number) => {
      const [row] = await orm.select({ amount: sql<string>`COALESCE(SUM(${journalVoucherItems.debit}), 0)::text` })
        .from(journalVoucherItems)
        .innerJoin(journalVouchers, eq(journalVouchers.id, journalVoucherItems.voucherId))
        .where(and(eq(journalVouchers.referenceModule, 'item_opening'), eq(journalVouchers.referenceId, itemId),
          eq(journalVouchers.isDeleted, 0), eq(journalVoucherItems.isDeleted, 0)));
      return Number(row?.amount ?? NaN);
    };
    const kardexOf = (itemId: number) => orm.select({
      id: transactions.id, type: transactions.type, quantity: transactions.quantity, unitPrice: transactions.unitPrice,
      documentType: transactions.documentType, documentRef: transactions.documentRef, reversalOfId: transactions.reversalOfId, isDeleted: transactions.isDeleted,
    }).from(transactions).where(eq(transactions.itemId, itemId)).orderBy(asc(transactions.id));
    const liveWac = async (itemId: number) => Number((await orm.select({ w: items.weightedAverageCost }).from(items).where(eq(items.id, itemId)))[0]?.w);

    const wrong: string[] = [];

    // 1) workflow: 10 x 100 waits for approval, a receipt 5 x 200 comes in, then the approval issues the opening voucher
    const a = await createItem('wf', 10, 100);
    const instance = await WorkflowTransitionExecutor.startInstance({
      workflowDefinitionId: wf.definition.id, entityType: 'item', entityId: String(a), userId: user.id, userName: user.username,
    });
    await receipt(a);
    await WorkflowTransitionExecutor.executeTransition({
      instanceId: instance.id, transitionId: wf.transitions[0].id, userId: user.id, userName: user.username, userRole: 'admin', userPermissions: ['*'],
    });
    const amountA = await openingAmount(a);
    if (amountA !== 1000) wrong.push(`opening voucher after the workflow approval ${amountA}, expected 1000 (10 x 100)`);
    const rowsA = await kardexOf(a);
    const openingRow = rowsA.find(r => r.documentRef === 'ثبت اولیه کالا');
    if (Number(openingRow?.unitPrice) !== 100) wrong.push(`opening Kardex row repriced to ${openingRow?.unitPrice}`);
    const wacA = await liveWac(a);
    const replayA = replayKardexWac(rowsA, wacA);
    if (wacDiffersFromReplay(wacA, replayA.wac.round(4).toNumber(), 15)) wrong.push(`Kardex replay WAC ${replayA.wac.toString()}, live WAC ${wacA}`);

    // 2) no workflow: the opening voucher issued at creation has the same value
    const b = await createItem('direct', 10, 100);
    await ItemOpeningService.issueItemOpeningVoucher(b, { userId: user.id, username: user.username });
    await receipt(b);
    const amountB = await openingAmount(b);
    if (amountB !== amountA) wrong.push(`opening voucher without the workflow ${amountB}, with it ${amountA}`);

    // 3) the health check lists an opening voucher that does not match its opening rows (an issued voucher is never changed)
    const c = await createItem('legacy', 4, 50);
    const voucherC = await ItemOpeningService.issueItemOpeningVoucher(c, { userId: user.id, username: user.username });
    if (!voucherC) throw new Error('no opening voucher for the third item');
    await orm.update(journalVoucherItems).set({ debit: sql`CASE WHEN ${journalVoucherItems.debit} > 0 THEN ${journalVoucherItems.debit} + 100 ELSE ${journalVoucherItems.debit} END`, credit: sql`CASE WHEN ${journalVoucherItems.credit} > 0 THEN ${journalVoucherItems.credit} + 100 ELSE ${journalVoucherItems.credit} END` })
      .where(eq(journalVoucherItems.voucherId, voucherC.id));
    const mismatched = (await findOpeningVoucherMismatches()).filter(r => itemIds.includes(Number(r.itemId)));
    if (mismatched.length !== 1 || Number(mismatched[0].itemId) !== c || Number(mismatched[0].kardexValue) !== 200 || Number(mismatched[0].voucherAmount) !== 300) {
      wrong.push(`opening voucher mismatches ${JSON.stringify(mismatched)}, expected only item ${c} (voucher 300, Kardex 200)`);
    }
    const report = await FinancialHealthService.runHealthCheck();
    const test = report.tests.find(t => t.id === 'item_opening_voucher_value');
    if (!test || test.status !== 'warning' || !(test.items ?? []).some(i => Number(i.id) === voucherC.id)) {
      wrong.push(`health check test item_opening_voucher_value = ${JSON.stringify(test ? { status: test.status, count: test.count } : null)}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `opening voucher ${amountA} after the approval and ${amountB} without the workflow; opening row kept at 100; replay WAC ${replayA.wac.round(4).toString()} = live ${wacA}; mismatched voucher listed`,
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (workflowId !== null) await orm.update(workflowDefinitions).set({ isActive: 0 }).where(eq(workflowDefinitions.id, workflowId)).catch(() => undefined);
    if (itemIds.length > 0) await orm.update(items).set({ isDeleted: 1 }).where(inArray(items.id, itemIds)).catch(() => undefined);
  }
  return results;
}
