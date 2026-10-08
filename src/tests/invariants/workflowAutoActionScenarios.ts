import { orm, pool } from '../../db/drizzle.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { DocumentService } from '../../services/document.service.js';
import { domainEventBus } from '../../services/events/domainEventBus.js';
import type { BaseDomainEvent } from '../../services/events/domainEvents.js';
import { getDefaultWarehouseCode } from '../../services/inventory/warehouseResolver.js';
import { ProcurementService } from '../../services/procurement.service.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { createTestItem, createTestUser, createTestVoucher, createTestWorkflow } from '../fixtures/factories.js';
import { itemState, receive } from './scenarioHelpers.js';
import { refusal } from './workflowScenarioHelpers.js';

/**
 * v9.0.2 (TD-415، یافته A02-01) — اقدام خودکار پس از انتقال گردش‌کار در همان تراکنش انتقال. هر تابع فهرست مشکلات را
 * برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const ADMIN = { username: 'wf415', role: 'admin', permissions: [] as string[] };
/** سال جلالی بسته‌ای که سفارش ماندهٔ آزمون در آن تاریخ دارد (۱۳۹۰/۰۳/۱۱) */
const CLOSED_YEAR = 1390;
const CLOSED_YEAR_DATE = '2011-06-01 10:00:00';

/** پیش از v9.0.2 شنونده‌های گردش‌کار پس از پاسخ، روی اتصال جدای استخر کار می‌کردند؛ این مکث فرصت آن کار را می‌دهد */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 1500));

async function requisition(lines: Array<[number, number]>): Promise<number> {
  const rows = await pool.query<{ id: number; code: string; name: string }>('SELECT id, code, name FROM items WHERE id = ANY($1::int[])', [lines.map(([id]) => id)]);
  const byId = new Map(rows.rows.map(r => [r.id, r]));
  const req = await ProcurementService.createRequisition({
    title: 'درخواست آزمون اقدام خودکار گردش‌کار',
    items: lines.map(([itemId, requestedQty]) => ({
      itemId, itemCode: byId.get(itemId)?.code, itemName: byId.get(itemId)?.name, unit: 'عدد', requestedQty, unitPriceEstimate: 1000,
    })),
  }, ADMIN);
  return req.id;
}

async function draftOrders(requisitionId: number, groups: Array<Array<[number, number]>>): Promise<number[]> {
  const { createdDocuments } = await ProcurementService.convertToPurchaseOrders({
    requisitionId,
    orderGroups: groups.map((lines, i) => ({
      supplierName: `تامین‌کننده آزمون اقدام خودکار ${i + 1}`, targetWarehouse: '', status: 'draft',
      items: lines.map(([itemId, quantity]) => ({ itemId, quantity, unitPrice: 1000 })),
    })),
  } as Parameters<typeof ProcurementService.convertToPurchaseOrders>[0], ADMIN);
  return createdDocuments.map(d => d.id).sort((a, b) => a - b);
}

async function requisitionState(id: number): Promise<{ status: string; stateKey: string; instanceId: number }> {
  const res = await pool.query<{ status: string; state_key: string; instance_id: number }>(
    `SELECT r.status, s."stateKey" AS state_key, i.id AS instance_id FROM purchase_requisitions r
       JOIN workflow_instances i ON i.id = r.workflow_instance_id
       LEFT JOIN LATERAL jsonb_to_recordset(i.snapshot_dsl->'states') AS s(id int, "stateKey" text) ON s.id = i.current_state_id
      WHERE r.id = $1`, [id]);
  return { status: res.rows[0]?.status ?? '', stateKey: res.rows[0]?.state_key ?? '', instanceId: res.rows[0]?.instance_id ?? 0 };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const res = await pool.query<{ n: number }>(sql, params);
  return Number(res.rows[0]?.n ?? 0);
}

const documentStatus = async (id: number) => (await pool.query<{ status: string }>('SELECT status FROM documents WHERE id = $1', [id])).rows[0]?.status ?? '';
const kardexRows = (itemId: number) => count('SELECT count(*)::int AS n FROM transactions WHERE item_id = $1 AND is_deleted = 0', [itemId]);
const documentVouchers = (documentId: number) => count('SELECT count(*)::int AS n FROM journal_vouchers WHERE source_document_id = $1 AND is_deleted = 0', [documentId]);

/** رویدادهای گردش‌کاری که درون همین فرایند (نه از outbox) برای یک نمونه منتشر می‌شوند */
async function inProcessWorkflowEvents<T>(instanceId: number, run: () => Promise<T>): Promise<{ result: T; events: string[] }> {
  const events: string[] = [];
  const probe = (event: BaseDomainEvent) => {
    const payload = event.payload as { instanceId?: unknown } | undefined;
    if (String(event.eventType).startsWith('Workflow') && Number(payload?.instanceId) === instanceId) events.push(String(event.eventType));
  };
  domainEventBus.on('*', probe);
  try {
    const result = await run();
    await settle();
    return { result, events };
  } finally {
    domainEventBus.off('*', probe);
  }
}

/** سال جلالی را بسته علامت می‌زند و تابعی برمی‌گرداند که وضعیت پیشین آن را برمی‌گرداند */
async function closeFiscalYear(year: number): Promise<() => Promise<void>> {
  const before = await pool.query<{ status: string }>('SELECT status FROM fiscal_periods WHERE fiscal_year = $1', [year]);
  await pool.query(`INSERT INTO fiscal_periods (fiscal_year, status, closed_by) VALUES ($1, 'closed', 'wf415')
    ON CONFLICT (fiscal_year) DO UPDATE SET status = 'closed'`, [year]);
  return async () => {
    if (before.rows.length === 0) await pool.query('DELETE FROM fiscal_periods WHERE fiscal_year = $1', [year]);
    else await pool.query('UPDATE fiscal_periods SET status = $2 WHERE fiscal_year = $1', [year, before.rows[0].status]);
  };
}

/**
 * سناریوی R گزارش معماری: «دریافت کالا»ی درخواستی با دو سفارش پیش‌نویس که سفارش دوم در سال مالی بسته مانده است. اقدام
 * رد و کامل برگشت می‌خورد. پیش‌تر شنونده گردش‌کار که پیش از commit پرتاب شده بود پس از برگشت سفارش اول را جدا قطعی
 * می‌کرد: ۱۰ واحد وارد انبار می‌شد، ردیف کاردکس و سند خرید ساخته و درخواست «دریافت‌شده» می‌شد، و گام گردش‌کار «سفارش‌شده» می‌ماند.
 */
export async function checkRefusedReceiveLeavesNoTrace(): Promise<string[]> {
  const problems: string[] = [];
  const x = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const y = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const reqId = await requisition([[x.id, 10], [y.id, 5]]);
  await ProcurementService.executeWorkflowAction(reqId, 'approve_request', ADMIN);
  const [orderA, orderB] = await draftOrders(reqId, [[[x.id, 10]], [[y.id, 5]]]);
  await pool.query('UPDATE documents SET date = $2 WHERE id = $1', [orderB, CLOSED_YEAR_DATE]);

  const reopen = await closeFiscalYear(CLOSED_YEAR);
  try {
    const error = await refusal(() => ProcurementService.executeWorkflowAction(reqId, 'receive_items', ADMIN));
    await settle();
    if (!error) problems.push(`"Receive goods" with an order left in the closed fiscal year ${CLOSED_YEAR} was accepted`);
    const after = await requisitionState(reqId);
    if (after.status !== 'ordered' || after.stateKey !== 'ordered') problems.push(`After the refused receipt the requisition is "${after.status}" and the step "${after.stateKey}", not "ordered"`);
    for (const [label, id] of [['اول', orderA], ['دوم', orderB]] as const) {
      const status = await documentStatus(id);
      if (status !== 'draft') problems.push(`Order ${label} became "${status}" after the refused receipt`);
    }
    const { stock } = await itemState(x.id);
    if (stock !== 0) problems.push(`The item of the first order got ${stock} units of stock after the refused receipt`);
    const kardex = await kardexRows(x.id);
    if (kardex !== 0) problems.push(`The item of the first order has ${kardex} Kardex rows after the refused receipt`);
    const vouchers = await documentVouchers(orderA);
    if (vouchers !== 0) problems.push(`The first order has ${vouchers} journal vouchers after the refused receipt`);
  } finally {
    await reopen();
  }
  return problems;
}

/**
 * سازوکار: انتقالی که تراکنشش برمی‌گردد هیچ اثری بیرون نمی‌گذارد (وضعیت درخواست، لاگ فعالیت، انتشار درون‌فرایندی)، و
 * انتقالِ ثبت‌شده فقط یک بار و فقط از outbox منتشر می‌شود. پیش‌تر پل workflowEventBus همان انتقال را پیش از commit و حتی
 * برای انتقالِ برگشت‌خورده درون‌فرایندی هم منتشر می‌کرد و شنونده وضعیت درخواست و لاگ را با اتصال جدا می‌نوشت.
 */
export async function checkTransitionEffectsFollowCommit(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const reqId = await requisition([[item.id, 3]]);
  const { instanceId } = await requisitionState(reqId);
  if (!instanceId) return ['درخواست خرید تازه نمونه گردش‌کار ندارد'];
  const snap = await pool.query<{ current_state_id: number; snapshot_dsl: { transitions?: Array<{ id: number; fromStateId: number; actionKey: string }> } }>(
    'SELECT current_state_id, snapshot_dsl FROM workflow_instances WHERE id = $1', [instanceId]);
  const approve = snap.rows[0]?.snapshot_dsl?.transitions?.find(t => t.actionKey === 'approve_request' && t.fromStateId === snap.rows[0].current_state_id);
  if (!approve) return ['انتقال «approve_request» از گام جاری درخواست پیدا نشد'];
  const auditRows = () => count(`SELECT count(*)::int AS n FROM activity_logs WHERE details->'changes'->>'instanceId' = $1`, [String(instanceId)]);
  const outboxRows = () => count(`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'WorkflowTransitioned' AND payload->>'instanceId' = $1`, [String(instanceId)]);

  const rolledBack = await inProcessWorkflowEvents(instanceId, () => refusal(() => orm.transaction(async (tx) => {
    await WorkflowTransitionExecutor.executeTransition({
      instanceId, transitionId: approve.id, userName: ADMIN.username, userRole: ADMIN.role, userPermissions: [], tx,
    });
    throw new Error('Intentional test transaction rollback');
  })));
  if (!rolledBack.result) problems.push('The test transaction did not roll back');
  const afterRollback = await requisitionState(reqId);
  if (afterRollback.status !== 'pending' || afterRollback.stateKey !== 'pending') problems.push(`After the rolled-back transition the requisition is "${afterRollback.status}" and the step "${afterRollback.stateKey}", not "pending"`);
  if (await auditRows() !== 0) problems.push('The rolled-back transition left a workflow activity log');
  if (await outboxRows() !== 0) problems.push('The rolled-back transition left an outbox row');
  if (rolledBack.events.length > 0) problems.push(`the rolled-back transition was published in-process (${rolledBack.events.join(', ')})`);

  const committed = await inProcessWorkflowEvents(instanceId, () => ProcurementService.executeWorkflowAction(reqId, 'approve_request', ADMIN));
  const afterCommit = await requisitionState(reqId);
  if (afterCommit.status !== 'ordered' || afterCommit.stateKey !== 'ordered') problems.push(`After approval the requisition is "${afterCommit.status}" and the step "${afterCommit.stateKey}", not "ordered"`);
  const outbox = await outboxRows();
  if (outbox !== 1) problems.push(`The committed transition has ${outbox} WorkflowTransitioned outbox rows, not 1`);
  if (committed.events.length > 0) problems.push(`the committed transition was also published in-process, apart from the outbox (${committed.events.join(', ')})`);
  const audits = await auditRows();
  if (audits !== 1) problems.push(`The committed transition has ${audits} workflow activity logs, not 1`);
  return problems;
}

/**
 * تأیید نهایی گردش‌کار سند، سند را در همان تراکنش قطعی می‌کند. قطعی‌سازیِ ناممکن (کسری موجودی) تأیید را با همان خطا رد می‌کند و
 * گام و سند دست نمی‌خورند؛ پیش‌تر تأیید «گذشت»، خطای قطعی‌سازی فقط در لاگ سرور آمد و سند پیش‌نویس ماند.
 */
export async function checkDocumentApprovalFinalizesInTransaction(): Promise<string[]> {
  const problems: string[] = [];
  const wh = await getDefaultWarehouseCode(orm);
  if (!wh) return ['انبار پیش‌فرض فعالی نیست'];
  const today = await businessTodayIsoDate();
  const item = await createTestItem({ type: 'product', stocks: {}, weightedAverageCost: 0 });
  await receive(item.id, 2, 100000, wh, today);
  const user = await createTestUser({ role: 'admin' });
  const wf = await createTestWorkflow({
    states: [{ key: 'draft', title: 'پیش‌نویس', type: 'initial' }, { key: 'approved', title: 'تأییدشده', type: 'terminal' }],
    transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_wf415', title: 'تأیید نهایی' }],
  });
  const approveDraft = async (quantity: number) => {
    const docId = await DocumentService.createDocument({
      docType: 'invoice', inOut: 'out', status: 'draft', date: today, user: 'wf415', buyerName: 'مشتری آزمون اقدام خودکار',
      items: [{ itemId: item.id, quantity, unitPrice: 250000, location: wh }],
    });
    const instance = await WorkflowTransitionExecutor.startInstance({
      workflowDefinitionId: wf.definition.id, entityType: 'document', entityId: String(docId), userId: user.id, userName: user.username,
    });
    const error = await refusal(() => WorkflowTransitionExecutor.executeTransition({
      instanceId: instance.id, transitionId: wf.transitions[0].id, userId: user.id, userName: user.username, userRole: 'admin', userPermissions: ['*'],
    }));
    return { docId, instanceId: instance.id, error };
  };
  const instanceStatus = async (id: number) => (await pool.query<{ status: string }>('SELECT status FROM workflow_instances WHERE id = $1', [id])).rows[0]?.status ?? '';

  const short = await approveDraft(5);
  await settle();
  if (!short.error) problems.push('Final approval of an invoice whose item stock is insufficient was accepted');
  const shortInstance = await instanceStatus(short.instanceId);
  if (shortInstance !== 'IN_PROGRESS') problems.push(`The workflow of the non-finalized invoice became "${shortInstance}"`);
  if (await documentStatus(short.docId) !== 'draft') problems.push('The invoice whose approval was refused did not stay draft');
  if ((await itemState(item.id)).stock !== 2) problems.push('Item stock changed after the refused approval');

  const ok = await approveDraft(1);
  if (ok.error) problems.push(`Final approval of an invoice with enough stock was refused: ${ok.error}`);
  else {
    // بی‌درنگ پس از پاسخ: قطعی‌سازی جزء همان تراکنش است، نه کاری که بعداً برسد
    if (await documentStatus(ok.docId) !== 'final') problems.push('The invoice is not yet final in the final approval response');
    if ((await itemState(item.id)).stock !== 1) problems.push('Item stock did not decrease in the final approval response');
    if (await documentVouchers(ok.docId) !== 1) problems.push('The invoice has no journal voucher in the final approval response');
  }
  return problems;
}

/**
 * تأیید گردش‌کار سند حسابداری وضعیت آن را در همان تراکنش عوض می‌کند و تغییرِ ناممکن (سند دائم) تأیید را رد می‌کند؛ پیش‌تر
 * تأیید می‌گذشت و خطا فقط در لاگ سرور می‌آمد.
 */
export async function checkVoucherApprovalRefusedWhenStatusCannotChange(): Promise<string[]> {
  const problems: string[] = [];
  const { voucher } = await createTestVoucher({ status: 'permanent' });
  const user = await createTestUser({ role: 'admin' });
  const wf = await createTestWorkflow({
    definition: { entityType: 'journal_voucher' },
    states: [{ key: 'draft', title: 'پیش‌نویس', type: 'initial' }, { key: 'approved', title: 'تأییدشده', type: 'normal' }],
    transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_wf415', title: 'تأیید سند' }],
  });
  const instance = await WorkflowTransitionExecutor.startInstance({
    workflowDefinitionId: wf.definition.id, entityType: 'journal_voucher', entityId: String(voucher.id), userId: user.id, userName: user.username,
  });
  const error = await refusal(() => WorkflowTransitionExecutor.executeTransition({
    instanceId: instance.id, transitionId: wf.transitions[0].id, userId: user.id, userName: user.username, userRole: 'admin', userPermissions: ['*'],
  }));
  await settle();
  if (!error) problems.push('Workflow approval of a permanent journal voucher was accepted');
  const row = await pool.query<{ current_state_id: number }>('SELECT current_state_id FROM workflow_instances WHERE id = $1', [instance.id]);
  if (row.rows[0]?.current_state_id !== wf.states.draft.id) problems.push('The workflow step of the permanent voucher moved after the refused approval');
  const status = (await pool.query<{ status: string }>('SELECT status FROM journal_vouchers WHERE id = $1', [voucher.id])).rows[0]?.status;
  if (status !== 'permanent') problems.push(`The permanent journal voucher became "${status}"`);
  return problems;
}

/**
 * تأیید نهایی گردش‌کار کالا و حساب خزانه سند افتتاحیه را در همان تراکنش انتقال صادر می‌کند: انتقالِ برگشت‌خورده سندی
 * نمی‌گذارد، انتقالِ ثبت‌شده سند را در پاسخ دارد، و صدورِ ناممکن (حساب خزانه با مانده اول دوره و بی سرفصل معین) تأیید را رد
 * می‌کند. پیش‌تر شنونده بیرون از تراکنش سند کالای انتقالِ برگشت‌خورده را هم صادر می‌کرد و خطای خزانه را می‌بلعید.
 */
export async function checkOpeningApprovalsFollowTransaction(): Promise<string[]> {
  const problems: string[] = [];
  const user = await createTestUser({ role: 'admin' });
  const approvalWorkflow = (entityType: string) => createTestWorkflow({
    definition: { entityType },
    states: [{ key: 'draft', title: 'پیش‌نویس', type: 'initial' }, { key: 'approved', title: 'تأییدشده', type: 'terminal' }],
    transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_wf415', title: 'تأیید نهایی' }],
  });
  const approve = (instanceId: number, transitionId: number, tx?: Parameters<Parameters<typeof orm.transaction>[0]>[0]) =>
    WorkflowTransitionExecutor.executeTransition({
      instanceId, transitionId, userId: user.id, userName: user.username, userRole: 'admin', userPermissions: ['*'], tx,
    });
  const stateOf = async (id: number) => (await pool.query<{ current_state_id: number }>('SELECT current_state_id FROM workflow_instances WHERE id = $1', [id])).rows[0]?.current_state_id;

  // کالا با موجودی افتتاحیه ۱۰۰ × ۵۰٬۰۰۰ در کاردکس، بی سند افتتاحیه (v9.0.93، TD-481: ارزش سند از ردیف افتتاحیه کاردکس است)
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  await orm.transaction(async (tx) => DocumentService.applyStockMovement(tx, {
    itemId: item.id, inOut: 'in', quantity: 100, price: 50000, date: await businessTodayIsoDate(), documentType: 'audit',
    documentRef: 'ثبت اولیه کالا', user: 'wf415', targetLoc: (await getDefaultWarehouseCode(orm)) as string, notes: 'موجودی اولیه هنگام تعریف کالا',
  }));
  const itemOpenings = () => count(`SELECT count(*)::int AS n FROM journal_vouchers WHERE reference_module = 'item_opening' AND reference_id = $1 AND is_deleted = 0`, [item.id]);
  const itemWf = await approvalWorkflow('item');
  const itemInstance = await WorkflowTransitionExecutor.startInstance({
    workflowDefinitionId: itemWf.definition.id, entityType: 'item', entityId: String(item.id), userId: user.id, userName: user.username,
  });
  const rolledBack = await refusal(() => orm.transaction(async (tx) => {
    await approve(itemInstance.id, itemWf.transitions[0].id, tx);
    throw new Error('Intentional test transaction rollback');
  }));
  await settle();
  if (!rolledBack) problems.push('The test transaction did not roll back');
  const afterRollback = await itemOpenings();
  if (afterRollback !== 0) problems.push(`The rolled-back item approval left ${afterRollback} opening vouchers`);
  const approved = await refusal(() => approve(itemInstance.id, itemWf.transitions[0].id));
  if (approved) problems.push(`Final item approval was refused: ${approved}`);
  else {
    // بی‌درنگ پس از پاسخ: صدور جزء همان تراکنش است
    const afterCommit = await itemOpenings();
    if (afterCommit !== 1) problems.push(`The item has ${afterCommit} opening vouchers in the final approval response, not 1`);
  }

  const bank = await pool.query<{ id: number }>(
    `INSERT INTO bank_accounts (code, title, initial_balance, current_balance, currency) VALUES ($1, $2, 500000, 500000, 'IRR') RETURNING id`,
    [`WF415-${item.id}`, 'صندوق آزمون اقدام خودکار بی سرفصل']);
  const bankId = bank.rows[0].id;
  const bankWf = await approvalWorkflow('bank_account');
  const bankInstance = await WorkflowTransitionExecutor.startInstance({
    workflowDefinitionId: bankWf.definition.id, entityType: 'bank_account', entityId: String(bankId), userId: user.id, userName: user.username,
  });
  const bankError = await refusal(() => approve(bankInstance.id, bankWf.transitions[0].id));
  await settle();
  if (!bankError) problems.push('Approval of a treasury account with an opening balance but no subsidiary ledger account was accepted');
  if (await stateOf(bankInstance.id) !== bankWf.states.draft.id) problems.push('The treasury account workflow step moved after the refused approval');
  return problems;
}

/**
 * تحویل سفارش به انبار بی شناسه کاربر، گام «دریافت‌شده» و لاگ تحویل را به نام کاربر شماره ۱ ثبت نمی‌کند؛ پیش‌تر شناسه
 * جایگزین ۱ تأیید و لاگ را به کاربر دیگری نسبت می‌داد (یا اگر آن کاربر نبود، درج شکست می‌خورد).
 */
export async function checkDeliveryWithoutUserIdNotAttributedToUserOne(): Promise<string[]> {
  const problems: string[] = [];
  const item = await createTestItem({ type: 'raw_material', stocks: {}, weightedAverageCost: 0 });
  const reqId = await requisition([[item.id, 4]]);
  await ProcurementService.executeWorkflowAction(reqId, 'approve_request', ADMIN);
  const [order] = await draftOrders(reqId, [[[item.id, 4]]]);
  await ProcurementService.deliverOrderToWarehouse(order, { username: 'انباردار آزمون اقدام خودکار' });
  await settle();
  const { instanceId, stateKey } = await requisitionState(reqId);
  if (stateKey !== 'received') problems.push(`The requisition step after full delivery is "${stateKey}", not "received"`);
  const history = await pool.query<{ performed_by: number | null }>(
    `SELECT performed_by FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'receive_items'`, [instanceId]);
  if (history.rows.length !== 1) problems.push(`Full delivery created ${history.rows.length} "receive_items" history rows, not 1`);
  else if (history.rows[0].performed_by !== null) problems.push(`The "received" step was recorded in the name of user #${history.rows[0].performed_by}`);
  const audit = await pool.query<{ user_id: number | null }>(
    `SELECT user_id FROM activity_logs WHERE details->>'operation' = 'DELIVER_PROCUREMENT_ORDER' AND details->>'documentId' = $1`, [String(order)]);
  if (audit.rows.length !== 1) problems.push(`The order delivery has ${audit.rows.length} activity logs, not 1`);
  else if (audit.rows[0].user_id !== null) problems.push(`The delivery log was recorded in the name of user #${audit.rows[0].user_id}`);
  return problems;
}
