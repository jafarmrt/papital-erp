import { eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { appSettings, documentItems } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { getEntityContext, WorkflowRuleEngine } from '../../services/workflow/workflowDslParser.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { createTestDocument, createTestItem } from '../fixtures/factories.js';
import { legacyRequisitionOrder, refusalStatus } from './workflowScenarioHelpers.js';
import type { RuleExpression } from '../../services/ruleEngine.service.js';

/**
 * مشاهده‌های ممیزی حوزه G (TD-404، TD-405). هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const ADMIN = { username: 'wfobs', role: 'admin', permissions: [] as string[] };

const rulePasses = (field: string, operator: string, value: number, context: Record<string, unknown>): boolean =>
  WorkflowRuleEngine.evaluateConditions({ field, operator, value } as RuleExpression, context);

/**
 * TD-404: قاعده مبلغ گردش‌کار سند مبلغ قابل پرداخت ریالی را می‌سنجد (خالص اقلام فعال + مالیات + هزینه خدمات، تسعیرشده).
 * پیش‌تر خالص اقلام ارزی بی مالیات و بی تسعیر سنجیده می‌شد و ردیف حذف‌شده هم شمرده می‌شد.
 */
export async function checkWorkflowDocumentAmountInRials(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ stocks: {}, weightedAverageCost: 0 });

  // فاکتور ۱۰۰ دلاری با نرخ ۵۰۰٬۰۰۰ و ۱۰ دلار مالیات: ۵۵٬۰۰۰٬۰۰۰ ریال
  const usd = await createTestDocument({ status: 'draft', currency: 'USD', exchangeRate: money(500000), vatAmount: money(10) }, [{ itemId: item.id, quantity: 2, unitPrice: 50 }]);
  const usdContext = await getEntityContext('document', String(usd.document.id));
  if (Number(usdContext.amount) !== 55_000_000) problems.push(`amount of a 110 dollar invoice at rate 500,000 became ${String(usdContext.amount)}, not 55,000,000 rial`);
  if (!rulePasses('amount', 'gt', 10_000_000, usdContext)) problems.push('a 55 million rial invoice did not pass the condition "amount greater than 10 million rial"');

  // فاکتور ریالی: خالص ۱٬۰۰۰٬۰۰۰، مالیات ۱۰۰٬۰۰۰، هزینه ارسال ۵۰٬۰۰۰؛ ردیف حذف‌شده شمرده نمی‌شود
  const irr = await createTestDocument({ status: 'draft', vatAmount: money(100000), serviceChargeAmount: money(50000) },
    [{ itemId: item.id, quantity: 1, unitPrice: 1_000_000 }, { itemId: item.id, quantity: 1, unitPrice: 9_000_000 }]);
  const lines = await orm.select({ id: documentItems.id, unitPrice: documentItems.unitPrice }).from(documentItems).where(eq(documentItems.documentId, irr.document.id));
  const removed = lines.find(l => money(l.unitPrice ?? 0).equals(9_000_000));
  if (removed) await orm.update(documentItems).set({ isDeleted: 1 }).where(eq(documentItems.id, removed.id));
  const irrContext = await getEntityContext('document', String(irr.document.id));
  if (Number(irrContext.amount) !== 1_150_000) problems.push(`amount of a rial invoice with tax and shipping became ${String(irrContext.amount)}, not 1,150,000`);

  // سند ارزی بی نرخ (نه روی سند، نه در تنظیمات): مبلغ ریالی نامعلوم است و هیچ شرط مبلغی نمی‌گذرد
  const currency = 'XTS';
  await orm.delete(appSettings).where(eq(appSettings.key, `exchange_rate_${currency.toLowerCase()}`));
  const noRate = await createTestDocument({ status: 'draft', currency }, [{ itemId: item.id, quantity: 1, unitPrice: 100 }]);
  const noRateContext = await getEntityContext('document', String(noRate.document.id));
  for (const [op, value] of [['lte', 1_000_000_000], ['lt', 1_000_000_000], ['gt', 0], ['gte', 0]] as const) {
    if (rulePasses('amount', op, value, noRateContext)) problems.push(`a foreign-currency document without a rate passed the condition "amount ${op} ${value}" (amount ${String(noRateContext.amount)})`);
  }
  return problems;
}

async function requisitionWithWorkflow(itemId: number, quantity: number): Promise<{ id: number; instanceId: number }> {
  const res = await pool.query<{ code: string; name: string }>('SELECT code, name FROM items WHERE id = $1', [itemId]);
  const req = await ProcurementService.createRequisition({
    title: 'درخواست آزمون همگامی گام',
    items: [{ itemId, itemCode: res.rows[0]?.code, itemName: res.rows[0]?.name, unit: 'عدد', requestedQty: quantity, unitPriceEstimate: 1000 }],
  }, ADMIN);
  const instance = await WorkflowTransitionExecutor.startInstance({
    workflowCode: 'PURCHASE_REQUISITION_WORKFLOW', entityType: 'purchase_requisition', entityId: String(req.id),
  });
  await pool.query('UPDATE purchase_requisitions SET workflow_instance_id = $2 WHERE id = $1', [req.id, instance.id]);
  return { id: req.id, instanceId: instance.id };
}

async function stepHistory(instanceId: number): Promise<Array<{ from: number | null; to: number | null; action: string }>> {
  const res = await pool.query<{ from_state_id: number | null; to_state_id: number | null; action_key: string }>(
    'SELECT from_state_id, to_state_id, action_key FROM workflow_history_logs WHERE instance_id = $1 ORDER BY id', [instanceId]);
  return res.rows.map(r => ({ from: r.from_state_id, to: r.to_state_id, action: r.action_key }));
}

async function currentStep(instanceId: number): Promise<number | null> {
  const res = await pool.query<{ current_state_id: number | null }>('SELECT current_state_id FROM workflow_instances WHERE id = $1', [instanceId]);
  return res.rows[0]?.current_state_id ?? null;
}

/**
 * TD-405: اقدام گردش‌کار درخواست خرید گام نمونه را از وضعیت درخواست بازنویسی نمی‌کند. هر جابه‌جایی گام در تاریخچه
 * ثبت است (گام آغاز هر ردیف همان گام پایان ردیف پیشین)، و درخواستِ دریافت‌شده با گامِ ناهم‌خوان اقدامی نمی‌پذیرد و گامش
 * دست نمی‌خورد. پیش‌تر «خودترمیمی» گام را بی انتقال و بی تاریخچه به گام هم‌نام وضعیت می‌برد.
 */
export async function checkRequisitionStepNotRewritten(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });

  // وضعیت «سفارش‌شده» از مسیری بیرون از گردش‌کار، گام هنوز «در انتظار»
  const ordered = await requisitionWithWorkflow(item.id, 3);
  await pool.query(`UPDATE purchase_requisitions SET status = 'ordered' WHERE id = $1`, [ordered.id]);
  await legacyRequisitionOrder(ordered.id, item.id, 3);
  await ProcurementService.executeWorkflowAction(ordered.id, 'receive_items', ADMIN);
  const history = await stepHistory(ordered.instanceId);
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const row = history[i];
    if (row.from !== null && row.from !== prev.to) {
      problems.push(`workflow step changed without a history row: "${prev.action}" reached step #${prev.to ?? '-'} and "${row.action}" ran from step #${row.from}`);
    }
  }
  if (!history.some(r => r.action === 'approve_request')) problems.push(`the requisition approval before receipt is missing from the history (${history.map(r => r.action).join(', ')})`);

  // وضعیت «دریافت‌شده» با گامِ «در انتظار»: هیچ اقدامی پذیرفته نمی‌شود و گام بی تاریخچه جابه‌جا نمی‌شود
  const received = await requisitionWithWorkflow(item.id, 2);
  await pool.query(`UPDATE purchase_requisitions SET status = 'received' WHERE id = $1`, [received.id]);
  const stepBefore = await currentStep(received.instanceId);
  const historyBefore = (await stepHistory(received.instanceId)).length;
  for (const action of ['reject_request', 'approve_request']) {
    const status = await refusalStatus(() => ProcurementService.executeWorkflowAction(received.id, action, ADMIN));
    if (status !== 409) problems.push(`action "${action}" on a received requisition ${status === null ? 'was accepted' : `was refused with code ${status}`}, not 409`);
  }
  if ((await currentStep(received.instanceId)) !== stepBefore) problems.push('step of the received requisition was overwritten without a transition');
  if ((await stepHistory(received.instanceId)).length !== historyBefore) problems.push('the refused action on the received requisition added a history row');
  return problems;
}
