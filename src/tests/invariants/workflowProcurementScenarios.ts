import { pool } from '../../db/drizzle.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { createTestItem } from '../fixtures/factories.js';
import { itemState } from './scenarioHelpers.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { legacyRequisitionOrder, refusal, refusalStatus, uniqueTag, wfUser } from './workflowScenarioHelpers.js';

/**
 * v8.0.99 — اقدام گردش‌کار درخواست خرید (حوزه G). هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const ADMIN = { username: 'wfg', role: 'admin', permissions: [] as string[] };

async function requisition(itemId: number, quantity: number): Promise<number> {
  const res = await pool.query<{ code: string; name: string }>('SELECT code, name FROM items WHERE id = $1', [itemId]);
  const req = await ProcurementService.createRequisition({
    title: 'درخواست آزمون گردش‌کار',
    items: [{ itemId, itemCode: res.rows[0]?.code, itemName: res.rows[0]?.name, unit: 'عدد', requestedQty: quantity, unitPriceEstimate: 1000 }],
  }, ADMIN);
  return req.id;
}

async function requisitionState(id: number): Promise<{ status: string; stateKey: string }> {
  const res = await pool.query<{ status: string; state_key: string }>(
    `SELECT r.status, s."stateKey" AS state_key FROM purchase_requisitions r
       JOIN workflow_instances i ON i.id = r.workflow_instance_id
       LEFT JOIN LATERAL jsonb_to_recordset(i.snapshot_dsl->'states') AS s(id int, "stateKey" text) ON s.id = i.current_state_id
      WHERE r.id = $1`, [id]);
  return { status: res.rows[0]?.status ?? '', stateKey: res.rows[0]?.state_key ?? '' };
}

/**
 * TD-379: اقدام گردش‌کار درخواست خرید فقط انتقال گردش‌کار از گام جاری را اجرا می‌کند. پیش‌تر اقدامی که انتقالی از گام جاری
 * نداشت با «میان‌بر» وضعیت درخواست را مستقیم عوض می‌کرد: «بازگشایی» درخواستِ دریافت‌شده آن را «در انتظار» می‌کرد و دریافت
 * دوباره کالا را دوباره وارد انبار می‌کرد، و «دریافت کالا» درخواستِ تأییدنشده گام تأیید را می‌پرید.
 */
export async function checkRequisitionActionFollowsWorkflow(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const id = await requisition(item.id, 10);
  await ProcurementService.executeWorkflowAction(id, 'approve_request', ADMIN);
  // v9.0.350 (TD-699، ت۴): «دریافت کالا» فقط ردیف سفارش‌شده را می‌پذیرد
  await ProcurementService.convertToPurchaseOrders({
    requisitionId: id,
    orderGroups: [{ supplierName: 'تامین‌کننده آزمون گردش‌کار', targetWarehouse: '', status: 'draft', items: [{ itemId: item.id, quantity: 10, unitPrice: 1000 }] }],
  } as Parameters<typeof ProcurementService.convertToPurchaseOrders>[0], ADMIN);
  await ProcurementService.executeWorkflowAction(id, 'receive_items', ADMIN);
  for (const action of ['reopen', 'reject_request', 'approve_request']) {
    const error = await refusal(() => ProcurementService.executeWorkflowAction(id, action, ADMIN));
    if (!error) problems.push(`Action "${action}" on a received requisition was accepted`);
    const after = await requisitionState(id);
    if (after.status !== 'received' || after.stateKey !== 'received') {
      problems.push(`After "${action}" the received requisition became "${after.status}" and the step "${after.stateKey}"`);
      break;
    }
  }
  // پس از بازگشایی میان‌بر، درخواست دوباره به سفارش تبدیل و کالا دوباره وارد انبار می‌شد
  const reorder = await refusal(() => ProcurementService.convertToPurchaseOrders({
    requisitionId: id,
    orderGroups: [{ supplierName: 'تامین‌کننده آزمون گردش‌کار', targetWarehouse: '', status: 'final', items: [{ itemId: item.id, quantity: 10, unitPrice: 1000 }] }],
  } as Parameters<typeof ProcurementService.convertToPurchaseOrders>[0], ADMIN));
  if (!reorder) problems.push('The received requisition was converted to an order again after reopening');
  const { stock } = await itemState(item.id);
  if (stock !== 10) problems.push(`Stock of the item of the 10-unit requisition is ${stock}, not 10`);

  // درخواست ردشده با «تأیید» میان‌بر سفارش نمی‌شود؛ فقط «بازگشایی» دارد
  const rejected = await requisition(item.id, 5);
  await ProcurementService.executeWorkflowAction(rejected, 'reject_request', ADMIN);
  if (!(await refusal(() => ProcurementService.executeWorkflowAction(rejected, 'approve_request', ADMIN)))) problems.push('"Approve" on a rejected requisition without reopening was accepted');
  const reopenError = await refusal(() => ProcurementService.executeWorkflowAction(rejected, 'reopen', ADMIN));
  if (reopenError) problems.push(`"Reopen" of the rejected requisition was refused: ${reopenError}`);
  const reopened = await requisitionState(rejected);
  if (reopened.status !== 'pending' || reopened.stateKey !== 'pending') problems.push(`The reopened requisition is "${reopened.status}" and the step "${reopened.stateKey}"`);
  return problems;
}

/** نمونه گردش‌کار درخواست را از پیش می‌سازد (مانند ساخت تنبل اقدام نخست) تا آزمون تصویر نسخه‌اش را تغییر دهد */
async function startRequisitionWorkflow(requisitionId: number): Promise<number> {
  const instance = await WorkflowTransitionExecutor.startInstance({
    workflowCode: 'PURCHASE_REQUISITION_WORKFLOW', entityType: 'purchase_requisition', entityId: String(requisitionId),
  });
  await pool.query('UPDATE purchase_requisitions SET workflow_instance_id = $2 WHERE id = $1', [requisitionId, instance.id]);
  return instance.id;
}

/**
 * TD-390 (تصمیم مالک محصول «تأیید با نام او»): «دریافت کالا»ی درخواستِ تأییدنشده نخست انتقال تأیید را به نام دریافت‌کننده
 * اجرا می‌کند و در تاریخچه ثبت می‌کند؛ دریافت‌کننده‌ای که اجازه تأیید ندارد رد می‌شود و کالایی وارد انبار نمی‌شود.
 * پیش‌تر گام تأیید بی امضا و بی ثبت رد می‌شد.
 */
export async function checkReceiveApprovesInReceiverName(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const receiver = await wfUser(`wfg_store_${uniqueTag()}`, []);
  const asReceiver = { id: receiver.id, username: receiver.name, role: receiver.role, permissions: [] as string[] };

  const id = await requisition(item.id, 4);
  const instanceId = await startRequisitionWorkflow(id);
  await legacyRequisitionOrder(id, item.id, 4);
  const error = await refusal(() => ProcurementService.executeWorkflowAction(id, 'receive_items', asReceiver));
  if (error) return [`دریافت درخواستِ تأییدنشده با گام تأیید بی‌نقش رد شد: ${error}`];
  const history = await pool.query<{ action_key: string; performed_by: number | null }>(
    'SELECT action_key, performed_by FROM workflow_history_logs WHERE instance_id = $1 ORDER BY id', [instanceId]);
  const approval = history.rows.find(r => r.action_key === 'approve_request');
  if (!approval) problems.push(`the requisition approval at receipt was not recorded in the history (${history.rows.map(r => r.action_key).join(', ') || 'empty'})`);
  else if (approval.performed_by !== receiver.id) problems.push(`The approval at receipt was recorded in the name of user #${approval.performed_by ?? '-'}, not the receiver`);
  if ((await requisitionState(id)).status !== 'received') problems.push('The requisition did not become "received" after approval and receipt');
  if ((await itemState(item.id)).stock !== 4) problems.push('The items of the requisition approved at receipt did not enter the warehouse');

  // گام تأییدی که نقش مدیر می‌خواهد: دریافت‌کننده بی آن نقش رد می‌شود و کالایی وارد انبار نمی‌شود
  const guarded = await requisition(item.id, 6);
  const guardedInstance = await startRequisitionWorkflow(guarded);
  await legacyRequisitionOrder(guarded, item.id, 6);
  const snap = await pool.query<{ snapshot_dsl: { transitions: Array<{ actionKey: string; requiredRole?: string }> } }>(
    'SELECT snapshot_dsl FROM workflow_instances WHERE id = $1', [guardedInstance]);
  const dsl = snap.rows[0].snapshot_dsl;
  for (const t of dsl.transitions) if (t.actionKey === 'approve_request') t.requiredRole = 'manager';
  await pool.query('UPDATE workflow_instances SET snapshot_dsl = $2 WHERE id = $1', [guardedInstance, JSON.stringify(dsl)]);
  const status = await refusalStatus(() => ProcurementService.executeWorkflowAction(guarded, 'receive_items', asReceiver));
  if (status !== 403) problems.push(`receiving an unapproved requisition by a user without the approving role ${status === null ? 'was accepted' : `was refused with code ${status}`}, not 403`);
  const after = await requisitionState(guarded);
  if (after.status !== 'pending' || after.stateKey !== 'pending') problems.push(`After the refused receipt the requisition is "${after.status}" and the step "${after.stateKey}"`);
  if ((await itemState(item.id)).stock !== 4) problems.push('The items of the unapproved requisition entered the warehouse without approval rights');
  return problems;
}
