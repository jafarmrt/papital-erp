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
  if (res.status !== 200 || !(docId > 0)) throw new Error(`ثبت سند ${JSON.stringify(body)} ${res.status} داد: ${JSON.stringify(res.body).slice(0, 200)}`);
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
      name: 'v9.0.39: فقط سند فروش پیش‌نویس یا پیش‌فاکتور در همان تراکنش ثبت وارد گردش کار تأیید می‌شود؛ فرایند سند قطعی بسته می‌شود (TD-446)',
      details: 'رسید و فاکتور قطعی و رسید پیش‌نویس بی فرایند؛ پیش‌فاکتور و فاکتور پیش‌نویس یک فرایند؛ قطعی‌سازی بیرون از گردش کار و مهاجرت 0057 فرایند سند قطعی را با تاریخچه می‌بندند',
    }, async (h, wrong) => {
      for (const [label, body] of [
        ['رسید قطعی', { docType: 'receipt', inOut: 'in', status: 'final' }],
        ['فاکتور فروش قطعی', { docType: 'invoice', status: 'final' }],
        ['رسید پیش‌نویس', { docType: 'receipt', inOut: 'in', status: 'draft' }],
      ] as const) {
        const docId = await postDocument(h, body);
        const inst = await instancesOf(h, 'document', docId);
        if (inst.length > 0) wrong.push(`${label} ${inst.length} فرایند گرفت`);
      }

      const proformaId = await postDocument(h, { docType: 'invoice', status: 'proforma' });
      const draftId = await postDocument(h, { docType: 'invoice', status: 'draft' });
      for (const [label, id] of [['پیش‌فاکتور', proformaId], ['فاکتور پیش‌نویس', draftId]] as const) {
        const inst = await instancesOf(h, 'document', id);
        if (inst.length !== 1 || inst[0].status !== 'IN_PROGRESS') wrong.push(`${label} ${JSON.stringify(inst)} گرفت، نه یک فرایند در جریان`);
      }

      // قطعی‌سازی بیرون از گردش کار: فرایند بسته و کارها لغو
      const fin = await h.put(`/api/documents/${draftId}/finalize`, {});
      if (fin.status !== 200) wrong.push(`قطعی‌سازی فاکتور پیش‌نویس ${fin.status} داد: ${JSON.stringify(fin.body).slice(0, 160)}`);
      const [closed] = await instancesOf(h, 'document', draftId);
      if (closed?.status !== 'TERMINATED') wrong.push(`فرایند سندِ قطعی‌شده ${String(closed?.status)} ماند، نه TERMINATED`);
      if (closed && (await pendingTasksOf(h, Number(closed.id))).length > 0) wrong.push('کار در انتظار سندِ قطعی‌شده در کارتابل ماند');
      const widget = await h.get(`/api/workflow/instance/document/${draftId}`);
      if (widget.body?.instance?.status === 'IN_PROGRESS') wrong.push('ویجت سندِ قطعی فرایند در جریان نشان داد');

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
      if ('error' in outcome) wrong.push(`مهاجرت 0057: ${outcome.error}`);
      else {
        if (outcome.finalDoc !== 'TERMINATED') wrong.push(`مهاجرت فرایند سند قطعی را ${String(outcome.finalDoc)} گذاشت`);
        if (Number(outcome.finalTasks) !== 0) wrong.push(`مهاجرت ${String(outcome.finalTasks)} کار در انتظار سند قطعی را باز گذاشت`);
        if (outcome.history !== 'سند قطعی ثبت شده بود') wrong.push(`ردیف تاریخچه مهاجرت: ${String(outcome.history)}`);
        if (outcome.proforma !== 'IN_PROGRESS') wrong.push(`مهاجرت فرایند پیش‌فاکتور را ${String(outcome.proforma)} کرد`);
      }
    });
  }

  if (shouldRun('sec_workflow_void_closes_instance_td_447', 'security', 'td447', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_void_closes_instance_td_447',
      name: 'v9.0.40: ابطال یا حذف موجودیت فرایند در جریانش را در همان تراکنش می‌بندد؛ کارها لغو و یک ردیف تاریخچه (TD-447)',
      details: 'پیش‌فاکتور، سند حسابداری پیش‌نویس، درخواست خرید، کالا و حساب خزانه: پس از ابطال یا حذف فرایند TERMINATED، بی کار در انتظار، با تاریخچه؛ مهاجرت 0058 فرایند موجودیت حذف‌شده پیشین را می‌بندد',
    }, async (h, wrong) => {
      const { createTestVoucher, createTestWorkflow, createTestWorkflowInstance, createTestItem } = await import('../fixtures/factories.js');
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const expectClosed = async (label: string, entityType: string, entityId: number, comment: string) => {
        const inst = await instancesOf(h, entityType, entityId);
        if (inst.length === 0) { wrong.push(`${label}: فرایندی نبود`); return; }
        for (const i of inst) {
          if (i.status !== 'TERMINATED') wrong.push(`${label}: فرایند ${String(i.status)} ماند، نه TERMINATED`);
          if ((await pendingTasksOf(h, Number(i.id))).length > 0) wrong.push(`${label}: کار در انتظار در کارتابل ماند`);
          const [log] = await h.q(`SELECT comment FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'terminate'`, [i.id]);
          if (log?.comment !== comment) wrong.push(`${label}: ردیف تاریخچه «${String(log?.comment)}» است، نه «${comment}»`);
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
      if (voided.status !== 200) wrong.push(`ابطال پیش‌فاکتور ${voided.status} داد`);
      await expectClosed('پیش‌فاکتور باطل‌شده', 'document', proformaId, 'ابطال سند');

      // ۲) سند حسابداری پیش‌نویس با گردش کار ← حذف
      const { voucher } = await createTestVoucher({ status: 'draft', date: await businessTodayIsoDate(), totalDebit: 3000, totalCredit: 3000 } as never);
      const started = await h.post('/api/workflow/start', { workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: voucher.id });
      if (started.status !== 200) wrong.push(`شروع گردش کار سند حسابداری ${started.status} داد`);
      const delVoucher = await h.del(`/api/accounting/vouchers/${voucher.id}`);
      if (delVoucher.status !== 200) wrong.push(`حذف سند حسابداری ${delVoucher.status} داد: ${JSON.stringify(delVoucher.body).slice(0, 160)}`);
      await expectClosed('سند حسابداری حذف‌شده', 'journal_voucher', voucher.id, 'حذف سند حسابداری');

      // ۳) درخواست خرید (فرایند را ثبت می‌سازد) ← حذف
      const reqItem = await createTestItem({ type: 'raw_material', code: `WF447R-${h.tag}` } as never);
      const reqRes = await h.post('/api/procurement/requisitions', { title: `درخواست آزمون ۴۴۷ ${h.tag}`, items: [{ itemId: reqItem.id, itemName: reqItem.name, quantity: 2, unit: 'عدد' }] });
      const reqId = Number(reqRes.body?.id ?? reqRes.body?.data?.id);
      if (!(reqId > 0)) wrong.push(`ثبت درخواست خرید ${reqRes.status} داد: ${JSON.stringify(reqRes.body).slice(0, 160)}`);
      else {
        if ((await instancesOf(h, 'purchase_requisition', reqId)).length === 0) await openInstance('purchase_requisition', reqId);
        const delReq = await h.del(`/api/procurement/requisitions/${reqId}`);
        if (delReq.status !== 200) wrong.push(`حذف درخواست خرید ${delReq.status} داد`);
        await expectClosed('درخواست خرید حذف‌شده', 'purchase_requisition', reqId, 'حذف درخواست خرید');
      }

      // ۴) کالا بی موجودی ← حذف
      const item = await createTestItem({ type: 'raw_material', stocks: {}, code: `WF447-${h.tag}` } as never);
      await openInstance('item', item.id);
      const delItem = await h.del(`/api/items/${item.id}`);
      if (delItem.status !== 200) wrong.push(`حذف کالا ${delItem.status} داد: ${JSON.stringify(delItem.body).slice(0, 160)}`);
      await expectClosed('کالای حذف‌شده', 'item', item.id, 'حذف کالا');

      // ۵) حساب خزانه بی تراکنش ← حذف
      const [bank] = await h.q(`INSERT INTO bank_accounts (code, title, type, currency, is_deleted) VALUES ($1, $2, 'cash', 'IRR', 0) RETURNING id`, [`T447-${h.tag}`, `صندوق آزمون ۴۴۷ ${h.tag}`]);
      await openInstance('bank_account', Number(bank.id));
      const delBank = await h.del(`/api/accounting/bank-accounts/${bank.id}`);
      if (delBank.status !== 200) wrong.push(`حذف حساب خزانه ${delBank.status} داد: ${JSON.stringify(delBank.body).slice(0, 160)}`);
      await expectClosed('حساب خزانه حذف‌شده', 'bank_account', Number(bank.id), 'حذف حساب خزانه');

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
      if ('error' in outcome) wrong.push(`مهاجرت 0058: ${outcome.error}`);
      else {
        if (outcome.old !== 'TERMINATED') wrong.push(`مهاجرت فرایند سند باطل‌شده را ${String(outcome.old)} گذاشت`);
        if (Number(outcome.tasks) !== 0) wrong.push(`مهاجرت ${String(outcome.tasks)} کار سند باطل‌شده را باز گذاشت`);
        if (outcome.history !== 'موجودیت پیش‌تر باطل یا حذف شده بود') wrong.push(`ردیف تاریخچه مهاجرت: ${String(outcome.history)}`);
        if (outcome.live !== 'IN_PROGRESS') wrong.push(`مهاجرت فرایند سند زنده را ${String(outcome.live)} کرد`);
      }
    });
  }

  if (shouldRun('sec_workflow_inbox_tabs_td_448', 'security', 'td448', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_inbox_tabs_td_448',
      name: 'v9.0.41: زبانه‌های «دارای تأخیر»، «دریافتی از تفویض» و «تکمیل‌شده» کارتابل داده دارند و آمار همان‌ها را می‌شمارد؛ تأخیر با زمان پایگاه‌داده (TD-448)',
      details: 'کار با موعد یک ساعت بعد دارای تأخیر نیست و کار با موعد گذشته هست؛ جانشین کارهای تفویض‌شده را در زبانه خود می‌بیند؛ کار اجراشده در «تکمیل‌شده» می‌آید؛ وضعیت و صفحه نامعتبر ۴۰۰',
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
        if (!(id > 0)) throw new Error(`شروع گردش کار سند حسابداری ${res.status} داد`);
        return id;
      };
      const soon = await startVoucherWorkflow();
      const late = await startVoucherWorkflow();
      await h.q(`UPDATE workflow_tasks SET due_at = now() + interval '1 hour' WHERE instance_id = $1 AND status = 'pending'`, [soon]);
      await h.q(`UPDATE workflow_tasks SET due_at = now() - interval '1 hour' WHERE instance_id = $1 AND status = 'pending'`, [late]);

      const tab = async (s: typeof accountant, status: string) => {
        const res = await h.get(`/api/workflow/tasks/my-tasks?status=${status}&limit=1000`, s);
        if (res.status !== 200) { wrong.push(`زبانه ${status}: ${res.status}`); return [] as Row[]; }
        return Array.isArray(res.body?.data) ? (res.body.data as Row[]) : [];
      };
      const instanceIds = (rows: Row[]) => new Set(rows.map(r => Number(r.instanceId ?? (r.instance as Row | undefined)?.id)));

      // ۱) تأخیر: فقط کار با موعد گذشته
      const overdue = instanceIds(await tab(accountant, 'overdue'));
      if (!overdue.has(late)) wrong.push('کار با موعد گذشته در زبانه «دارای تأخیر» نیامد');
      if (overdue.has(soon)) wrong.push('کار با موعد یک ساعت بعد «دارای تأخیر» شمرده شد');
      const pendingRows = await tab(accountant, 'pending');
      const soonRow = pendingRows.find(r => Number(r.instanceId) === soon);
      if (soonRow?.isOverdue !== false) wrong.push(`کار با موعد آینده isOverdue=${String(soonRow?.isOverdue)} گرفت`);
      const stats1 = (await h.get('/api/workflow/tasks/stats', accountant)).body ?? {};
      const statsOverdueBefore = Number(stats1.overdueCount);
      await h.q(`UPDATE workflow_tasks SET due_at = now() - interval '2 hours' WHERE instance_id = $1 AND status = 'pending'`, [soon]);
      const stats2 = (await h.get('/api/workflow/tasks/stats', accountant)).body ?? {};
      if (Number(stats2.overdueCount) !== statsOverdueBefore + 1) wrong.push(`آمار تأخیر با گذشتن موعد یک کار ${statsOverdueBefore} ← ${String(stats2.overdueCount)} شد، نه یکی بیشتر`);
      await h.q(`UPDATE workflow_tasks SET due_at = now() + interval '1 hour' WHERE instance_id = $1 AND status = 'pending'`, [soon]);

      // ۲) تفویض: جانشین کارهای حسابدار را در زبانه «دریافتی از تفویض» می‌بیند
      const start = new Date(Date.now() - 3600_000).toISOString();
      const end = new Date(Date.now() + 86_400_000).toISOString();
      const del = await h.post('/api/workflow/delegations', { toUserId: deputy.userId, scope: 'ALL', startDate: start, endDate: end, reason: 'آزمون ۴۴۸' }, accountant);
      if (del.status !== 200) wrong.push(`ثبت تفویض ${del.status} داد: ${JSON.stringify(del.body).slice(0, 160)}`);
      const delegated = instanceIds(await tab(deputy, 'delegated'));
      if (!delegated.has(soon) || !delegated.has(late)) wrong.push('کارهای تفویض‌شده در زبانه «دریافتی از تفویض» جانشین نیامدند');
      const ownDelegated = instanceIds(await tab(accountant, 'delegated'));
      if (ownDelegated.has(soon)) wrong.push('کار خود حسابدار در زبانه «دریافتی از تفویض» او آمد');
      const deputyStats = (await h.get('/api/workflow/tasks/stats', deputy)).body ?? {};
      if (!(Number(deputyStats.delegatedCount) >= 2)) wrong.push(`آمار تفویض جانشین ${String(deputyStats.delegatedCount)} است`);

      // ۳) تکمیل‌شده: کاری که حسابدار اجرا کرد
      const soonTask = (await h.q(`SELECT id FROM workflow_tasks WHERE instance_id = $1 AND status = 'pending' ORDER BY id LIMIT 1`, [soon]))[0];
      const exec = await h.post(`/api/workflow/tasks/${soonTask?.id}/execute`, { action: 'approve' }, accountant);
      if (exec.status !== 200) wrong.push(`اجرای کار ${exec.status} داد: ${JSON.stringify(exec.body).slice(0, 160)}`);
      const completed = await tab(accountant, 'completed');
      if (!instanceIds(completed).has(soon)) wrong.push('کار اجراشده در زبانه «تکمیل‌شده» نیامد');
      const statsAfter = (await h.get('/api/workflow/tasks/stats', accountant)).body ?? {};
      if (!(Number(statsAfter.completedCount) >= 1)) wrong.push(`آمار تکمیل‌شده ${String(statsAfter.completedCount)} است`);
      if (instanceIds(await tab(deputy, 'completed')).has(soon)) wrong.push('کار اجراشده حسابدار در «تکمیل‌شده» جانشین آمد');

      // ۴) ورودی نادرست
      for (const bad of [`status=${encodeURIComponent("x' OR 1=1")}`, 'page=-3', 'limit=0']) {
        const res = await h.get(`/api/workflow/tasks/my-tasks?${bad}`, accountant);
        if (res.status !== 400) wrong.push(`پرس‌وجوی «${bad}» ${res.status} داد، نه ۴۰۰`);
      }
    });
  }

  return results;
}
