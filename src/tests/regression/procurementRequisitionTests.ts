import { TestCaseResult, makeTestCase } from '../types.js';
import { orm } from '../../db/drizzle.js';
import { createHarness, type Harness, type Row, type Session, type ShouldRun } from '../security/workflowTestHarness.js';

/**
 * Package 10 (purchasing and procurement), PR A: the purchase requisition contract, the approval gate before ordering,
 * delivery through the workflow engine, delete and edit, through the real Express routes with real sessions. Each case
 * reproduces a finding of the package 10 review and is red on the code before its fix.
 */
export async function runProcurementRequisitionTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const cases: Array<[string, string, string[], (h: Harness, wrong: string[]) => Promise<string>]> = [
    ['reg_procurement_requisition_form_bodies_td_688',
      'v9.0.314: POST /procurement/requisitions accepts the bodies of the three UI forms (requested quantity, item name, priority urgent/high/normal/low) and refuses a body without a quantity instead of storing zero (TD-688)',
      ['td688', 'procurement', 'requisition', 'contract', 'package10'], formBodiesCase],
    ['reg_procurement_convert_requires_approval_td_689',
      'v9.0.315: an unapproved requisition is ordered only after its approval transition runs in the name of a user who may approve; a partial order never moves the workflow step back (TD-689)',
      ['td689', 'procurement', 'workflow', 'approval', 'security', 'package10'], convertApprovalCase],
    ['reg_procurement_partial_delivery_td_690',
      'v9.0.316: delivering the only order of a partly ordered requisition does not mark it received; it is received when every row is received or closed (TD-690)',
      ['td690', 'procurement', 'delivery', 'package10'], partialDeliveryCase],
    ['reg_procurement_delivery_through_workflow_td_692',
      'v9.0.317: delivery runs the receive transition in its own transaction with the user role and permissions, a refused transition refuses the delivery, and an order of an unapproved requisition is not delivered (TD-692)',
      ['td692', 'procurement', 'workflow', 'delivery', 'security', 'package10'], deliveryWorkflowCase],
    ['reg_procurement_delete_with_orders_td_695',
      'v9.0.318: a requisition with a live purchase order is not deleted (TD-695)',
      ['td695', 'procurement', 'delete', 'package10'], deleteWithOrdersCase],
    ['reg_procurement_edit_before_approval_td_696',
      'v9.0.319: PUT /procurement/requisitions/:id takes the stored row id, edits only an unapproved requisition without orders, and keeps ordered and received quantities and order links (TD-696)',
      ['td696', 'procurement', 'edit', 'package10'], editCase],
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

export interface ReqRow { id: string; itemId: number | null; itemName: string; requestedQty: number; orderedQty?: number; receivedQty?: number; linkedDocumentIds?: number[]; status?: string }

export interface Fixture {
  wh: string;
  jalaliDate: string;
  item(): Promise<{ id: number; code: string; name: string }>;
  stock(itemId: number): Promise<number>;
  create(body: Record<string, unknown>, s?: Session): Promise<{ status: number; id: number; code: string; body: Row }>;
  requisition(id: number): Promise<{ status: string; priority: string; total: number; isDeleted: number; items: ReqRow[]; workflowInstanceId: number | null }>;
  workflow(reqId: number): Promise<{ status: string; step: string; history: Row[] }>;
  action(reqId: number, actionKey: string, s?: Session): Promise<Row & { status: number }>;
  convert(reqId: number, lines: Array<{ itemId: number; quantity: number }>, s?: Session, extra?: Record<string, unknown>): Promise<{ status: number; body: Row; docIds: number[] }>;
  deliver(docId: number, s?: Session): Promise<{ status: number; body: Row }>;
  docStatus(docId: number): Promise<string | undefined>;
}

export async function fixture(h: Harness): Promise<Fixture> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { isoToJalaliDate } = await import('../../utils/calendarDate.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const wh = String(await getDefaultWarehouseCode(orm));
  const jalaliDate = isoToJalaliDate(await businessTodayIsoDate());
  let serial = 0;
  const f: Fixture = {
    wh,
    jalaliDate,
    async item() {
      serial += 1;
      const tag = `${h.tag}-${serial}-${Math.floor(Math.random() * 1e5)}`;
      const created = await createTestItem({ type: 'raw_material', code: `P10A-${tag}`, name: `مواد بسته ۱۰ ${tag}`, stocks: {}, weightedAverageCost: 0 } as never);
      return { id: Number(created.id), code: String(created.code), name: String(created.name) };
    },
    async stock(itemId) {
      const [row] = await h.q(`SELECT current_stock::float8 AS qty FROM items WHERE id = $1`, [itemId]);
      return Number(row?.qty ?? 0);
    },
    async create(body, s = h.admin) {
      const res = await h.post('/api/procurement/requisitions', body, s);
      const data = (res.body?.data ?? {}) as Row;
      return { status: res.status, id: Number(data.id ?? 0), code: String(data.code ?? ''), body: res.body as Row };
    },
    async requisition(id) {
      const [row] = await h.q(`SELECT status, priority, total_estimated_amount::float8 AS total, is_deleted, items, workflow_instance_id FROM purchase_requisitions WHERE id = $1`, [id]);
      return {
        status: String(row?.status), priority: String(row?.priority), total: Number(row?.total ?? 0), isDeleted: Number(row?.is_deleted ?? 0),
        items: (row?.items ?? []) as ReqRow[], workflowInstanceId: row?.workflow_instance_id == null ? null : Number(row.workflow_instance_id),
      };
    },
    async workflow(reqId) {
      const [inst] = await h.q(
        `SELECT i.id, i.status, i.current_state_id, i.snapshot_dsl FROM workflow_instances i WHERE i.entity_type = 'purchase_requisition' AND i.entity_id = $1 ORDER BY i.id DESC LIMIT 1`,
        [String(reqId)],
      );
      if (!inst) return { status: 'NONE', step: '', history: [] };
      const states = ((inst.snapshot_dsl as { states?: Row[] } | null)?.states ?? []);
      const step = String(states.find(s => s.id === inst.current_state_id)?.stateKey ?? '');
      const history = await h.q(`SELECT action_key, performed_by FROM workflow_history_logs WHERE instance_id = $1 ORDER BY id`, [inst.id]);
      return { status: String(inst.status), step, history };
    },
    async action(reqId, actionKey, s = h.admin) {
      const res = await h.post(`/api/procurement/requisitions/${reqId}/workflow-action`, { actionKey }, s);
      return { ...(res.body as Row), status: res.status };
    },
    async convert(reqId, lines, s = h.admin, extra = {}) {
      // the body SplitOrderModal sends
      const res = await h.post(`/api/procurement/requisitions/${reqId}/convert-to-orders`, {
        orderGroups: [{
          supplierName: `تامین‌کننده بسته ۱۰ ${h.tag}`, targetWarehouse: wh, docType: 'receipt', status: 'draft',
          items: lines.map(l => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: 1000, unit: 'عدد' })),
        }],
        ...extra,
      }, s);
      const docs = ((res.body?.data as { createdDocuments?: Row[] } | undefined)?.createdDocuments ?? []);
      return { status: res.status, body: res.body as Row, docIds: docs.map(d => Number(d.id)) };
    },
    async deliver(docId, s = h.admin) {
      const res = await h.post(`/api/procurement/orders/${docId}/deliver`, {}, s);
      return { status: res.status, body: res.body as Row };
    },
    async docStatus(docId) {
      const [row] = await h.q(`SELECT status FROM documents WHERE id = $1`, [docId]);
      return row?.status as string | undefined;
    },
  };
  return f;
}

/** One row of a requisition as the three forms build it */
export function formRow(item: { id: number; code: string; name: string }, requestedQty: number, unitPriceEstimate: number, notes = '') {
  return { itemId: item.id, itemCode: item.code, itemName: item.name, unit: 'عدد', requestedQty, unitPriceEstimate, notes };
}

export async function approvedRequisition(h: Harness, f: Fixture, rows: Array<Record<string, unknown>>): Promise<{ id: number; code: string }> {
  const created = await f.create({ title: `درخواست بسته ۱۰ ${h.tag}`, priority: 'normal', requiredDate: f.jalaliDate, notes: '', items: rows });
  if (created.status !== 201) throw new Error(`create requisition: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  const approved = await f.action(created.id, 'approve_request');
  if (approved.status !== 200) throw new Error(`approve requisition: ${approved.status} ${JSON.stringify(approved).slice(0, 200)}`);
  return { id: created.id, code: created.code };
}

async function formBodiesCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const { ProjectService } = await import('../../services/projects.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const a = await f.item();
  const b = await f.item();
  const { project } = await ProjectService.createProject({ title: `پروژه بسته ۱۰ ${h.tag}`, startDate: await businessTodayIsoDate(), quantity: 1 } as never);
  const summaryBefore = (await h.get('/api/procurement/inbox/summary')).body?.data as Row | undefined;

  const bodies: Array<[string, Record<string, unknown>, { priority: string; rows: Array<[number, number, number]> }]> = [
    ['procurement desk', {
      title: `درخواست میز تدارکات ${h.tag}`, priority: 'normal', requiredDate: f.jalaliDate, notes: 'میز',
      items: [formRow(a, 4, 2500), formRow(b, 2, 0)],
    }, { priority: 'normal', rows: [[a.id, 4, 2500], [b.id, 2, 0]] }],
    ['project material shortage', {
      title: `کسری مواد پروژه ${project.projectCode}`, projectId: project.id, projectCode: project.projectCode, projectName: project.title,
      priority: 'urgent', requiredDate: f.jalaliDate, notes: '', items: [formRow(a, 6, 1200)],
    }, { priority: 'urgent', rows: [[a.id, 6, 1200]] }],
    ['reorder alert', {
      title: `سفارش تامین ماده اولیه ${b.name}`, priority: 'high', requiredDate: f.jalaliDate, notes: '',
      items: [formRow(b, 8, 1000, 'کسری نقطه سفارش: موجودی فعلی 2 / حد آستانه 10')],
    }, { priority: 'high', rows: [[b.id, 8, 1000]] }],
  ];
  for (const [form, body, expected] of bodies) {
    const created = await f.create(body);
    if (created.status !== 201) {
      wrong.push(`${form} body: ${created.status} ${String(created.body.message ?? created.body.error ?? '').slice(0, 160)}`);
      continue;
    }
    const stored = await f.requisition(created.id);
    if (stored.priority !== expected.priority) wrong.push(`${form}: priority ${stored.priority}, expected ${expected.priority}`);
    let total = 0;
    expected.rows.forEach(([itemId, qty, price], index) => {
      const row = stored.items[index];
      total += qty * price;
      if (!row || Number(row.itemId) !== itemId || Number(row.requestedQty) !== qty) wrong.push(`${form} row ${index + 1}: ${JSON.stringify(row)}`);
      else if (row.itemName === 'کالای سفارشی' || !row.itemName) wrong.push(`${form} row ${index + 1} item name: ${row.itemName}`);
    });
    if (stored.total !== total) wrong.push(`${form}: estimated total ${stored.total}, expected ${total}`);
  }
  const summaryAfter = (await h.get('/api/procurement/inbox/summary')).body?.data as Row | undefined;
  if (Number(summaryAfter?.urgentCount ?? 0) !== Number(summaryBefore?.urgentCount ?? 0) + 1) {
    wrong.push(`urgent count ${String(summaryBefore?.urgentCount)} -> ${String(summaryAfter?.urgentCount)}, expected one more`);
  }

  // a row the catalog does not hold (a service or a custom item) is accepted with its name
  const custom = await f.create({ title: `درخواست خدمت ${h.tag}`, priority: 'low', items: [{ itemName: 'تعمیر دستگاه پرس', unit: 'خدمت', requestedQty: 1, unitPriceEstimate: 500000 }] });
  if (custom.status !== 201) wrong.push(`custom row: ${custom.status}`);

  // the old Zod shape never stores a zero quantity, and an unknown item or a zero quantity is refused
  const refusals: Array<[string, Record<string, unknown>, number]> = [
    ['quantity instead of requestedQty', { title: `قدیمی ${h.tag}`, priority: 'high', items: [{ itemId: a.id, quantity: 3 }] }, 400],
    ['zero requested quantity', { title: `صفر ${h.tag}`, priority: 'high', items: [formRow(a, 0, 1000)] }, 400],
    ['priority emergency', { title: `اولویت ${h.tag}`, priority: 'emergency', items: [formRow(a, 1, 1000)] }, 400],
    ['row without item and name', { title: `بی نام ${h.tag}`, items: [{ requestedQty: 1 }] }, 400],
    ['unknown item', { title: `کالای ناموجود ${h.tag}`, items: [{ itemId: 2_000_000_000, itemName: 'ناموجود', requestedQty: 1 }] }, 422],
  ];
  for (const [label, body, status] of refusals) {
    const res = await f.create(body);
    if (res.status !== status) wrong.push(`${label}: ${res.status}, expected ${status}`);
    if (res.id > 0) wrong.push(`${label}: requisition ${res.id} was stored`);
  }
  const zero = await f.create({ title: `صفر ${h.tag}`, items: [{ itemId: a.id, requestedQty: 0 }] });
  if (!String(zero.body.message ?? '').includes('مقدار درخواستی')) wrong.push(`zero quantity message: ${String(zero.body.message)}`);
  return 'the desk, project shortage and reorder alert bodies were stored with their quantities, names and priorities; an urgent requisition counted; the old body, zero quantity, unknown priority and unknown item were refused';
}

async function convertApprovalCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const y = await f.item();
  const orderer = await h.sessionWith(['procurement.view', 'procurement.order']);
  const approver = await h.sessionWith(['procurement.view', 'procurement.order', 'procurement.approve']);

  const pending = await f.create({ title: `تأییدنشده ${h.tag}`, priority: 'normal', items: [formRow(x, 10, 1000)] });
  const refused = await f.convert(pending.id, [{ itemId: x.id, quantity: 10 }], orderer);
  if (refused.status !== 409 || refused.body.code !== 'REQUISITION_NOT_APPROVED') wrong.push(`orderer converts an unapproved requisition: ${refused.status} ${String(refused.body.code)}`);
  const orders = await h.q(`SELECT id FROM documents WHERE is_deleted = 0 AND position($1 in notes) > 0`, [`[تدارکات: درخواست ${pending.code}]`]);
  if (orders.length !== 0) wrong.push(`${orders.length} order(s) created for the unapproved requisition`);
  const untouched = await f.workflow(pending.id);
  if (untouched.step !== 'pending' || untouched.history.length !== 1) wrong.push(`workflow after the refusal: step ${untouched.step}, ${untouched.history.length} history rows`);

  const byApprover = await f.convert(pending.id, [{ itemId: x.id, quantity: 10 }], approver);
  if (byApprover.status !== 200) wrong.push(`approver converts an unapproved requisition: ${byApprover.status} ${String(byApprover.body.message ?? '').slice(0, 160)}`);
  const approvedFlow = await f.workflow(pending.id);
  const approval = approvedFlow.history.find(r => r.action_key === 'approve_request');
  if (approvedFlow.step !== 'ordered' || Number(approval?.performed_by) !== approver.userId) {
    wrong.push(`approval on convert: step ${approvedFlow.step}, approval by ${String(approval?.performed_by)} (expected ${approver.userId})`);
  }

  // a partial order of an approved requisition leaves the workflow at the approved step (A02-15)
  const partial = await approvedRequisition(h, f, [formRow(x, 10, 1000), formRow(y, 5, 1000)]);
  const before = await f.workflow(partial.id);
  const half = await f.convert(partial.id, [{ itemId: x.id, quantity: 10 }]);
  const after = await f.workflow(partial.id);
  const stored = await f.requisition(partial.id);
  if (half.status !== 200) wrong.push(`partial convert: ${half.status}`);
  if (after.step !== 'ordered' || after.history.length !== before.history.length) wrong.push(`partial convert moved the workflow: step ${after.step}, history ${before.history.length} -> ${after.history.length}`);
  if (stored.status !== 'ordered') wrong.push(`partial convert status ${stored.status}, expected ordered`);
  return 'an orderer without the approval right got 409 and nothing was ordered; an approver ordered after the approval ran in their name; a partial order kept the approved step';
}

async function partialDeliveryCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const y = await f.item();

  const req = await approvedRequisition(h, f, [formRow(x, 10, 1000), formRow(y, 5, 1000)]);
  const first = await f.convert(req.id, [{ itemId: x.id, quantity: 10 }]);
  const firstDelivery = await f.deliver(first.docIds[0]);
  if (firstDelivery.status !== 200) wrong.push(`deliver X: ${firstDelivery.status}`);
  const afterX = await f.requisition(req.id);
  const flowX = await f.workflow(req.id);
  if (afterX.status === 'received' || flowX.status !== 'IN_PROGRESS') wrong.push(`after delivering X only: requisition ${afterX.status}, workflow ${flowX.status}`);
  const second = await f.convert(req.id, [{ itemId: y.id, quantity: 5 }]);
  if (second.status !== 200) wrong.push(`order Y after X was delivered: ${second.status} ${String(second.body.message ?? '').slice(0, 160)}`);
  else {
    const secondDelivery = await f.deliver(second.docIds[0]);
    const done = await f.requisition(req.id);
    const flow = await f.workflow(req.id);
    if (secondDelivery.status !== 200 || done.status !== 'received' || flow.status !== 'COMPLETED' || flow.step !== 'received') {
      wrong.push(`after delivering Y: ${secondDelivery.status}, requisition ${done.status}, workflow ${flow.status}/${flow.step}`);
    }
    if (!flow.history.some(r => r.action_key === 'receive_items')) wrong.push('the receive transition has no history row');
    if (await f.stock(y.id) !== 5) wrong.push(`stock of Y ${await f.stock(y.id)}, expected 5`);
  }

  // a row closed at ordering does not keep the requisition open and is never received without an order
  const z = await f.item();
  const w = await f.item();
  const closing = await approvedRequisition(h, f, [formRow(z, 4, 1000), formRow(w, 3, 1000)]);
  const only = await f.convert(closing.id, [{ itemId: z.id, quantity: 4 }], h.admin, { closeRequisition: true, closureReason: 'تأمین از انبار دیگر' });
  const closedDelivery = await f.deliver(only.docIds[0]);
  const closed = await f.requisition(closing.id);
  if (closedDelivery.status !== 200 || closed.status !== 'received') wrong.push(`closed row: delivery ${closedDelivery.status}, requisition ${closed.status}`);
  if (await f.stock(w.id) !== 0) wrong.push(`the closed row W entered stock: ${await f.stock(w.id)}`);
  return 'the requisition stayed open after its first order was delivered, Y was ordered and delivered, and the receive transition completed the workflow; a closed row neither held the requisition open nor entered stock';
}

async function deliveryWorkflowCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const req = await approvedRequisition(h, f, [formRow(x, 4, 1000)]);
  const order = await f.convert(req.id, [{ itemId: x.id, quantity: 4 }]);
  const docId = order.docIds[0];
  const { workflowInstanceId } = await f.requisition(req.id);
  const [inst] = await h.q(`SELECT snapshot_dsl FROM workflow_instances WHERE id = $1`, [workflowInstanceId]);
  const snapshot = inst.snapshot_dsl as { transitions: Row[] };
  for (const t of snapshot.transitions) if (t.actionKey === 'receive_items') t.requiredPermission = 'warehouse.in';
  await h.q(`UPDATE workflow_instances SET snapshot_dsl = $2::jsonb WHERE id = $1`, [workflowInstanceId, JSON.stringify(snapshot)]);

  const withoutWarehouse = await h.sessionWith(['procurement.view', 'procurement.order']);
  const refused = await f.deliver(docId, withoutWarehouse);
  const flow = await f.workflow(req.id);
  if (refused.status !== 403 || refused.body.code !== 'WF_PERMISSION_REQUIRED') wrong.push(`delivery without warehouse.in: ${refused.status} ${String(refused.body.code)}`);
  if (await f.docStatus(docId) !== 'draft' || await f.stock(x.id) !== 0) wrong.push(`refused delivery changed the order or stock: ${await f.docStatus(docId)}, stock ${await f.stock(x.id)}`);
  if (flow.status !== 'IN_PROGRESS' || flow.step !== 'ordered') wrong.push(`refused delivery moved the workflow: ${flow.status}/${flow.step}`);

  const warehouseUser = await h.sessionWith(['procurement.view', 'procurement.order', 'warehouse.in']);
  const accepted = await f.deliver(docId, warehouseUser);
  const done = await f.workflow(req.id);
  const receive = done.history.find(r => r.action_key === 'receive_items');
  if (accepted.status !== 200 || done.status !== 'COMPLETED' || Number(receive?.performed_by) !== warehouseUser.userId) {
    wrong.push(`delivery with warehouse.in: ${accepted.status}, workflow ${done.status}, receive by ${String(receive?.performed_by)}`);
  }
  if (await f.stock(x.id) !== 4) wrong.push(`stock after delivery ${await f.stock(x.id)}, expected 4`);

  // an order of an unapproved requisition (recorded before the approval gate) is not delivered
  const { DocumentService } = await import('../../services/document.service.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const legacy = await f.create({ title: `سفارش قدیمی ${h.tag}`, priority: 'normal', items: [formRow(x, 2, 1000)] });
  const legacyDoc = Number(await DocumentService.createDocument({
    docType: 'receipt', status: 'draft', inOut: 'in', date: await businessTodayIsoDate(), user: 'آزمون بسته ۱۰', buyer_name: `تامین‌کننده قدیمی ${h.tag}`,
    notes: `[تدارکات: درخواست ${legacy.code}]`, items: [{ itemId: x.id, quantity: 2, unit_price: 1000, location: f.wh }],
  } as never));
  const rows = (await f.requisition(legacy.id)).items.map(r => ({ ...r, orderedQty: 2, remainingQty: 0, status: 'ordered', linkedDocumentIds: [legacyDoc] }));
  await h.q(`UPDATE purchase_requisitions SET items = $2::jsonb, status = 'under_review' WHERE id = $1`, [legacy.id, JSON.stringify(rows)]);
  // v9.0.347 (TD-691): the order is linked to its requisition, as migration 0082 links a tagged legacy order
  await h.q(`UPDATE documents SET procurement_requisition_id = $2 WHERE id = $1`, [legacyDoc, legacy.id]);
  const legacyDelivery = await f.deliver(legacyDoc, withoutWarehouse);
  if (legacyDelivery.status !== 409 || legacyDelivery.body.code !== 'REQUISITION_NOT_APPROVED') wrong.push(`order of an unapproved requisition: ${legacyDelivery.status} ${String(legacyDelivery.body.code)}`);
  if (await f.docStatus(legacyDoc) !== 'draft') wrong.push('the order of the unapproved requisition was finalized');
  // a holder of the approval right approves it in their own name and then delivers (the TD-390 rule)
  const approverDelivery = await f.deliver(legacyDoc, await h.sessionWith(['procurement.view', 'procurement.order', 'procurement.approve']));
  const legacyFlow = await f.workflow(legacy.id);
  if (approverDelivery.status !== 200 || await f.docStatus(legacyDoc) !== 'final' || !legacyFlow.history.some(r => r.action_key === 'approve_request')) {
    wrong.push(`approver delivery of the unapproved requisition: ${approverDelivery.status}, order ${await f.docStatus(legacyDoc)}, workflow ${legacyFlow.step}`);
  }
  return 'a delivery refused by the receive transition left the order, stock and workflow unchanged; with warehouse.in the receive transition completed the workflow in the deliverer name; an order of an unapproved requisition was refused, and an approver approved it in their name before delivering';
}

async function deleteWithOrdersCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const req = await approvedRequisition(h, f, [formRow(x, 6, 1000)]);
  const order = await f.convert(req.id, [{ itemId: x.id, quantity: 6 }]);
  const cancelled = await f.action(req.id, 'cancel_order');
  if (cancelled.status !== 200) wrong.push(`cancel order: ${cancelled.status}`);
  const res = await h.del(`/api/procurement/requisitions/${req.id}`);
  const stored = await f.requisition(req.id);
  if (res.status !== 409 || res.body?.code !== 'REQUISITION_HAS_ORDERS' || stored.isDeleted !== 0) {
    wrong.push(`delete of a requisition with a live order: ${res.status} ${String(res.body?.code)}, deleted ${stored.isDeleted}`);
  }
  if (!String(res.body?.message ?? '').includes(String(order.docIds[0] ? (await h.q(`SELECT ref_number FROM documents WHERE id = $1`, [order.docIds[0]]))[0]?.ref_number : ''))) {
    wrong.push(`message does not name the order: ${String(res.body?.message)}`);
  }

  const plain = await f.create({ title: `بی سفارش ${h.tag}`, priority: 'low', items: [formRow(x, 1, 1000)] });
  const removed = await h.del(`/api/procurement/requisitions/${plain.id}`);
  if (removed.status !== 200 || (await f.requisition(plain.id)).isDeleted !== 1) wrong.push(`delete of a requisition without orders: ${removed.status}`);
  return 'a cancelled requisition with a live order was not deleted (409 naming the order); a requisition without orders was deleted';
}

async function editCase(h: Harness, wrong: string[]): Promise<string> {
  const f = await fixture(h);
  const x = await f.item();
  const y = await f.item();
  const pending = await f.create({ title: `ویرایش ${h.tag}`, priority: 'normal', items: [formRow(x, 3, 100)] });
  const rowId = (await f.requisition(pending.id)).items[0]?.id;
  const edited = await h.put(`/api/procurement/requisitions/${pending.id}`, {
    title: `ویرایش‌شده ${h.tag}`, priority: 'high', items: [{ id: rowId, itemId: x.id, itemName: x.name, unit: 'عدد', requestedQty: 7, unitPriceEstimate: 100 }],
  });
  const afterEdit = await f.requisition(pending.id);
  if (edited.status !== 200) wrong.push(`edit with the stored row id: ${edited.status} ${String(edited.body?.message ?? '').slice(0, 160)}`);
  else if (afterEdit.items[0]?.id !== rowId || Number(afterEdit.items[0]?.requestedQty) !== 7 || afterEdit.total !== 700 || afterEdit.priority !== 'high') {
    wrong.push(`after edit: ${JSON.stringify(afterEdit.items[0])}, total ${afterEdit.total}, priority ${afterEdit.priority}`);
  }
  const [audit] = await h.q(
    `SELECT details FROM activity_logs WHERE entity = 'درخواست خرید' AND entity_id = $1 AND action = 'UPDATE' ORDER BY id DESC LIMIT 1`, [String(pending.id)]);
  const details = (audit?.details ?? {}) as { before?: { items?: unknown[] }; after?: { items?: unknown[] } };
  if (!Array.isArray(details.before?.items) || !Array.isArray(details.after?.items)) wrong.push(`edit audit has no before / after rows: ${JSON.stringify(details).slice(0, 200)}`);

  const approved = await f.action(pending.id, 'approve_request');
  if (approved.status !== 200) wrong.push(`approve: ${approved.status}`);
  const afterApproval = await h.put(`/api/procurement/requisitions/${pending.id}`, { items: [formRow(x, 1, 1)] });
  if (afterApproval.status !== 409 || afterApproval.body?.code !== 'REQUISITION_NOT_EDITABLE') wrong.push(`edit after approval: ${afterApproval.status} ${String(afterApproval.body?.code)}`);

  const received = await approvedRequisition(h, f, [formRow(y, 8, 1000)]);
  const order = await f.convert(received.id, [{ itemId: y.id, quantity: 8 }]);
  await f.deliver(order.docIds[0]);
  const before = await f.requisition(received.id);
  const overwrite = await h.put(`/api/procurement/requisitions/${received.id}`, { items: [{ itemId: y.id, itemName: y.name, requestedQty: 8 }] });
  const after = await f.requisition(received.id);
  if (overwrite.status !== 409) wrong.push(`edit of a received requisition: ${overwrite.status}`);
  const row = after.items[0];
  if (Number(row?.orderedQty) !== 8 || Number(row?.receivedQty) !== 8 || (row?.linkedDocumentIds ?? []).length !== 1 || after.total !== before.total) {
    wrong.push(`received rows after the edit attempt: ${JSON.stringify(row)}, total ${before.total} -> ${after.total}`);
  }
  return 'an unapproved requisition was edited by its stored row id with a before / after audit row; an approved or received requisition was refused with 409 and kept its ordered, received and linked rows';
}
