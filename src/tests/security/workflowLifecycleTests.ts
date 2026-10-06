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

  return results;
}
