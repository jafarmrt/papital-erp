import { TestCaseResult, makeTestCase } from '../types.js';
import { createHarness, type Harness, type ShouldRun } from '../security/workflowTestHarness.js';
import { approvedRequisition, fixture, formRow, type Fixture } from './procurementRequisitionTests.js';

/**
 * Phase 5 PR «ب» (procurement): «دریافت کالا» (receive_items) and order delivery, through the real Express routes with
 * real sessions. Each case reproduces a phase 5 finding and is red on the code before its fix. Test names and failure
 * messages are English (terminal output).
 */
export async function runProcurementReceiveTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_procurement_receive_unsettled_rows_td_911',
      'v9.0.453: receive items does not mark a requisition received while a row is neither received nor closed; the whole transition rolls back, as delivery does (TD-911)',
      ['td911', 'p5-p02', 'procurement', 'workflow', 'receive', 'phase5'], unsettledReceiveCase],
  ];
  for (const [id, name, tags, run] of cases) {
    if (!shouldRun(id, ...tags)) continue;
    const tStart = Date.now();
    let h: Harness | undefined;
    try {
      h = await createHarness();
      const wrong: string[] = [];
      const details = await run(h, wrong);
      if (wrong.length > 0) throw new Error(wrong.join('; '));
      results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_api', passed: true, durationMs: Date.now() - tStart, details }));
    } catch (err) {
      results.push(makeTestCase({
        id, name, layer: 'regression', executionType: 'real_api', passed: false, durationMs: Date.now() - tStart,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      await h?.cleanup();
    }
  }
  return results;
}

/** Stock, Kardex rows and vouchers of the orders, the orders, the requisition rows and its workflow step */
async function receiveState(h: Harness, f: Fixture, reqId: number, itemIds: number[], orderIds: number[]): Promise<string> {
  const [kardex] = await h.q(`SELECT count(*)::int AS n FROM transactions WHERE document_id = ANY($1::int[])`, [orderIds]);
  const [vouchers] = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE source_document_id = ANY($1::int[]) AND is_deleted = 0`, [orderIds]);
  const stocks = await Promise.all(itemIds.map(id => f.stock(id)));
  const orders = await Promise.all(orderIds.map(id => f.docStatus(id)));
  const req = await f.requisition(reqId);
  const flow = await f.workflow(reqId);
  const rows = req.items.map(r => `${String(r.receivedQty ?? 0)}/${String(r.requestedQty)}`).join(',');
  return `stock ${stocks.join(',')}, kardex rows ${String(kardex?.n)}, vouchers ${String(vouchers?.n)}, orders ${orders.join(',')}, requisition ${req.status} rows ${rows}, workflow ${flow.status}/${flow.step}`;
}

async function unsettledReceiveCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);

  // requisition 10, order 6: receive items is refused and nothing moves, from the procurement page and the workflow route
  const p = await f.item();
  const req = await approvedRequisition(h, f, [formRow(p, 10, 1000)]);
  const first = await f.convert(req.id, [{ itemId: p.id, quantity: 6 }]);
  if (first.status !== 200 || !first.docIds[0]) throw new Error(`order 6 of 10: ${first.status}`);
  const before = await receiveState(h, f, req.id, [p.id], first.docIds);
  const viaAction = await f.action(req.id, 'receive_items');
  if (viaAction.status !== 409 || viaAction.code !== 'REQUISITION_ROWS_NOT_SETTLED') wrong.push(`receive items with 4 of 10 not ordered: ${viaAction.status} ${String(viaAction.code)}`);
  const { workflowInstanceId } = await f.requisition(req.id);
  const viaRoute = await h.walk(Number(workflowInstanceId), ['receive_items'], h.admin);
  if (viaRoute[0] !== 409) wrong.push(`receive transition through the workflow route with 4 of 10 not ordered: ${viaRoute.join(',')}`);
  const after = await receiveState(h, f, req.id, [p.id], first.docIds);
  if (after !== before) wrong.push(`the refused receive moved something: ${before} -> ${after}`);

  // the remaining 4 can still be ordered; then receive items receives both orders and completes the requisition
  const rest = await f.convert(req.id, [{ itemId: p.id, quantity: 4 }]);
  if (rest.status !== 200 || !rest.docIds[0]) wrong.push(`order the remaining 4 after the refused receive: ${rest.status}`);
  else {
    const received = await f.action(req.id, 'receive_items');
    const done = await receiveState(h, f, req.id, [p.id], [...first.docIds, ...rest.docIds]);
    if (received.status !== 200 || done !== 'stock 10, kardex rows 2, vouchers 2, orders final,final, requisition received rows 10/10, workflow COMPLETED/received') {
      wrong.push(`receive items with every row ordered: ${received.status} ${String(received.code ?? '')}; ${done}`);
    }
  }

  // a row closed at ordering is settled: receive items receives the other row and completes the requisition
  const z = await f.item();
  const w = await f.item();
  const closing = await approvedRequisition(h, f, [formRow(z, 4, 1000), formRow(w, 3, 1000)]);
  const only = await f.convert(closing.id, [{ itemId: z.id, quantity: 4 }], h.admin, { closeRequisition: true, closureReason: 'تأمین از انبار دیگر' });
  if (only.status !== 200 || !only.docIds[0]) throw new Error(`order with a closed row: ${only.status}`);
  const closedReceive = await f.action(closing.id, 'receive_items');
  const closed = await f.requisition(closing.id);
  if (closedReceive.status !== 200 || closed.status !== 'received' || await f.stock(z.id) !== 4 || await f.stock(w.id) !== 0) {
    wrong.push(`receive items with a closed row: ${closedReceive.status} ${String(closedReceive.code ?? '')}, requisition ${closed.status}, stock ${await f.stock(z.id)},${await f.stock(w.id)}`);
  }
  return 'receive items with 4 of 10 neither ordered nor closed was 409 REQUISITION_ROWS_NOT_SETTLED from the procurement page and the workflow route and nothing moved; the remaining 4 were ordered and both orders received; a requisition whose other row was closed was received';
}
