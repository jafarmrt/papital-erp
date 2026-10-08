import { pool } from '../../db/drizzle.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { outcomeProblems, raceBehindRowLock } from './concurrencyHarness.js';
import {
  defineWorkflow, instanceRow, refusal, resaveWorkflow, runTask, startWf, tasksOf, transit, wfUser,
} from './workflowScenarioHelpers.js';

/**
 * v8.0.90 به بعد — سناریوهای سخت‌گیرانه گردش‌کار و تأیید (حوزه G، V8_MASTER_ROADMAP.md بخش ۶).
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const FOUR_STATES = [
  { key: 'draft', type: 'initial' as const }, { key: 'review' },
  { key: 'approved', type: 'terminal' as const }, { key: 'rejected', type: 'terminal' as const },
];

/**
 * TD-370: کار کارتابل همان انتقال خودش را اجرا می‌کند و «رد» فقط انتقال رد را. پیش‌تر تأیید اولین انتقال رو به جلوی
 * جدول را برمی‌داشت (کار «ارسال برای بررسی» مدیر، «تأیید مستقیم» را اجرا می‌کرد و کاربر عادی خطای نقش می‌گرفت)
 * و «رد» در گامی که انتقال رد نداشت همان تأیید را اجرا می‌کرد.
 */
export async function checkTaskRunsItsOwnTransition(): Promise<string[]> {
  const problems: string[] = [];
  const admin = await wfUser('admin', []);
  const clerk = await wfUser(`wfg_clerk`);
  const wf = await defineWorkflow({
    states: FOUR_STATES,
    transitions: [
      { from: 'draft', to: 'approved', action: 'direct_approve', role: 'admin' },
      { from: 'draft', to: 'review', action: 'submit' },
      { from: 'review', to: 'approved', action: 'approve' },
    ],
  });

  for (const [user, label] of [[admin, 'مدیر'], [clerk, 'کاربر عادی']] as const) {
    const instanceId = await startWf(wf);
    const submitTask = (await tasksOf(instanceId)).find(t => t.transition_id === wf.transitionId.submit);
    if (!submitTask) { problems.push(`task "submit for review" was not created for ${label}`); continue; }
    const error = await refusal(() => runTask(submitTask.id, user));
    const row = await instanceRow(instanceId);
    if (error) problems.push(`running the "submit for review" task by ${label} was refused: ${error}`);
    else if (row.currentStateId !== wf.stateId.review) problems.push(`the "submit for review" task of ${label} moved the workflow to another step (${row.status}), not "review"`);
  }

  // گام بی‌انتقال رد: «رد» پذیرفته نمی‌شود و فرایند و کار سر جایشان می‌مانند
  const instanceId = await startWf(wf);
  await transit(instanceId, wf.transitionId.submit, clerk);
  const [reviewTask] = await tasksOf(instanceId);
  const rejectError = await refusal(() => runTask(reviewTask.id, clerk, 'reject'));
  const afterReject = await instanceRow(instanceId);
  if (!rejectError) problems.push('"reject" was accepted on a step without a reject transition');
  if (afterReject.currentStateId !== wf.stateId.review) problems.push(`"reject" on a step without a reject transition moved the workflow (${afterReject.status})`);
  if ((await tasksOf(instanceId)).length !== 1) problems.push('the task of a step without a reject transition did not stay pending after a failed "reject"');

  // گام دارای انتقال رد: «رد» فرایند را رد می‌کند
  const withReject = await defineWorkflow({
    states: FOUR_STATES,
    transitions: [
      { from: 'draft', to: 'review', action: 'submit' },
      { from: 'review', to: 'approved', action: 'approve' },
      { from: 'review', to: 'rejected', action: 'reject' },
    ],
  });
  const second = await startWf(withReject);
  await transit(second, withReject.transitionId.submit, clerk);
  const [task] = await tasksOf(second);
  const error = await refusal(() => runTask(task.id, clerk, 'reject'));
  const rejected = await instanceRow(second);
  if (error || rejected.status !== 'REJECTED') problems.push(`"reject" on a step with a reject transition did not reject the workflow (${error ?? rejected.status})`);
  return problems;
}

/**
 * TD-371: در امضای چندنفره (K_OF_N) کار کارتابل تا رسیدن حدنصاب باز می‌ماند. پیش‌تر امضای اول کار را «تأییدشده»
 * می‌بست، کار از کارتابل بقیه بیرون می‌رفت و امضای دوم از کارتابل «قبلاً تعیین تکلیف شده» برمی‌گشت.
 */
export async function checkMultiSignTaskStaysOpen(): Promise<string[]> {
  const problems: string[] = [];
  const [first, second] = [await wfUser('wfg_signer'), await wfUser('wfg_signer')];
  const wf = await defineWorkflow({
    states: FOUR_STATES,
    transitions: [
      { from: 'draft', to: 'review', action: 'submit' },
      { from: 'review', to: 'approved', action: 'approve', rule: 'K_OF_N', k: 2 },
      { from: 'review', to: 'rejected', action: 'reject' },
    ],
  });
  const instanceId = await startWf(wf);
  await transit(instanceId, wf.transitionId.submit, first);
  const [task] = await tasksOf(instanceId);

  await runTask(task.id, first);
  const again = await runTask(task.id, first) as { alreadySigned?: boolean };
  if (!again.alreadySigned) problems.push('a second signature by the same user from the inbox was not recognized as "duplicate signature"');
  if ((await tasksOf(instanceId)).length !== 1) problems.push('the task closed after the first of 2 required signatures');
  const half = await instanceRow(instanceId);
  const signatures = half.progress[String(wf.transitionId.approve)]?.signatures?.length ?? 0;
  if (signatures !== 1) problems.push(`after the first signature and its repeat ${signatures} signatures were recorded, not 1`);

  const error = await refusal(() => runTask(task.id, second));
  const done = await instanceRow(instanceId);
  if (error || done.status !== 'COMPLETED') problems.push(`the second signature from the inbox did not complete the quorum (${error ?? done.status})`);
  const closed = await pool.query<{ status: string }>('SELECT status FROM workflow_tasks WHERE id = $1', [task.id]);
  if (closed.rows[0]?.status !== 'approved') problems.push(`the task after reaching the quorum is "${closed.rows[0]?.status}", not "approved"`);
  return problems;
}

/**
 * TD-372: فرایند در جریان پس از ویرایش طرح در طراح، کارهای گام بعد و مهلت آن را از تصویر نسخه خودش می‌گیرد. پیش‌تر
 * کارها از جدول‌های جاری (با شناسه‌های تازه) ساخته می‌شد و فرایند پس از یک گام بی‌کار و بی‌مهلت از کارتابل بیرون می‌رفت.
 */
export async function checkRunningInstanceKeepsTasksAfterEdit(): Promise<string[]> {
  const problems: string[] = [];
  const admin = await wfUser('admin', []);
  const wf = await defineWorkflow({
    states: [{ key: 'a', type: 'initial' }, { key: 'b', slaHours: 5 }, { key: 'c', type: 'terminal' }],
    transitions: [{ from: 'a', to: 'b', action: 'to_b' }, { from: 'b', to: 'c', action: 'to_c' }],
  });
  const instanceId = await startWf(wf);
  await resaveWorkflow(wf);

  const [first] = await tasksOf(instanceId);
  const error = await refusal(() => runTask(first.id, admin));
  if (error) return [`the first step task did not run after the design edit: ${error}`];
  const atB = await instanceRow(instanceId);
  if (atB.currentStateId !== wf.stateId.b) problems.push('the workflow did not move to the second step of its own version');
  const next = await tasksOf(instanceId);
  if (next.length !== 1 || next[0].transition_id !== wf.transitionId.to_c) {
    problems.push(`after the design edit, the second step of the running workflow got ${next.length} tasks (transition ${next.map(t => t.transition_id).join(', ') || '-'}), not the task of its own version's transition`);
    return problems;
  }
  const hours = next[0].due_at ? (new Date(next[0].due_at).getTime() - Date.now()) / 3600000 : null;
  if (hours === null || hours < 4.5 || hours > 5.5) problems.push(`the second step task deadline is ${hours === null ? 'empty' : hours.toFixed(1) + ' hours'}, not the step's 5 hours`);
  const last = await refusal(() => runTask(next[0].id, admin));
  const done = await instanceRow(instanceId);
  if (last || done.status !== 'COMPLETED') problems.push(`the second step task did not finish the workflow (${last ?? done.status})`);
  return problems;
}

/**
 * TD-373: امضاهای یک گام وقتی فرایند (پس از رد یا بازگشت) دوباره به آن گام می‌رسد از نو شمرده می‌شوند. پیش‌تر امضای
 * دور قبل می‌ماند: همان کاربر گام تک‌امضایی را پس از بازگشت دوباره اجرا نمی‌توانست («امضای تکراری» و فرایند سر جایش)،
 * امضاکننده قبلی دوباره شمرده نمی‌شد و یک امضای تازه با امضای کهنه حدنصاب ۲ را کامل می‌کرد.
 */
export async function checkSignaturesResetOnReentry(): Promise<string[]> {
  const problems: string[] = [];
  const [a, b, c] = [await wfUser('wfg_board'), await wfUser('wfg_board'), await wfUser('wfg_board')];
  const wf = await defineWorkflow({
    states: FOUR_STATES,
    transitions: [
      { from: 'draft', to: 'review', action: 'submit' },
      { from: 'review', to: 'approved', action: 'approve', rule: 'K_OF_N', k: 2 },
      { from: 'review', to: 'draft', action: 'reject_to_draft' },
    ],
  });
  const instanceId = await startWf(wf);
  const steps = [
    ['submit', c, 'ارسال', 'review'], ['approve', a, 'امضای اول دور اول', 'review'], ['reject_to_draft', c, 'return to draft', 'draft'],
    ['submit', c, 'ارسال دوباره همان کاربر', 'review'], ['approve', a, 'امضای دوباره عضو اول', 'review'],
  ] as const;
  for (const [action, user, label, expected] of steps) {
    const error = await refusal(() => transit(instanceId, wf.transitionId[action], user));
    const row = await instanceRow(instanceId);
    if (error) return [...problems, `${label} رد شد: ${error}`];
    if (row.currentStateId !== wf.stateId[expected]) return [...problems, `پس از «${label}» فرایند در گام «${expected}» نیست (${row.status})`];
  }
  const signatures = (await instanceRow(instanceId)).progress[String(wf.transitionId.approve)]?.signatures ?? [];
  if (signatures.length !== 1) problems.push(`after the return and the first member signing again ${signatures.length} signatures were counted, not 1`);
  await transit(instanceId, wf.transitionId.approve, b);
  if ((await instanceRow(instanceId)).status !== 'COMPLETED') problems.push('two fresh signatures of the second round did not complete the quorum');
  return problems;
}

/**
 * TD-374: مجوز «مشاهده» (warehouse.view، accounting.view) یا مجوز خزانه گام نقش انبار یا حسابداری را اجرا نمی‌کند و
 * نقش تولید گام «مدیر» را. v9.0.128 (TD-542): گام نقش‌دار فقط برای همان نقش و مدیر سیستم است؛ نقش هم‌ارز بخش و مجوز
 * ثبت بخش هم دیگر آن را باز نمی‌کنند (چه کسی را مجوز لازم انتقال می‌گوید).
 */
export async function checkViewPermissionCannotApprove(): Promise<string[]> {
  const problems: string[] = [];
  const match = WorkflowTransitionExecutor.checkUserRoleMatch.bind(WorkflowTransitionExecutor);
  const refused: Array<[string, string, string]> = [
    ['sales_manager', 'warehouse', 'sales manager on the warehouse step'],
    ['viewer', 'warehouse_keeper', 'بیننده گام انباردار'],
    ['treasurer', 'accountant', 'خزانه‌دار گام حسابدار'],
    ['production_manager', 'manager', 'production manager on the manager step'],
    ['sales_manager', 'manager', 'sales manager on the manager step'],
    ['production_manager', 'warehouse', 'another role on the warehouse step'],
    ['cfo_accountant', 'accounting', 'CFO on the "accounting" role step'],
    ['cfo_accountant', 'accountant', 'CFO on the accountant step'],
    ['wfg_any', 'accountant', 'custom role on the accountant step'],
  ];
  for (const [role, required, label] of refused) {
    if (match(role, required)) problems.push(`${label}: allowed to run`);
  }
  const allowed: Array<[string, string, string]> = [
    ['warehouse_keeper', 'warehouse_keeper', 'warehouse keeper on the warehouse keeper step'],
    ['accountant', 'accountant', 'حسابدار گام حسابدار'],
    ['manager', 'manager', 'مدیر گام مدیر'],
    ['admin', 'manager', 'مدیر سیستم گام مدیر'],
    ['wfg_any', '', 'any role on a step without a role'],
  ];
  for (const [role, required, label] of allowed) {
    if (!match(role, required)) problems.push(`${label}: not allowed to run`);
  }

  // سرتاسری: مدیر فروش با warehouse.view گام انبار را از API انتقال اجرا نمی‌کند
  const sales = await wfUser('sales_manager', ['warehouse.view', 'workflow.approve']);
  const wf = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve_warehouse', role: 'warehouse_keeper' }],
  });
  const instanceId = await startWf(wf);
  const error = await refusal(() => transit(instanceId, wf.transitionId.approve_warehouse, sales));
  if (!error) problems.push('sales manager with warehouse.view ran the warehouse step through the transition API');
  return problems;
}

/**
 * TD-375: اجرای کار کارتابل هم‌زمان با اجرای مستقیم همان گام (از ویجت سند) به بن‌بست نمی‌رسد. پیش‌تر کار ردیف کار را
 * پیش از ردیف فرایند قفل می‌کرد و مسیر مستقیم برعکس (فرایند، سپس لغو کارها) و یکی با 40P01 شکست می‌خورد.
 */
export async function checkTaskAndTransitionNoDeadlock(): Promise<string[]> {
  const problems: string[] = [];
  const [direct, inbox] = [await wfUser('wfg_race'), await wfUser('wfg_race')];
  const wf = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'review' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'review', action: 'submit' }, { from: 'review', to: 'done', action: 'finish' }],
  });
  for (let round = 1; round <= 3; round++) {
    const instanceId = await startWf(wf);
    const [task] = await tasksOf(instanceId);
    const outcomes = await raceBehindRowLock<unknown>('workflow_instances', [instanceId], [
      () => transit(instanceId, wf.transitionId.submit, direct),
      () => runTask(task.id, inbox),
    ], { staggered: true });
    const staleRefusal = (_label: string, message: string) => message.includes('مطابقت ندارد');
    problems.push(...outcomeProblems([`round ${round}: direct run`, `round ${round}: task run`], outcomes, staleRefusal));
    const moves = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM workflow_history_logs WHERE instance_id = $1 AND action_key = 'submit'`, [instanceId]);
    if (moves.rows[0].n !== 1) problems.push(`round ${round}: step "submit" ran ${moves.rows[0].n} times, not once`);
    const row = await instanceRow(instanceId);
    if (row.currentStateId !== wf.stateId.review) problems.push(`round ${round}: the workflow is not on the "review" step`);
  }
  return problems;
}
