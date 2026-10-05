import { pool } from '../../db/drizzle.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { createTestItem } from '../fixtures/factories.js';
import { itemState } from './scenarioHelpers.js';
import { refusal } from './workflowScenarioHelpers.js';

/**
 * v8.0.90 — اقدام گردش‌کار درخواست خرید (حوزه G). هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
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
  await ProcurementService.executeWorkflowAction(id, 'receive_items', ADMIN);
  for (const action of ['reopen', 'reject_request', 'approve_request']) {
    const error = await refusal(() => ProcurementService.executeWorkflowAction(id, action, ADMIN));
    if (!error) problems.push(`اقدام «${action}» روی درخواستِ دریافت‌شده پذیرفته شد`);
    const after = await requisitionState(id);
    if (after.status !== 'received' || after.stateKey !== 'received') {
      problems.push(`پس از «${action}» درخواستِ دریافت‌شده «${after.status}» و گام «${after.stateKey}» شد`);
      break;
    }
  }
  // پس از بازگشایی میان‌بر، درخواست دوباره به سفارش تبدیل و کالا دوباره وارد انبار می‌شد
  const reorder = await refusal(() => ProcurementService.convertToPurchaseOrders({
    requisitionId: id,
    orderGroups: [{ supplierName: 'تامین‌کننده آزمون گردش‌کار', targetWarehouse: '', status: 'final', items: [{ itemId: item.id, quantity: 10, unitPrice: 1000 }] }],
  } as Parameters<typeof ProcurementService.convertToPurchaseOrders>[0], ADMIN));
  if (!reorder) problems.push('درخواستِ دریافت‌شده پس از بازگشایی دوباره به سفارش تبدیل شد');
  const { stock } = await itemState(item.id);
  if (stock !== 10) problems.push(`موجودی کالای درخواست ۱۰ عددی ${stock} است، نه ۱۰`);

  // درخواست ردشده با «تأیید» میان‌بر سفارش نمی‌شود؛ فقط «بازگشایی» دارد
  const rejected = await requisition(item.id, 5);
  await ProcurementService.executeWorkflowAction(rejected, 'reject_request', ADMIN);
  if (!(await refusal(() => ProcurementService.executeWorkflowAction(rejected, 'approve_request', ADMIN)))) problems.push('«تأیید» درخواستِ ردشده بی بازگشایی پذیرفته شد');
  const reopenError = await refusal(() => ProcurementService.executeWorkflowAction(rejected, 'reopen', ADMIN));
  if (reopenError) problems.push(`«بازگشایی» درخواستِ ردشده رد شد: ${reopenError}`);
  const reopened = await requisitionState(rejected);
  if (reopened.status !== 'pending' || reopened.stateKey !== 'pending') problems.push(`درخواستِ بازگشایی‌شده «${reopened.status}» و گام «${reopened.stateKey}» است`);
  return problems;
}
