import { pool } from '../../db/drizzle.js';
import { WorkflowDelegationService } from '../../services/workflow/workflowDelegationService.js';
import { WorkflowTaskService } from '../../services/workflow/workflowTaskService.js';
import { WorkflowSlaReminderService } from '../../services/workflow/workflowSlaReminderService.js';
import {
  defineWorkflow, instanceRow, refusal, refusalStatus, runTask, startWf, tasksOf, transit, uniqueTag, wfUser, type WfUser,
} from './workflowScenarioHelpers.js';

/**
 * v8.0.87 به بعد — سناریوهای امضای «اتفاق آرا» و تفویض اختیار گردش‌کار (حوزه G).
 * هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

const hourIso = (offsetHours: number): string => new Date(Date.now() + offsetHours * 3600000).toISOString();

/**
 * TD-376 (تصمیم مالک محصول «همه اعضای نقش»): گام AND_ALL وقتی رد می‌شود که همه کاربران فعال نقش لازم امضا کنند؛ کاربر
 * حذف‌شده شمرده نمی‌شود و گام بی‌نقش همان K طراح را می‌خواهد. پیش‌تر AND_ALL همیشه دو امضا (یا K بیشتر) می‌خواست:
 * نقش سه‌نفره با دو امضا رد می‌شد و نقش یک‌نفره هرگز.
 */
export async function checkAndAllNeedsEveryMember(): Promise<string[]> {
  const problems: string[] = [];
  const role = `wfg_all_${uniqueTag()}`;
  const members = [await wfUser(role), await wfUser(role), await wfUser(role)];
  await wfUser(role, ['workflow.approve'], 1);
  const wf = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', role, rule: 'AND_ALL', k: 1 }],
  });
  const instanceId = await startWf(wf);
  await transit(instanceId, wf.transitionId.approve, members[0]);
  await transit(instanceId, wf.transitionId.approve, members[1]);
  const two = await instanceRow(instanceId);
  if (two.status !== 'IN_PROGRESS') problems.push(`گام «اتفاق آرا» نقش سه‌نفره با دو امضا رد شد (${two.status})`);
  const required = two.progress[String(wf.transitionId.approve)]?.requiredCount;
  if (required !== 3) problems.push(`امضای لازم گام «اتفاق آرا» نقش سه‌نفره (و یک کاربر حذف‌شده) ${required} است، نه ۳`);
  const third = await refusal(() => transit(instanceId, wf.transitionId.approve, members[2]));
  if (third || (await instanceRow(instanceId)).status !== 'COMPLETED') problems.push(`گام «اتفاق آرا» با امضای هر سه عضو رد نشد (${third ?? 'در جریان'})`);

  const soloRole = `wfg_solo_${uniqueTag()}`;
  const solo = await wfUser(soloRole);
  const soloWf = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', role: soloRole, rule: 'AND_ALL', k: 1 }],
  });
  const soloInstance = await startWf(soloWf);
  await transit(soloInstance, soloWf.transitionId.approve, solo);
  if ((await instanceRow(soloInstance)).status !== 'COMPLETED') problems.push('گام «اتفاق آرا» نقش یک‌نفره با امضای تنها عضو رد نشد');

  const open = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', rule: 'AND_ALL', k: 2 }],
  });
  const openInstance = await startWf(open);
  await transit(openInstance, open.transitionId.approve, members[0]);
  if ((await instanceRow(openInstance)).status !== 'IN_PROGRESS') problems.push('گام «اتفاق آرا» بی‌نقش با K=۲ با یک امضا رد شد');
  await transit(openInstance, open.transitionId.approve, members[1]);
  if ((await instanceRow(openInstance)).status !== 'COMPLETED') problems.push('گام «اتفاق آرا» بی‌نقش با K=۲ با دو امضا رد نشد');
  return problems;
}

async function delegate(from: WfUser, to: WfUser, scope = 'ALL'): Promise<number> {
  const created = await WorkflowDelegationService.createDelegation({
    fromUserId: from.id, toUserId: to.id, scope, startDate: hourIso(-1), endDate: hourIso(24), reason: 'مرخصی آزمون',
  });
  return created.id;
}

/**
 * TD-377 (تصمیم مالک محصول «کارهای نقش او»): جانشین در بازه و حوزه تفویض کارهای نقش تفویض‌کننده را در کارتابل می‌بیند و
 * انجام می‌دهد؛ امضایش به نام تفویض‌کننده ثبت می‌شود و یک نفر دو امضا نمی‌شمارد. پیش‌تر کارها نقشی بودند و تفویض هیچ اثری
 * نداشت (جانشین کار نمی‌دید و اجرا «غیرمجاز» بود).
 */
export async function checkDelegateActsForDelegatorRole(): Promise<string[]> {
  const problems: string[] = [];
  const role = `wfg_acc_${uniqueTag()}`;
  const [owner, colleague] = [await wfUser(role), await wfUser(role)];
  const deputy = await wfUser(`wfg_deputy_${uniqueTag()}`);
  const wf = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial', slaHours: 1 }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', role, rule: 'K_OF_N', k: 2 }],
  });
  await delegate(owner, deputy);
  const instanceId = await startWf(wf);
  const [task] = await tasksOf(instanceId);

  const inbox = await WorkflowTaskService.getMyTasks({ userId: deputy.id, userRole: deputy.role });
  const seen = inbox.data.find(t => t.id === task.id);
  if (!seen) problems.push('کار نقش تفویض‌کننده در کارتابل جانشین دیده نشد');
  else if (seen.delegationInfo?.delegatedFromUserId !== owner.id) problems.push('کارتابل جانشین نشان نداد کار از تفویض کدام کاربر است');
  const stats = await WorkflowTaskService.getTaskStats({ userId: deputy.id, userRole: deputy.role });
  if (stats.pendingCount < 1) problems.push('شمار کارهای جانشین کار تفویض‌شده را نشمرد');

  const error = await refusal(() => runTask(task.id, deputy));
  if (error) return [...problems, `جانشین کار نقش تفویض‌کننده را انجام نداد: ${error}`];
  const signatures = (await instanceRow(instanceId)).progress[String(wf.transitionId.approve)]?.signatures ?? [];
  if (signatures.length !== 1 || signatures[0].userId !== owner.id || signatures[0].signedBy !== deputy.id) {
    problems.push(`امضای جانشین به نام تفویض‌کننده ثبت نشد (${JSON.stringify(signatures)})`);
  }
  const ownerAgain = await transit(instanceId, wf.transitionId.approve, owner) as { alreadySigned?: boolean };
  if (!ownerAgain.alreadySigned) problems.push('تفویض‌کننده پس از امضای جانشینش امضای دوم شمرده شد');
  const deputyAgain = await runTask(task.id, deputy) as { alreadySigned?: boolean };
  if (!deputyAgain.alreadySigned) problems.push('جانشین دو بار امضا شمرده شد');
  if ((await instanceRow(instanceId)).status !== 'IN_PROGRESS') problems.push('حدنصاب ۲ با یک نفر (و جانشینش) کامل شد');
  await runTask(task.id, colleague);
  if ((await instanceRow(instanceId)).status !== 'COMPLETED') problems.push('امضای همکار دوم حدنصاب را کامل نکرد');

  // تفویض حوزه دیگر یا لغوشده اجازه نمی‌دهد
  const other = await wfUser(`wfg_deputy_${uniqueTag()}`);
  await delegate(owner, other, 'OTHER_WORKFLOW_CODE');
  const revokedDeputy = await wfUser(`wfg_deputy_${uniqueTag()}`);
  const revokedId = await delegate(owner, revokedDeputy);
  await WorkflowDelegationService.revokeDelegation({ id: revokedId, userId: owner.id, userRole: owner.role });
  const second = await startWf(wf);
  const [secondTask] = await tasksOf(second);
  if (!(await refusal(() => runTask(secondTask.id, other)))) problems.push('تفویض حوزه گردش‌کار دیگر اجازه اجرای کار داد');
  if (!(await refusal(() => runTask(secondTask.id, revokedDeputy)))) problems.push('تفویض لغوشده اجازه اجرای کار داد');

  // یادآوری مهلت به جانشین فعال نقش هم می‌رسد
  await pool.query(`UPDATE workflow_tasks SET due_at = $2 WHERE id = $1`, [secondTask.id, hourIso(-1)]);
  await WorkflowSlaReminderService.sendDueReminders();
  const notified = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM notifications WHERE user_id = ANY($1::int[]) AND title = 'مهلت کار تاییدی گذشت'`, [[deputy.id, other.id, revokedDeputy.id]]);
  const ids = notified.rows.map(r => r.user_id);
  if (!ids.includes(deputy.id)) problems.push('یادآوری مهلت به جانشین فعال نقش نرسید');
  if (ids.includes(other.id) || ids.includes(revokedDeputy.id)) problems.push('یادآوری مهلت به جانشین حوزه دیگر یا لغوشده رسید');
  return problems;
}

/**
 * TD-378: تفویض را فقط تفویض‌کننده یا ادمین لغو می‌کند، نه خود جانشین؛ ورودی نادرست تفویض ۴۲۲ و تفویض ناموجود ۴۰۴ است، نه ۵۰۰.
 */
export async function checkDelegationRevokedByDelegatorOnly(): Promise<string[]> {
  const problems: string[] = [];
  const [owner, deputy, admin] = [await wfUser('wfg_owner'), await wfUser('wfg_deputy'), await wfUser('admin', [])];
  const id = await delegate(owner, deputy);
  const byDeputy = await refusalStatus(() => WorkflowDelegationService.revokeDelegation({ id, userId: deputy.id, userRole: deputy.role }));
  if (byDeputy !== 403) problems.push(`لغو تفویض توسط خود جانشین ${byDeputy === null ? 'پذیرفته شد' : `با کد ${byDeputy} رد شد`}، نه ۴۰۳`);
  const active = await pool.query<{ is_active: number }>('SELECT is_active FROM workflow_delegations WHERE id = $1', [id]);
  if (active.rows[0]?.is_active !== 1) problems.push('تفویض پس از تلاش جانشین برای لغو فعال نماند');
  if (await refusal(() => WorkflowDelegationService.revokeDelegation({ id, userId: owner.id, userRole: owner.role }))) problems.push('تفویض‌کننده تفویض خود را لغو نکرد');
  const second = await delegate(owner, deputy);
  if (await refusal(() => WorkflowDelegationService.revokeDelegation({ id: second, userId: admin.id, userRole: 'admin' }))) problems.push('ادمین تفویض را لغو نکرد');

  const self = await refusalStatus(() => WorkflowDelegationService.createDelegation({
    fromUserId: owner.id, toUserId: owner.id, startDate: hourIso(0), endDate: hourIso(1),
  }));
  if (self !== 422) problems.push(`تفویض به خود با کد ${self ?? 'پذیرش'} برگشت، نه ۴۲۲`);
  const reversed = await refusalStatus(() => WorkflowDelegationService.createDelegation({
    fromUserId: owner.id, toUserId: deputy.id, startDate: hourIso(2), endDate: hourIso(1),
  }));
  if (reversed !== 422) problems.push(`تفویض با شروع پس از پایان با کد ${reversed ?? 'پذیرش'} برگشت، نه ۴۲۲`);
  const missing = await refusalStatus(() => WorkflowDelegationService.revokeDelegation({ id: 2147483000, userId: admin.id, userRole: 'admin' }));
  if (missing !== 404) problems.push(`لغو تفویض ناموجود با کد ${missing ?? 'پذیرش'} برگشت، نه ۴۰۴`);
  return problems;
}
