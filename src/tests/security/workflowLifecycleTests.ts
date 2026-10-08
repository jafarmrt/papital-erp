import fs from 'fs';
import path from 'path';
import { TestCaseResult } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * بسته ۱۴ (گردش کار)، PR ب — چرخه عمر فرایند و کارتابل: کدام سند فرایند می‌گیرد، بستن فرایند با قطعی‌سازی یا ابطال،
 * زبانه‌های کارتابل، تحلیل مهلت انجام و گیرنده یادآوری؛ همه از مسیرهای واقعی Express.
 */

async function postDocument(h: Harness, body: Record<string, unknown>): Promise<number> {
  const { createTestItem } = await import('../fixtures/factories.js');
  const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
  const { getDefaultWarehouseCode } = await import('../../services/inventory/warehouseResolver.js');
  const wh = (await getDefaultWarehouseCode(orm)) as string;
  const item = await createTestItem({ type: 'product', stocks: { [wh]: 50 }, weightedAverageCost: 10_000, code: `WF14B-${h.tag}-${Math.floor(Math.random() * 1e6)}` } as never);
  const res = await h.post('/api/documents', {
    inOut: 'out', refNumber: 'auto', date: await businessTodayIsoDate(), buyer_name: `خریدار ${h.tag}`,
    items: [{ itemId: item.id, quantity: 1, unit_price: 20_000, location: wh }],
    ...body,
  });
  const docId = Number(res.body?.docId ?? res.body?.id);
  if (res.status !== 200 || !(docId > 0)) throw new Error(`Recording document ${JSON.stringify(body)} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  return docId;
}

const instancesOf = (h: Harness, entityType: string, entityId: number | string): Promise<Row[]> =>
  h.q(`SELECT id, status FROM workflow_instances WHERE entity_type = $1 AND entity_id = $2 ORDER BY id`, [entityType, String(entityId)]);

const pendingTasksOf = (h: Harness, instanceId: number): Promise<Row[]> =>
  h.q(`SELECT id FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending'`, [instanceId]);

/** مهاجرت را در تراکنشی که برگشت می‌خورد اجرا می‌کند و نتیجه `read` را پیش از برگشت برمی‌گرداند */
export async function runMigrationRolledBack<T>(file: string, prepare: (q: (sql: string, p?: unknown[]) => Promise<Row[]>) => Promise<void>, read: (q: (sql: string, p?: unknown[]) => Promise<Row[]>) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = async (text: string, params: unknown[] = []) => (await client.query(text, params)).rows as Row[];
    await prepare(q);
    await client.query(fs.readFileSync(path.join(process.cwd(), 'drizzle', file), 'utf8'));
    return await read(q);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

export async function runWorkflowLifecycleTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_document_auto_start_td_446', 'security', 'td446', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_document_auto_start_td_446',
      name: 'v9.0.39: only a draft or proforma sales document enters the approval workflow, in its create transaction; the workflow instance of a final document is closed (TD-446)',
      details: 'A final receipt and invoice and a draft receipt get no instance; a proforma and a draft invoice get one; finalizing outside the workflow and migration 0057 close the instance of a final document with a history row',
    }, async (h, wrong) => {
      for (const [label, body] of [
        ['رسید قطعی', { docType: 'receipt', inOut: 'in', status: 'final' }],
        ['فاکتور فروش قطعی', { docType: 'invoice', status: 'final' }],
        ['رسید پیش‌نویس', { docType: 'receipt', inOut: 'in', status: 'draft' }],
      ] as const) {
        const docId = await postDocument(h, body);
        const inst = await instancesOf(h, 'document', docId);
        if (inst.length > 0) wrong.push(`${label} got ${inst.length} workflow instances`);
      }

      const proformaId = await postDocument(h, { docType: 'invoice', status: 'proforma' });
      const draftId = await postDocument(h, { docType: 'invoice', status: 'draft' });
      for (const [label, id] of [['پیش‌فاکتور', proformaId], ['فاکتور پیش‌نویس', draftId]] as const) {
        const inst = await instancesOf(h, 'document', id);
        if (inst.length !== 1 || inst[0].status !== 'IN_PROGRESS') wrong.push(`${label} got ${JSON.stringify(inst)}, not one running instance`);
      }

      // قطعی‌سازی بیرون از گردش کار: فرایند بسته و کارها لغو
      const fin = await h.put(`/api/documents/${draftId}/finalize`, {});
      if (fin.status !== 200) wrong.push(`Finalizing the draft invoice returned ${fin.status}: ${JSON.stringify(fin.body).slice(0, 160)}`);
      const [closed] = await instancesOf(h, 'document', draftId);
      if (closed?.status !== 'TERMINATED') wrong.push(`The workflow instance of the finalized document stayed ${String(closed?.status)}, not TERMINATED`);
      if (closed && (await pendingTasksOf(h, Number(closed.id))).length > 0) wrong.push('A pending task of the finalized document stayed in the inbox');
      const widget = await h.get(`/api/workflow/instance/document/${draftId}`);
      if (widget.body?.instance?.status === 'IN_PROGRESS') wrong.push('The widget showed a running instance for the final document');

      // مهاجرت 0057: فرایند در جریانِ سند قطعی موجود بسته می‌شود؛ فرایند سند پیش‌نویس دست نمی‌خورد
      const [open] = await instancesOf(h, 'document', proformaId);
      const outcome = await runMigrationRolledBack('0057_terminate_final_document_workflows.sql', async (q) => {
        await q(`UPDATE documents SET status = 'final' WHERE id = $1`, [draftId]);
        await q(`UPDATE workflow_instances SET status = 'IN_PROGRESS' WHERE id = $1`, [closed?.id]);
        await q(`UPDATE workflow_tasks SET status = 'pending' WHERE instance_id = $1`, [closed?.id]);
      }, async (q) => ({
        finalDoc: (await q(`SELECT status FROM workflow_instances WHERE id = $1`, [closed?.id]))[0]?.status,
        finalTasks: (await q(`SELECT count(*)::int AS n FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending'`, [closed?.id]))[0]?.n,
        history: (await q(`SELECT comment FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'terminate' ORDER BY id DESC LIMIT 1`, [closed?.id]))[0]?.comment,
        proforma: (await q(`SELECT status FROM workflow_instances WHERE id = $1`, [open?.id]))[0]?.status,
      })).catch((err: unknown) => ({ error: String(err) }));
      if ('error' in outcome) wrong.push(`Migration 0057: ${outcome.error}`);
      else {
        if (outcome.finalDoc !== 'TERMINATED') wrong.push(`The migration left the final document instance ${String(outcome.finalDoc)}`);
        if (Number(outcome.finalTasks) !== 0) wrong.push(`The migration left ${String(outcome.finalTasks)} pending tasks of the final document open`);
        if (outcome.history !== 'سند قطعی ثبت شده بود') wrong.push(`Migration history row: ${String(outcome.history)}`);
        if (outcome.proforma !== 'IN_PROGRESS') wrong.push(`The migration set the proforma instance to ${String(outcome.proforma)}`);
      }
    });
  }

  if (shouldRun('sec_workflow_void_closes_instance_td_447', 'security', 'td447', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_void_closes_instance_td_447',
      name: 'v9.0.40: voiding or deleting an entity closes its running workflow instance in the same transaction; tasks are canceled and one history row is written (TD-447)',
      details: 'Proforma, draft journal voucher, purchase requisition, item and treasury account: after void or delete the instance is TERMINATED, with no pending task and with a history row; migration 0058 closes the instance of an entity deleted earlier',
    }, async (h, wrong) => {
      const { createTestVoucher, createTestWorkflow, createTestWorkflowInstance, createTestItem } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      /** History comments the server writes when it closes each entity's instance */
      const TERMINATE_COMMENTS = {
        document: 'ابطال سند', voucher: 'حذف سند حسابداری', requisition: 'حذف درخواست خرید', item: 'حذف کالا', bank: 'حذف حساب خزانه',
      };
      const expectClosed = async (label: string, entityType: string, entityId: number, comment: string) => {
        const inst = await instancesOf(h, entityType, entityId);
        if (inst.length === 0) { wrong.push(`${label}: no workflow instance`); return; }
        for (const i of inst) {
          if (i.status !== 'TERMINATED') wrong.push(`${label}: instance stayed ${String(i.status)}, not TERMINATED`);
          if ((await pendingTasksOf(h, Number(i.id))).length > 0) wrong.push(`${label}: a pending task stayed in the inbox`);
          const [log] = await h.q(`SELECT comment FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'terminate'`, [i.id]);
          if (log?.comment !== comment) wrong.push(`${label}: history row is "${String(log?.comment)}", not "${comment}"`);
        }
      };
      /** فرایند ساختگی در جریان با یک کار در انتظار، با تعریف غیرفعال همان نوع (بی اثر روی آزمون‌های دیگر) */
      const openInstance = async (entityType: string, entityId: number) => {
        const wf = await createTestWorkflow({ definition: { entityType, isActive: 0 } });
        const inst = await createTestWorkflowInstance(wf.definition.id, wf.states.draft.id, entityType, String(entityId));
        await h.q(`INSERT INTO workflow_tasks (instance_id, transition_id, title, status) VALUES ($1, $2, 'کار آزمون', 'pending')`, [inst.id, wf.transitions[0].id]);
        return inst.id;
      };

      // ۱) پیش‌فاکتور (فرایند را خود ثبت می‌سازد) ← ابطال
      const proformaId = await postDocument(h, { docType: 'invoice', status: 'proforma' });
      const voided = await h.del(`/api/documents/${proformaId}`);
      if (voided.status !== 200) wrong.push(`Voiding the proforma returned ${voided.status}`);
      await expectClosed('voided proforma', 'document', proformaId, TERMINATE_COMMENTS.document);

      // ۲) سند حسابداری پیش‌نویس با گردش کار ← حذف
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 3000, totalCredit: 3000 } as never);
      const started = await h.post('/api/workflow/start', { workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: voucher.id });
      if (started.status !== 200) wrong.push(`Starting the journal voucher workflow returned ${started.status}`);
      const delVoucher = await h.del(`/api/accounting/vouchers/${voucher.id}`);
      if (delVoucher.status !== 200) wrong.push(`Deleting the journal voucher returned ${delVoucher.status}: ${JSON.stringify(delVoucher.body).slice(0, 160)}`);
      await expectClosed('deleted journal voucher', 'journal_voucher', voucher.id, TERMINATE_COMMENTS.voucher);

      // ۳) درخواست خرید (فرایند را ثبت می‌سازد) ← حذف
      const reqItem = await createTestItem({ type: 'raw_material', code: `WF447R-${h.tag}` } as never);
      const reqRes = await h.post('/api/procurement/requisitions', { title: `درخواست آزمون ۴۴۷ ${h.tag}`, items: [{ itemId: reqItem.id, itemName: reqItem.name, requestedQty: 2, unit: 'عدد' }] });
      const reqId = Number(reqRes.body?.id ?? reqRes.body?.data?.id);
      if (!(reqId > 0)) wrong.push(`Creating the purchase requisition returned ${reqRes.status}: ${JSON.stringify(reqRes.body).slice(0, 160)}`);
      else {
        if ((await instancesOf(h, 'purchase_requisition', reqId)).length === 0) await openInstance('purchase_requisition', reqId);
        const delReq = await h.del(`/api/procurement/requisitions/${reqId}`);
        if (delReq.status !== 200) wrong.push(`Deleting the purchase requisition returned ${delReq.status}`);
        await expectClosed('deleted purchase requisition', 'purchase_requisition', reqId, TERMINATE_COMMENTS.requisition);
      }

      // ۴) کالا بی موجودی ← حذف
      const item = await createTestItem({ type: 'raw_material', stocks: {}, code: `WF447-${h.tag}` } as never);
      await openInstance('item', item.id);
      const delItem = await h.del(`/api/items/${item.id}`);
      if (delItem.status !== 200) wrong.push(`Deleting the item returned ${delItem.status}: ${JSON.stringify(delItem.body).slice(0, 160)}`);
      await expectClosed('deleted item', 'item', item.id, TERMINATE_COMMENTS.item);

      // ۵) حساب خزانه بی تراکنش ← حذف
      const [bank] = await h.q(`INSERT INTO bank_accounts (code, title, type, currency, is_deleted) VALUES ($1, $2, 'cash', 'IRR', 0) RETURNING id`, [`T447-${h.tag}`, `صندوق آزمون ۴۴۷ ${h.tag}`]);
      await openInstance('bank_account', Number(bank.id));
      const delBank = await h.del(`/api/accounting/bank-accounts/${bank.id}`);
      if (delBank.status !== 200) wrong.push(`Deleting the treasury account returned ${delBank.status}: ${JSON.stringify(delBank.body).slice(0, 160)}`);
      await expectClosed('deleted treasury account', 'bank_account', Number(bank.id), TERMINATE_COMMENTS.bank);

      // ۶) مهاجرت 0058: فرایند در جریانِ موجودیتی که پیش‌تر باطل یا حذف شده بسته می‌شود؛ فرایند موجودیت زنده دست نمی‌خورد
      const liveId = await postDocument(h, { docType: 'invoice', status: 'draft' });
      const [live] = await instancesOf(h, 'document', liveId);
      const [old] = await instancesOf(h, 'document', proformaId);
      const outcome = await runMigrationRolledBack('0058_terminate_deleted_entity_workflows.sql', async (q) => {
        await q(`UPDATE workflow_instances SET status = 'IN_PROGRESS' WHERE id = $1`, [old?.id]);
        await q(`UPDATE workflow_tasks SET status = 'pending' WHERE instance_id = $1`, [old?.id]);
        await q(`DELETE FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'terminate'`, [old?.id]);
      }, async (q) => ({
        old: (await q(`SELECT status FROM workflow_instances WHERE id = $1`, [old?.id]))[0]?.status,
        tasks: (await q(`SELECT count(*)::int AS n FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending'`, [old?.id]))[0]?.n,
        history: (await q(`SELECT comment FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'terminate'`, [old?.id]))[0]?.comment,
        live: (await q(`SELECT status FROM workflow_instances WHERE id = $1`, [live?.id]))[0]?.status,
      })).catch((err: unknown) => ({ error: String(err) }));
      if ('error' in outcome) wrong.push(`Migration 0058: ${outcome.error}`);
      else {
        if (outcome.old !== 'TERMINATED') wrong.push(`The migration left the voided document instance ${String(outcome.old)}`);
        if (Number(outcome.tasks) !== 0) wrong.push(`The migration left ${String(outcome.tasks)} tasks of the voided document open`);
        if (outcome.history !== 'موجودیت پیش‌تر باطل یا حذف شده بود') wrong.push(`Migration history row: ${String(outcome.history)}`);
        if (outcome.live !== 'IN_PROGRESS') wrong.push(`The migration set the live document instance to ${String(outcome.live)}`);
      }
    });
  }

  if (shouldRun('sec_workflow_inbox_tabs_td_448', 'security', 'td448', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_inbox_tabs_td_448',
      name: 'v9.0.41: the inbox tabs "overdue", "delegated" and "completed" have data and the stats count the same rows; overdue uses database time (TD-448)',
      details: 'A task due in one hour is not overdue and a task past due is; the delegate sees the delegated tasks in its own tab; an executed task appears in "completed"; an invalid status or page is 400',
    }, async (h, wrong) => {
      const { createTestVoucher } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const today = await businessTodayIsoDate();
      const accountant = await h.sessionWith('accountant');
      const deputy = await h.sessionWith(['workflow.view', 'workflow.approve']);
      const startVoucherWorkflow = async () => {
        const { voucher } = await createTestVoucher({ status: 'draft', date: today, totalDebit: 1000, totalCredit: 1000 } as never);
        const res = await h.post('/api/workflow/start', { workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: voucher.id });
        const id = Number(res.body?.data?.id);
        if (!(id > 0)) throw new Error(`Starting the journal voucher workflow returned ${res.status}`);
        return id;
      };
      const soon = await startVoucherWorkflow();
      const late = await startVoucherWorkflow();
      await h.q(`UPDATE workflow_tasks SET due_at = now() + interval '1 hour' WHERE instance_id = $1 AND status = 'pending'`, [soon]);
      await h.q(`UPDATE workflow_tasks SET due_at = now() - interval '1 hour' WHERE instance_id = $1 AND status = 'pending'`, [late]);

      const tab = async (s: typeof accountant, status: string) => {
        const res = await h.get(`/api/workflow/tasks/my-tasks?status=${status}&limit=1000`, s);
        if (res.status !== 200) { wrong.push(`Tab ${status}: ${res.status}`); return [] as Row[]; }
        return Array.isArray(res.body?.data) ? (res.body.data as Row[]) : [];
      };
      const instanceIds = (rows: Row[]) => new Set(rows.map(r => Number(r.instanceId ?? (r.instance as Row | undefined)?.id)));

      // ۱) تأخیر: فقط کار با موعد گذشته
      const overdue = instanceIds(await tab(accountant, 'overdue'));
      if (!overdue.has(late)) wrong.push('A task past due did not appear in the "overdue" tab');
      if (overdue.has(soon)) wrong.push('A task due in one hour was counted as "overdue"');
      const pendingRows = await tab(accountant, 'pending');
      const soonRow = pendingRows.find(r => Number(r.instanceId) === soon);
      if (soonRow?.isOverdue !== false) wrong.push(`A task with a future due date got isOverdue=${String(soonRow?.isOverdue)}`);
      const stats1 = (await h.get('/api/workflow/tasks/stats', accountant)).body ?? {};
      const statsOverdueBefore = Number(stats1.overdueCount);
      await h.q(`UPDATE workflow_tasks SET due_at = now() - interval '2 hours' WHERE instance_id = $1 AND status = 'pending'`, [soon]);
      const stats2 = (await h.get('/api/workflow/tasks/stats', accountant)).body ?? {};
      if (Number(stats2.overdueCount) !== statsOverdueBefore + 1) wrong.push(`Overdue stats went ${statsOverdueBefore} -> ${String(stats2.overdueCount)} when one task passed its due date, not one more`);
      await h.q(`UPDATE workflow_tasks SET due_at = now() + interval '1 hour' WHERE instance_id = $1 AND status = 'pending'`, [soon]);

      // ۲) تفویض: جانشین کارهای حسابدار را در زبانه «دریافتی از تفویض» می‌بیند
      const start = new Date(Date.now() - 3600_000).toISOString();
      const end = new Date(Date.now() + 86_400_000).toISOString();
      const del = await h.post('/api/workflow/delegations', { toUserId: deputy.userId, scope: 'ALL', startDate: start, endDate: end, reason: 'آزمون ۴۴۸' }, accountant);
      if (del.status !== 200) wrong.push(`Creating the delegation returned ${del.status}: ${JSON.stringify(del.body).slice(0, 160)}`);
      const delegated = instanceIds(await tab(deputy, 'delegated'));
      if (!delegated.has(soon) || !delegated.has(late)) wrong.push('Delegated tasks did not appear in the "delegated" tab of the delegate');
      const ownDelegated = instanceIds(await tab(accountant, 'delegated'));
      if (ownDelegated.has(soon)) wrong.push('The own task of the accountant appeared in the accountant "delegated" tab');
      const deputyStats = (await h.get('/api/workflow/tasks/stats', deputy)).body ?? {};
      if (!(Number(deputyStats.delegatedCount) >= 2)) wrong.push(`Delegated count of the delegate is ${String(deputyStats.delegatedCount)}`);

      // ۳) تکمیل‌شده: کاری که حسابدار اجرا کرد
      const soonTask = (await h.q(`SELECT id FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending' ORDER BY id LIMIT 1`, [soon]))[0];
      const exec = await h.post(`/api/workflow/tasks/${soonTask?.id}/execute`, { action: 'approve' }, accountant);
      if (exec.status !== 200) wrong.push(`Executing the task returned ${exec.status}: ${JSON.stringify(exec.body).slice(0, 160)}`);
      const completed = await tab(accountant, 'completed');
      if (!instanceIds(completed).has(soon)) wrong.push('The executed task did not appear in the "completed" tab');
      const statsAfter = (await h.get('/api/workflow/tasks/stats', accountant)).body ?? {};
      if (!(Number(statsAfter.completedCount) >= 1)) wrong.push(`Completed count is ${String(statsAfter.completedCount)}`);
      if (instanceIds(await tab(deputy, 'completed')).has(soon)) wrong.push('The task executed by the accountant appeared in the "completed" tab of the delegate');

      // ۴) ورودی نادرست
      for (const bad of [`status=${encodeURIComponent("x' OR 1=1")}`, 'page=-3', 'limit=0']) {
        const res = await h.get(`/api/workflow/tasks/my-tasks?${bad}`, accountant);
        if (res.status !== 400) wrong.push(`Query "${bad}" returned ${res.status}, not 400`);
      }
    });
  }

  if (shouldRun('sec_workflow_instances_inbox_removed_td_449', 'security', 'td449', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_instances_inbox_removed_td_449',
      name: 'v9.0.42: the "instances view" and `GET /workflow/inbox` are removed; the inbox has only the tasks view (TD-449)',
      details: 'The route `/api/workflow/inbox` no longer exists (404) and the tasks view answers',
    }, async (h, wrong) => {
      const res = await h.get('/api/workflow/inbox?limit=1');
      if (res.status !== 404) wrong.push(`GET /api/workflow/inbox returned ${res.status}, not 404 (${Array.isArray(res.body?.data) ? res.body.data.length : '?'} rows)`);
      const tasks = await h.get('/api/workflow/tasks/my-tasks?limit=1');
      if (tasks.status !== 200 || !Array.isArray(tasks.body?.data)) wrong.push(`The tasks view returned ${tasks.status}`);
    });
  }

  if (shouldRun('sec_workflow_sla_analytics_route_td_450', 'security', 'td450', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_sla_analytics_route_td_450',
      name: 'v9.0.43: "SLA analytics" answers from its own route and includes the reopened tasks report; workflow engine facade methods run bound to their own class (TD-450)',
      details: '`GET /api/workflow/analytics/sla` 200 with `reopenedTasks`; `WorkflowEngineService.checkUserRoleMatch` and `getWorkflowAnalytics` without TypeError',
    }, async (h, wrong) => {
      const res = await h.get('/api/workflow/analytics/sla');
      if (res.status !== 200) wrong.push(`GET /api/workflow/analytics/sla returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
      else {
        const data = (res.body?.data ?? res.body) as Row;
        if (!data || typeof data !== 'object' || !('reopenedTasks' in data)) wrong.push(`The SLA analytics response has no reopened tasks report: ${Object.keys(data ?? {}).join(',')}`);
      }
      const { WorkflowEngineService } = await import('../../services/workflow/workflowEngineService.js');
      try {
        if (WorkflowEngineService.checkUserRoleMatch('admin', 'accountant') !== true) wrong.push('Facade checkUserRoleMatch did not return true for the system admin');
      } catch (err) {
        wrong.push(`Facade checkUserRoleMatch threw: ${String(err)}`);
      }
      try {
        await WorkflowEngineService.getWorkflowAnalytics();
      } catch (err) {
        wrong.push(`Facade getWorkflowAnalytics threw: ${String(err)}`);
      }
    });
  }

  if (shouldRun('sec_workflow_sla_reminder_recipients_td_460', 'security', 'td460', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_sla_reminder_recipients_td_460',
      name: 'v9.0.44: the SLA reminder of a roleless step reaches only holders of the workflow approve or execute permission (TD-460)',
      details: 'Overdue task of a roleless step: the holder of workflow.approve and the holder of workflow.execute get a reminder; a user without workflow permission does not',
    }, async (h, wrong) => {
      const { createTestWorkflow, createTestWorkflowInstance } = await import('../fixtures/factories.js');
      const { WorkflowSlaReminderService } = await import('../../services/workflow/workflowSlaReminderService.js');
      const approver = await h.sessionWith(['workflow.view', 'workflow.approve']);
      const executor = await h.sessionWith(['workflow.execute']);
      const outsider = await h.sessionWith(['daily_logs.view']);
      const wf = await createTestWorkflow({ definition: { entityType: 'test_document', isActive: 0 } });
      const inst = await createTestWorkflowInstance(wf.definition.id, wf.states.draft.id, 'test_document', `460${h.tag}`);
      await h.q(
        `INSERT INTO workflow_tasks (instance_id, transition_id, title, status, assigned_role, candidate_roles, due_at)
         VALUES ($1, $2, 'کار آزمون ۴۶۰', 'pending', '', '["ALL"]'::jsonb, now() - interval '1 hour')`,
        [inst.id, wf.transitions[0].id],
      );
      await WorkflowSlaReminderService.sendDueReminders();
      const got = async (userId: number) => Number((await h.q(
        `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND title = 'مهلت کار تاییدی گذشت'`, [userId],
      ))[0]?.n ?? 0);
      if (await got(approver.userId) !== 1) wrong.push(`The holder of workflow.approve got ${await got(approver.userId)} reminders, not 1`);
      if (await got(executor.userId) !== 1) wrong.push(`The holder of workflow.execute got ${await got(executor.userId)} reminders, not 1`);
      if (await got(outsider.userId) !== 0) wrong.push(`A user without workflow permission got ${await got(outsider.userId)} reminders`);
    });
  }

  return results;
}
