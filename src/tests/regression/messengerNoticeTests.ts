import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowTasks } from '../../db/schema.js';
import { approvalInboxInstanceLink } from '../../lib/notifications/notificationNotices.js';
import { notifyWorkflowTasksArrived } from '../../services/workflow/workflowTaskNotice.js';
import { addLog, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { createHarness, draftSalesDocument } from '../security/workflowTestHarness.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxClientWith } from './fiscalClosingTests.js';
import { q } from './projectStageIntegrityTests.js';

/**
 * v10.1.42 (messenger notifications plan part 3, ت۳ الف / ت۴ الف): two new notices, each in the bell and on the
 * recipient's linked messenger, written in the transaction of the change they report. An approved payslip notifies the
 * user linked to its personnel with the Jalali month and no amount; a workflow step notifies everyone who will see its
 * task in their approval inbox, not the user who moved the record there. Real routes on PostgreSQL; each case is red on
 * v10.1.39, which wrote neither notice.
 */

type Res = { status: number; body?: unknown };
const brief = (res: Res) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const idOf = (res: Res) => Number((res.body as { id?: unknown } | undefined)?.id);

const APPROVED_TITLE = 'فیش حقوق شما تأیید شد';
const PAYSLIP_MONTH = 'اردیبهشت ۱۴۰۵';
const TASK_TITLE = 'کار تازه در کارتابل';
const WORKFLOW_TASK_SENTENCE = 'یک کار تازه در کارتابل تأیید منتظر شماست.';
// v10.2.28: a seven-digit amount no payslip number or date can hold; the old check looked for «735» and failed whenever
// the payslip number shown in the notice held those digits
const PAYSLIP_AMOUNT = 7_351_973;
/** whether a text names the amount, in Latin or Persian digits, with or without thousands separators */
const carriesAmount = (text: string, amount: number) =>
  text.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٬,\s]/g, '').includes(String(amount))
  || /ریال|تومان/.test(text);

async function linkMessenger(userId: number, chatId: string): Promise<number> {
  const [row] = await q(`INSERT INTO user_messenger_links (user_id, messenger, chat_id, chat_name) VALUES ($1, 'bale', $2, 'test') RETURNING id`, [userId, chatId]);
  return Number(row.id);
}

const bellOf = (userId: number, title: string) =>
  q('SELECT id, message, link FROM notifications WHERE user_id = $1 AND title = $2 ORDER BY id', [userId, title]);

const jobsOf = (linkId: number) =>
  q(`SELECT event FROM integration_delivery_jobs WHERE kind = 'messenger' AND target_id = $1 ORDER BY id`, [linkId]);

const payloadOf = (row: Record<string, unknown> | undefined) =>
  ((row?.event as { payload?: { category?: string; text?: string; link?: string } } | undefined)?.payload ?? {});

export async function runMessengerNoticeTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const payslipId = 'reg_messenger_payslip_approved_notice';
  if (shouldRun(payslipId, 'messenger', 'payroll', 'notice')) {
    await runCase(results, payslipId, 'v10.1.42: approving a draft payslip notifies the user linked to its personnel in the bell and on the linked messenger, with the Jalali month and no amount; issuing notifies nobody, a personnel without a user approves silently, a payslip without insurance or tax notifies the same way', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const issuer = await sandboxClientWith(['piecework.view', 'piecework.payroll']);
      const approver = await sandboxClientWith(['piecework.view', 'piecework.payroll_approve']);
      const owner = await sandboxClientWith([]);
      const worker = await newWorker('notice worker');
      await addLog(worker, await newTask(), '2026-04-08', PAYSLIP_AMOUNT);
      await q('UPDATE personnel SET user_id = $1 WHERE id = $2', [owner.userId, worker]);
      const linkId = await linkMessenger(owner.userId, '9101');

      const issued = await issuer.post('/api/piecework/payrolls/generate', { personnelId: worker, startDate: '2026-04-01', endDate: '2026-04-30' });
      const payrollId = idOf(issued);
      if (issued.status !== 201 || !payrollId) throw new Error(`setup: payslip ${brief(issued)}`);
      const [pay] = await q('SELECT net_payable FROM piecework_payrolls WHERE id = $1', [payrollId]);
      if (Number(pay?.net_payable) !== PAYSLIP_AMOUNT) throw new Error(`setup: the payslip pays ${String(pay?.net_payable)}, expected ${PAYSLIP_AMOUNT}`);
      if ((await bellOf(owner.userId, APPROVED_TITLE)).length !== 0) problems.push('issuing a draft payslip already notified its owner');

      const approved = await approver.put(`/api/piecework/payrolls/${payrollId}/status`, { status: 'approved' });
      if (approved.status !== 200) throw new Error(`approve: ${brief(approved)}`);
      const bell = await bellOf(owner.userId, APPROVED_TITLE);
      const message = String(bell[0]?.message ?? '');
      if (bell.length !== 1) problems.push(`the approval wrote ${bell.length} bell rows for the owner, expected 1`);
      if (!message.includes(PAYSLIP_MONTH)) problems.push(`the notice does not name the month: ${message}`);
      if (carriesAmount(message, PAYSLIP_AMOUNT)) problems.push(`the notice carries an amount: ${message}`);
      if (bell[0]?.link !== '/my-payslips') problems.push(`the notice links to ${String(bell[0]?.link)}, expected /my-payslips`);
      const [job] = await jobsOf(linkId);
      const payload = payloadOf(job);
      // the messenger gets the payslip's fixed sentence (security review of part 2), the month stays in the bell
      if (payload.category !== 'payslip' || !String(payload.text ?? '').endsWith('فیش حقوق شما تأیید شد.') || carriesAmount(String(payload.text), PAYSLIP_AMOUNT)
        || payload.link !== '/my-payslips') {
        problems.push(`the messenger job is missing or wrong: ${JSON.stringify(payload).slice(0, 200)}`);
      }
      if ((await bellOf(approver.userId, APPROVED_TITLE)).length !== 0) problems.push('the approver was notified instead of the owner');

      const loner = await newWorker('notice worker without user');
      await addLog(loner, await newTask(), '2026-04-09', 400_000);
      const lonerIssued = await issuer.post('/api/piecework/payrolls/generate', { personnelId: loner, startDate: '2026-04-01', endDate: '2026-04-30' });
      const lonerApproved = await approver.put(`/api/piecework/payrolls/${idOf(lonerIssued)}/status`, { status: 'approved' });
      if (lonerApproved.status !== 200) problems.push(`approving the payslip of a personnel without a user answered ${brief(lonerApproved)}, expected 200`);
      const [stray] = await q('SELECT count(*)::int AS n FROM notifications WHERE title = $1', [APPROVED_TITLE]);
      if (Number(stray?.n) !== 1) problems.push(`a personnel without a user produced a notice (${String(stray?.n)} in all)`);

      assertNoProblems(problems);
      return 'Issue notified nobody; approval wrote one bell row and one messenger job naming the month without the amount; a personnel without a user was approved without a notice.';
    }));
  }

  const taskId = 'reg_messenger_workflow_task_notice';
  if (shouldRun(taskId, 'messenger', 'workflow', 'notice')) {
    await runCase(results, taskId, 'v10.1.42: sending a sales proforma to the warehouse notifies the warehouse keeper who will see the task in the inbox, in the bell and on the linked messenger with a fixed sentence and its inbox link (v11 6.4, C11), no amount; the seller who sent it and a user without the step permission get nothing', async () => {
      const h = await createHarness();
      const users: number[] = [];
      try {
        const problems: string[] = [];
        const seller = await h.sessionWith(['documents.view', 'documents.create', 'documents.edit', 'workflow.view', 'workflow.execute']);
        const keeper = await h.sessionWith(['warehouse.view', 'warehouse.out', 'workflow.view', 'workflow.execute']);
        const bystander = await h.sessionWith(['documents.view', 'workflow.view', 'workflow.execute']);
        users.push(seller.userId, keeper.userId, bystander.userId);
        const linkId = await linkMessenger(keeper.userId, `9201${h.tag}`);

        const proforma = await draftSalesDocument(h, 'proforma');
        const started = await h.start({ workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: proforma }, seller);
        const instanceId = Number(started.body?.data?.id);
        if (!(instanceId > 0)) throw new Error(`start: ${started.status} ${JSON.stringify(started.body).slice(0, 160)}`);
        if ((await bellOf(keeper.userId, TASK_TITLE)).length !== 0) problems.push('the keeper was notified before the proforma reached the warehouse step');

        const walk = await h.walk(instanceId, ['submit_to_warehouse'], seller);
        if (walk[0] !== 200) throw new Error(`send to warehouse: ${walk.join(',')}`);
        const [doc] = await h.q('SELECT ref_number FROM documents WHERE id = $1', [proforma]);
        const ref = String(doc?.ref_number ?? '').replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
        const bell = await bellOf(keeper.userId, TASK_TITLE);
        const message = String(bell[0]?.message ?? '');
        if (bell.length !== 1) problems.push(`the keeper got ${bell.length} task notices, expected 1`);
        if (!ref || !message.includes(ref)) problems.push(`the notice does not name document ${ref}: ${message}`);
        if (/5000|۵۰۰۰|ریال/.test(message)) problems.push(`the notice carries an amount: ${message}`);
        // v11 phase 6.3p (U6): the notice opens its own task in the inbox
        if (bell[0]?.link !== approvalInboxInstanceLink(instanceId)) problems.push(`the notice links to ${String(bell[0]?.link)}`);
        const [job] = await jobsOf(linkId);
        // v11 phase 6.4 (C11): the messenger gets the fixed sentence and the record's inbox link, never the step title typed in the designer
        const sentText = String(payloadOf(job).text ?? '');
        if (payloadOf(job).category !== 'workflow_task' || !sentText.endsWith(WORKFLOW_TASK_SENTENCE) || sentText.includes('«')
          || payloadOf(job).link !== approvalInboxInstanceLink(instanceId)) problems.push(`the keeper's messenger job is missing or wrong: ${JSON.stringify(payloadOf(job)).slice(0, 200)}`);
        if ((await bellOf(seller.userId, TASK_TITLE)).length !== 0) problems.push('the seller who sent the proforma was notified of their own move');
        if ((await bellOf(bystander.userId, TASK_TITLE)).length !== 0) problems.push('a user without warehouse.out was notified');

        assertNoProblems(problems);
        return 'Start notified nobody; sending to the warehouse gave the keeper one bell row and one messenger job naming the document; the seller and a user without the permission got nothing.';
      } finally {
        if (users.length > 0) {
          await h.q(`DELETE FROM integration_delivery_jobs WHERE kind = 'messenger' AND target_id IN (SELECT id FROM user_messenger_links WHERE user_id = ANY($1::int[]))`, [users]);
          await h.q('DELETE FROM user_messenger_links WHERE user_id = ANY($1::int[])', [users]);
          await h.q('DELETE FROM notifications WHERE user_id = ANY($1::int[])', [users]);
        }
        await h.cleanup();
      }
    });
  }

  const initiatorId = 'reg_messenger_initiator_only_task_notice';
  if (shouldRun(initiatorId, 'messenger', 'workflow', 'notice', 'initiator')) {
    await runCase(results, initiatorId, 'v10.1.43: a step only the initiator runs notifies the starter only while the starter is a live user holding the step permission; a deleted starter, or one whose role lost the permission, gets no task notice', async () => {
      const h = await createHarness();
      const users: number[] = [];
      try {
        const problems: string[] = [];
        const seller = await h.sessionWith(['documents.view', 'documents.create', 'documents.edit', 'workflow.view', 'workflow.execute']);
        const mover = await h.sessionWith(['documents.view', 'workflow.view', 'workflow.execute']);
        users.push(seller.userId, mover.userId);
        const proforma = await draftSalesDocument(h, 'proforma');
        const started = await h.start({ workflowCode: 'DOC_APPROVAL_WORKFLOW', entityType: 'document', entityId: proforma }, seller);
        const instanceId = Number(started.body?.data?.id);
        if (!(instanceId > 0)) throw new Error(`start: ${started.status} ${JSON.stringify(started.body).slice(0, 160)}`);
        const tasks = await orm.select().from(workflowTasks)
          .where(and(eq(workflowTasks.instanceId, instanceId), eq(workflowTasks.status, 'pending')));
        if (tasks.length === 0) throw new Error('the started proforma has no pending task at its first step');
        const notify = () => orm.transaction(tx => notifyWorkflowTasksArrived(tx, instanceId, tasks, { actorUserId: mover.userId }));
        const clearBell = () => h.q('DELETE FROM notifications WHERE user_id = $1 AND title = $2', [seller.userId, TASK_TITLE]);

        await notify();
        if ((await bellOf(seller.userId, TASK_TITLE)).length !== 1) problems.push('the live starter holding documents.create was not notified of the initiator-only step');
        await clearBell();

        await h.q('UPDATE users SET is_deleted = 1 WHERE id = $1', [seller.userId]);
        await notify();
        if ((await bellOf(seller.userId, TASK_TITLE)).length !== 0) problems.push('a deleted starter was notified of the initiator-only step');
        await h.q('UPDATE users SET is_deleted = 0 WHERE id = $1', [seller.userId]);
        await clearBell();

        await h.q(`UPDATE roles SET permissions = permissions - 'documents.create' WHERE code = $1`, [seller.role]);
        await notify();
        if ((await bellOf(seller.userId, TASK_TITLE)).length !== 0) problems.push('a starter whose role lost documents.create was notified of the initiator-only step');

        assertNoProblems(problems);
        return 'The live starter with the permission got one notice; once deleted, and once without documents.create, the starter got none.';
      } finally {
        if (users.length > 0) {
          await h.q('UPDATE users SET is_deleted = 0 WHERE id = ANY($1::int[])', [users]);
          await h.q('DELETE FROM notifications WHERE user_id = ANY($1::int[])', [users]);
        }
        await h.cleanup();
      }
    });
  }

  return results;
}
