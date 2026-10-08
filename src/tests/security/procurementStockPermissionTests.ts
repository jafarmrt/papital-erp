import { TestCaseResult } from '../types.js';
import { approvedRequisition, fixture, formRow, type Fixture } from '../regression/procurementRequisitionTests.js';
import { runCase, type Harness, type Session, type ShouldRun } from './workflowTestHarness.js';

/**
 * Phase 5 PR «ب» (procurement and workflow, product-owner decision t3 «الف»): every path that moves stock asks the warehouse
 * permission of the stock document, through the real Express routes with real sessions. Each case is red on the code before
 * its fix. Test names and failure messages are English (terminal output).
 */
export async function runProcurementStockPermissionTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_procurement_receive_warehouse_in_td_904', 'security', 'td904', 'p5-p01', 'procurement', 'workflow', 'permissions', 'phase5')) {
    await runCase(results, {
      id: 'sec_procurement_receive_warehouse_in_td_904',
      name: 'v9.0.451: receiving a requisition\'s goods into stock asks warehouse.in on every path: workflow transition, inbox task, procurement workflow action and order delivery (TD-904)',
      details: 'workflow.view + workflow.execute (transition route and inbox task), procurement.approve (receive items) and procurement.manage / procurement.order (deliver) without warehouse.in get 403 and the stock, Kardex rows, order status, vouchers, requisition status and workflow step stay as they were; the same keys plus warehouse.in receive the goods',
    }, async (h, wrong) => {
      const f = await fixture(h);
      const workflowOnly = await h.sessionWith(['workflow.view', 'workflow.execute']);
      const workflowIn = await h.sessionWith(['workflow.view', 'workflow.execute', 'warehouse.view', 'warehouse.in']);

      // 1) POST /workflow/transition with the receive action
      const viaTransition = await orderedRequisition(h, f, 3);
      await refusedThenAccepted(h, f, wrong, 'workflow transition', viaTransition, async (s) => {
        const statuses = await h.walk(viaTransition.instanceId, ['receive_items'], s);
        return statuses[0] ?? 0;
      }, workflowOnly, workflowIn);

      // 2) the inbox task of the receive step
      const viaTask = await orderedRequisition(h, f, 4);
      const [task] = await h.q(
        `SELECT t.id FROM workflow_tasks t WHERE t.instance_id = $1 AND t.status = 'pending' AND t.transition_id = $2 ORDER BY t.id LIMIT 1`,
        [viaTask.instanceId, viaTask.receiveTransitionId],
      );
      if (!task) wrong.push(`inbox: no pending task of the receive transition for instance ${viaTask.instanceId}`);
      else {
        await refusedThenAccepted(h, f, wrong, 'inbox task', viaTask, async (s) => {
          const res = await h.post(`/api/workflow/tasks/${String(task.id)}/execute`, { action: 'approve' }, s);
          return res.status;
        }, workflowOnly, workflowIn);
      }

      // 3) the procurement page's «receive items» workflow action
      const viaAction = await orderedRequisition(h, f, 5);
      await refusedThenAccepted(h, f, wrong, 'receive items action', viaAction, async (s) => {
        const res = await f.action(viaAction.reqId, 'receive_items', s);
        // the refusal names the permission by its title, the key only in the details
        if (res.status === 403 && (res.code !== 'WF_ENTITY_PERMISSION_REQUIRED' || String(res.error ?? res.message ?? '').includes('warehouse.in'))) {
          wrong.push(`receive items refusal: ${String(res.code)} ${String(res.error ?? res.message ?? '').slice(0, 160)}`);
        }
        return res.status;
      },
        await h.sessionWith(['procurement.view', 'procurement.approve']),
        await h.sessionWith(['procurement.view', 'procurement.approve', 'warehouse.view', 'warehouse.in']));

      // 4) order delivery: procurement.manage alone and procurement.order alone are refused
      const viaDelivery = await orderedRequisition(h, f, 6);
      const deliver = async (s: Session) => {
        const res = await f.deliver(viaDelivery.orderId, s);
        if (res.status === 403 && res.body.code !== 'PROCUREMENT_RECEIVE_PERMISSION_REQUIRED') wrong.push(`delivery refusal code ${String(res.body.code)}`);
        return res.status;
      };
      await refusedThenAccepted(h, f, wrong, 'order delivery (procurement.order)', viaDelivery, deliver,
        await h.sessionWith(['procurement.view', 'procurement.order']), undefined);
      await refusedThenAccepted(h, f, wrong, 'order delivery (procurement.manage)', viaDelivery, deliver,
        await h.sessionWith(['procurement.view', 'procurement.manage']),
        await h.sessionWith(['procurement.view', 'procurement.manage', 'warehouse.view', 'warehouse.in']));
    });
  }

  return results;
}

interface OrderedRequisition {
  reqId: number;
  instanceId: number;
  receiveTransitionId: number;
  orderId: number;
  itemId: number;
  quantity: number;
}

/** An approved requisition of one fresh item with one draft order for the whole quantity */
async function orderedRequisition(h: Harness, f: Fixture, quantity: number): Promise<OrderedRequisition> {
  const item = await f.item();
  const req = await approvedRequisition(h, f, [formRow(item, quantity, 1000)]);
  const order = await f.convert(req.id, [{ itemId: item.id, quantity }]);
  if (order.status !== 200 || !order.docIds[0]) throw new Error(`convert to order: ${order.status} ${JSON.stringify(order.body).slice(0, 200)}`);
  const { workflowInstanceId } = await f.requisition(req.id);
  const [inst] = await h.q(`SELECT snapshot_dsl, current_state_id FROM workflow_instances WHERE id = $1`, [workflowInstanceId]);
  const transitions = ((inst?.snapshot_dsl as { transitions?: Array<{ id: number; actionKey: string; fromStateId: number }> } | null)?.transitions ?? []);
  const receive = transitions.find(t => t.actionKey === 'receive_items' && t.fromStateId === inst?.current_state_id);
  if (!workflowInstanceId || !receive) throw new Error(`requisition ${req.id}: no workflow instance or receive transition`);
  return { reqId: req.id, instanceId: workflowInstanceId, receiveTransitionId: receive.id, orderId: order.docIds[0], itemId: item.id, quantity };
}

/** What a stock-in path changes: stock, Kardex rows and vouchers of the order, the order, the requisition and its step */
async function stockState(h: Harness, f: Fixture, r: OrderedRequisition): Promise<string> {
  const [kardex] = await h.q(`SELECT count(*)::int AS n FROM transactions WHERE document_id = $1`, [r.orderId]);
  const [vouchers] = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [r.orderId]);
  const req = await f.requisition(r.reqId);
  const flow = await f.workflow(r.reqId);
  return `stock ${await f.stock(r.itemId)}, kardex rows ${String(kardex?.n)}, order ${String(await f.docStatus(r.orderId))}, vouchers ${String(vouchers?.n)}, requisition ${req.status}, step ${flow.step}`;
}

/** `refused` gets 403 and nothing moves; then `accepted` (when given) receives the goods */
async function refusedThenAccepted(
  h: Harness, f: Fixture, wrong: string[], label: string, r: OrderedRequisition,
  run: (s: Session) => Promise<number>, refused: Session, accepted: Session | undefined,
): Promise<void> {
  const before = await stockState(h, f, r);
  const status = await run(refused);
  const after = await stockState(h, f, r);
  if (status !== 403) wrong.push(`${label} without warehouse.in: ${status}, not 403`);
  if (after !== before) wrong.push(`${label} without warehouse.in moved something: ${before} -> ${after}`);
  if (!accepted) return;
  const ok = await run(accepted);
  if (ok !== 200) wrong.push(`${label} with warehouse.in: ${ok}, not 200`);
  const [vouchers] = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [r.orderId]);
  if (await f.stock(r.itemId) !== r.quantity || await f.docStatus(r.orderId) !== 'final' || Number(vouchers?.n) !== 1) {
    wrong.push(`${label} with warehouse.in did not receive the goods: ${await stockState(h, f, r)}`);
  }
}
