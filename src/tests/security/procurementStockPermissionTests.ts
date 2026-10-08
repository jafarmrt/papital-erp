import { TestCaseResult } from '../types.js';
import { approvedRequisition, fixture, formRow, type Fixture } from '../regression/procurementRequisitionTests.js';
import { runCase, type Harness, type Row, type Session, type ShouldRun } from './workflowTestHarness.js';

/**
 * Phase 5 PR «ب» (procurement and workflow, product-owner decision t3 «الف»): every path that moves stock asks the warehouse
 * permission of the stock document, and a workflow step that moves stock reads the signer's backdate permission like the
 * document route, through the real Express routes with real sessions. Each case is red on the code before
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

  if (shouldRun('sec_workflow_document_backdate_td_928', 'security', 'td928', 'p5-s-04', 'workflow', 'documents', 'permissions', 'phase5')) {
    await runCase(results, {
      id: 'sec_workflow_document_backdate_td_928',
      name: 'v9.0.452: the document approval workflow finalizes a backdated draft for a signer holding warehouse.backdate, read from the signer\'s role (the delegator\'s for a deputy), like PUT /documents/:id/finalize (TD-928)',
      details: 'draft invoice dated yesterday, item received 7 days ago and today: direct approval by a signer without warehouse.backdate is 422 STOCK_MOVEMENT_BACKDATED and nothing moves; with it the invoice is final with one Kardex out row; a deputy signs with the delegator\'s permission, not their own',
    }, async (h, wrong) => {
      const approver = ['workflow.view', 'workflow.approve', 'workflow.admin', 'documents.view', 'documents.finalize', 'warehouse.view'];
      const refused = async (label: string, s: Session) => {
        const d = await backdatedDraft(h);
        const before = await draftState(h, d);
        const res = await directApprove(h, d, s);
        const after = await draftState(h, d);
        if (res.status !== 422 || (res.body.details as Row | undefined)?.code !== 'STOCK_MOVEMENT_BACKDATED') {
          wrong.push(`${label}: ${res.status} ${String(res.body.code)} ${String((res.body.details as Row | undefined)?.code)}, not 422 STOCK_MOVEMENT_BACKDATED`);
        }
        if (after !== before) wrong.push(`${label} moved something: ${before} -> ${after}`);
      };
      const accepted = async (label: string, s: Session) => {
        const d = await backdatedDraft(h);
        const res = await directApprove(h, d, s);
        const after = await draftState(h, d);
        if (res.status !== 200 || after !== 'document final, kardex out rows 1, vouchers 1, stock 9, step approved') {
          wrong.push(`${label}: ${res.status} ${String(res.body.code ?? '')} ${String((res.body.details as Row | undefined)?.code ?? '')}; ${after}`);
        }
      };

      await refused('approval without warehouse.backdate', await h.sessionWith(approver));
      await accepted('approval with warehouse.backdate', await h.sessionWith([...approver, 'warehouse.backdate']));

      // a deputy without the approval keys signs in the delegator's name: the delegator's role decides the backdate
      const deputyOf = async (holderKeys: string[], deputyKeys: string[]) => {
        const holder = await h.sessionWith(holderKeys);
        const deputy = await h.sessionWith(deputyKeys);
        const start = new Date(Date.now() - 3600_000).toISOString();
        const end = new Date(Date.now() + 86_400_000).toISOString();
        const delegation = await h.post('/api/workflow/delegations', { fromUserId: holder.userId, toUserId: deputy.userId, scope: 'ALL', startDate: start, endDate: end, reason: `td928 ${h.tag}` });
        if (delegation.status !== 200 && delegation.status !== 201) throw new Error(`creating the delegation returned ${delegation.status}: ${JSON.stringify(delegation.body).slice(0, 160)}`);
        return deputy;
      };
      const deputies: number[] = [];
      const refusedDeputy = await deputyOf(approver, ['workflow.view', 'workflow.approve', 'warehouse.view', 'warehouse.backdate']);
      deputies.push(refusedDeputy.userId);
      await refused('deputy holding warehouse.backdate for a delegator without it', refusedDeputy);
      const acceptedDeputy = await deputyOf([...approver, 'warehouse.backdate'], ['workflow.view', 'workflow.approve']);
      deputies.push(acceptedDeputy.userId);
      await accepted('deputy of a delegator holding warehouse.backdate', acceptedDeputy);
      await h.q(`DELETE FROM workflow_delegations WHERE to_user_id = ANY($1::int[])`, [deputies]).catch(() => undefined);
    });
  }

  return results;
}

/** A draft invoice dated yesterday of a fresh item received 5 seven days ago and 5 today, with its approval workflow */
async function backdatedDraft(h: Harness): Promise<{ docId: number; itemId: number; instanceId: number }> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const { orm } = await import('../../db/drizzle.js');
  const today = await businessTodayIsoDate();
  const shift = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const wh = String(await getDefaultWarehouseCode(orm));
  const serial = `${h.tag}-${Math.floor(Math.random() * 1e6)}`;
  const item = await createTestItem({ type: 'product', code: `TD928-${serial}`, name: `کالای تاریخ گذشته ${serial}`, stocks: {}, weightedAverageCost: 0 } as never);
  for (const date of [shift(-7), today]) {
    const receipt = await h.post('/api/documents', {
      docType: 'receipt', inOut: 'in', status: 'final', refNumber: 'auto', date, buyer_name: `تأمین‌کننده ${h.tag}`, location: wh,
      items: [{ itemId: item.id, quantity: 5, unit_price: 600000 }],
    });
    if (receipt.status >= 300) throw new Error(`receipt dated ${date}: ${receipt.status} ${JSON.stringify(receipt.body).slice(0, 200)}`);
  }
  const draft = await h.post('/api/documents', {
    docType: 'invoice', status: 'draft', refNumber: 'auto', date: shift(-1), buyer_name: `خریدار ${h.tag}`, location: wh,
    items: [{ itemId: item.id, quantity: 1, unit_price: 1000000 }],
  });
  const docId = Number(draft.body?.docId ?? draft.body?.data?.docId);
  if (draft.status >= 300 || !(docId > 0)) throw new Error(`draft invoice: ${draft.status} ${JSON.stringify(draft.body).slice(0, 200)}`);
  const [inst] = await h.q(`SELECT id FROM workflow_instances WHERE entity_type = 'document' AND entity_id = $1 AND status = 'IN_PROGRESS' ORDER BY id DESC LIMIT 1`, [String(docId)]);
  if (!inst) throw new Error(`draft invoice ${docId}: no approval workflow`);
  return { docId, itemId: Number(item.id), instanceId: Number(inst.id) };
}

/** What a finalize changes: the document, its Kardex out rows and vouchers, the item's stock and the workflow step */
async function draftState(h: Harness, d: { docId: number; itemId: number; instanceId: number }): Promise<string> {
  const [doc] = await h.q(`SELECT status FROM documents WHERE id = $1`, [d.docId]);
  const [kardex] = await h.q(`SELECT count(*)::int AS n FROM transactions WHERE document_id = $1 AND type = 'out' AND is_deleted = 0`, [d.docId]);
  const [vouchers] = await h.q(`SELECT count(*)::int AS n FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0`, [d.docId]);
  const [stock] = await h.q(`SELECT current_stock::float8 AS qty FROM items WHERE id = $1`, [d.itemId]);
  const [inst] = await h.q(`SELECT current_state_id, snapshot_dsl FROM workflow_instances WHERE id = $1`, [d.instanceId]);
  const step = ((inst?.snapshot_dsl as { states?: Row[] } | null)?.states ?? []).find(s => s.id === inst?.current_state_id)?.stateKey;
  return `document ${String(doc?.status)}, kardex out rows ${String(kardex?.n)}, vouchers ${String(vouchers?.n)}, stock ${String(stock?.qty)}, step ${String(step)}`;
}

/** The «تأیید مستقیم» transition of the document workflow, through POST /workflow/transition */
async function directApprove(h: Harness, d: { instanceId: number }, s: Session): Promise<{ status: number; body: Row }> {
  const [inst] = await h.q(`SELECT snapshot_dsl, current_state_id FROM workflow_instances WHERE id = $1`, [d.instanceId]);
  const transitions = ((inst?.snapshot_dsl as { transitions?: Row[] } | null)?.transitions ?? []);
  const direct = transitions.find(t => t.actionKey === 'direct_approve' && t.fromStateId === inst?.current_state_id);
  if (!direct) throw new Error(`instance ${d.instanceId}: no direct approval transition from the current step`);
  const res = await h.post('/api/workflow/transition', { instanceId: d.instanceId, transitionId: direct.id }, s);
  return { status: res.status, body: (res.body ?? {}) as Row };
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
