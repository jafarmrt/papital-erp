import { pool } from '../../db/drizzle.js';
import { WorkflowDelegationService } from '../../services/workflow/workflowDelegationService.js';
import { WorkflowTaskService } from '../../services/workflow/workflowTaskService.js';
import { WorkflowSlaReminderService } from '../../services/workflow/workflowSlaReminderService.js';
import {
  defineWorkflow, instanceRow, refusal, refusalStatus, runTask, startWf, tasksOf, transit, uniqueTag, wfUser, type WfUser,
} from './workflowScenarioHelpers.js';

/**
 * v8.0.96 به بعد — سناریوهای امضای «اتفاق آرا» و تفویض اختیار گردش‌کار (حوزه G).
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
  if (two.status !== 'IN_PROGRESS') problems.push(`the "unanimous" step of a three-member role passed with two signatures (${two.status})`);
  const required = two.progress[String(wf.transitionId.approve)]?.requiredCount;
  if (required !== 3) problems.push(`required signatures of the "unanimous" step of a three-member role (plus one deleted user) are ${required}, not 3`);
  const third = await refusal(() => transit(instanceId, wf.transitionId.approve, members[2]));
  if (third || (await instanceRow(instanceId)).status !== 'COMPLETED') problems.push(`the "unanimous" step did not pass with the signatures of all three members (${third ?? 'in progress'})`);

  const soloRole = `wfg_solo_${uniqueTag()}`;
  const solo = await wfUser(soloRole);
  const soloWf = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', role: soloRole, rule: 'AND_ALL', k: 1 }],
  });
  const soloInstance = await startWf(soloWf);
  await transit(soloInstance, soloWf.transitionId.approve, solo);
  if ((await instanceRow(soloInstance)).status !== 'COMPLETED') problems.push('The "unanimous" step of a one-member role did not pass with the signature of its only member');

  const open = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', rule: 'AND_ALL', k: 2 }],
  });
  const openInstance = await startWf(open);
  await transit(openInstance, open.transitionId.approve, members[0]);
  if ((await instanceRow(openInstance)).status !== 'IN_PROGRESS') problems.push('The roleless "unanimous" step with K=2 passed with one signature');
  await transit(openInstance, open.transitionId.approve, members[1]);
  if ((await instanceRow(openInstance)).status !== 'COMPLETED') problems.push('The roleless "unanimous" step with K=2 did not pass with two signatures');
  return problems;
}

export async function delegate(from: WfUser, to: WfUser, scope = 'ALL'): Promise<number> {
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

  const inbox = await WorkflowTaskService.getMyTasks({ userId: deputy.id, userRole: deputy.role, userPermissions: deputy.permissions });
  const seen = inbox.data.find(t => t.id === task.id);
  if (!seen) problems.push('A task of the delegator role was not visible in the deputy inbox');
  else if (seen.delegationInfo?.delegatedFromUserId !== owner.id) problems.push('The deputy inbox did not show whose delegation the task comes from');
  const stats = await WorkflowTaskService.getTaskStats({ userId: deputy.id, userRole: deputy.role, userPermissions: deputy.permissions });
  if (stats.pendingCount < 1) problems.push('The deputy task count did not count the delegated task');

  const error = await refusal(() => runTask(task.id, deputy));
  if (error) return [...problems, `جانشین کار نقش تفویض‌کننده را انجام نداد: ${error}`];
  const signatures = (await instanceRow(instanceId)).progress[String(wf.transitionId.approve)]?.signatures ?? [];
  if (signatures.length !== 1 || signatures[0].userId !== owner.id || signatures[0].signedBy !== deputy.id) {
    problems.push(`the deputy signature was not recorded in the name of the delegator (${JSON.stringify(signatures)})`);
  }
  const ownerAgain = await transit(instanceId, wf.transitionId.approve, owner) as { alreadySigned?: boolean };
  if (!ownerAgain.alreadySigned) problems.push('The delegator was counted as a second signature after their deputy signed');
  const deputyAgain = await runTask(task.id, deputy) as { alreadySigned?: boolean };
  if (!deputyAgain.alreadySigned) problems.push('The deputy was counted as signing twice');
  if ((await instanceRow(instanceId)).status !== 'IN_PROGRESS') problems.push('The quorum of 2 was met by one person (and their deputy)');
  await runTask(task.id, colleague);
  if ((await instanceRow(instanceId)).status !== 'COMPLETED') problems.push('The second colleague signature did not complete the quorum');

  // تفویض حوزه دیگر یا لغوشده اجازه نمی‌دهد
  const other = await wfUser(`wfg_deputy_${uniqueTag()}`);
  // TD-467: حوزه باید کد گردش کار تعریف‌شده باشد؛ گردش کار دیگری برای همین ساخته می‌شود
  const otherWf = await defineWorkflow({ states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }], transitions: [{ from: 'draft', to: 'done', action: 'approve' }] });
  await delegate(owner, other, otherWf.code);
  const revokedDeputy = await wfUser(`wfg_deputy_${uniqueTag()}`);
  const revokedId = await delegate(owner, revokedDeputy);
  await WorkflowDelegationService.revokeDelegation({ id: revokedId, userId: owner.id, userRole: owner.role });
  const second = await startWf(wf);
  const [secondTask] = await tasksOf(second);
  if (!(await refusal(() => runTask(secondTask.id, other)))) problems.push('A delegation scoped to another workflow allowed running the task');
  if (!(await refusal(() => runTask(secondTask.id, revokedDeputy)))) problems.push('A revoked delegation allowed running the task');

  // یادآوری مهلت به جانشین فعال نقش هم می‌رسد
  await pool.query(`UPDATE workflow_tasks SET due_at = $2 WHERE id = $1`, [secondTask.id, hourIso(-1)]);
  await WorkflowSlaReminderService.sendDueReminders();
  const notified = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM notifications WHERE user_id = ANY($1::int[]) AND title = 'مهلت کار تاییدی گذشت'`, [[deputy.id, other.id, revokedDeputy.id]]);
  const ids = notified.rows.map(r => r.user_id);
  if (!ids.includes(deputy.id)) problems.push('The deadline reminder did not reach the active deputy of the role');
  if (ids.includes(other.id) || ids.includes(revokedDeputy.id)) problems.push('The deadline reminder reached a deputy of another scope or a revoked deputy');
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
  if (byDeputy !== 403) problems.push(`revoking a delegation by the deputy itself ${byDeputy === null ? 'was accepted' : `was refused with code ${byDeputy}`}, not 403`);
  const active = await pool.query<{ is_active: number }>('SELECT is_active FROM workflow_delegations WHERE id = $1', [id]);
  if (active.rows[0]?.is_active !== 1) problems.push('The delegation did not stay active after the deputy tried to revoke it');
  if (await refusal(() => WorkflowDelegationService.revokeDelegation({ id, userId: owner.id, userRole: owner.role }))) problems.push('The delegator could not revoke their own delegation');
  const second = await delegate(owner, deputy);
  if (await refusal(() => WorkflowDelegationService.revokeDelegation({ id: second, userId: admin.id, userRole: 'admin' }))) problems.push('The admin could not revoke the delegation');

  const self = await refusalStatus(() => WorkflowDelegationService.createDelegation({
    fromUserId: owner.id, toUserId: owner.id, startDate: hourIso(0), endDate: hourIso(1),
  }));
  if (self !== 422) problems.push(`delegation to oneself came back with ${self ?? 'acceptance'}, not 422`);
  const reversed = await refusalStatus(() => WorkflowDelegationService.createDelegation({
    fromUserId: owner.id, toUserId: deputy.id, startDate: hourIso(2), endDate: hourIso(1),
  }));
  if (reversed !== 422) problems.push(`delegation starting after its end came back with ${reversed ?? 'acceptance'}, not 422`);
  const missing = await refusalStatus(() => WorkflowDelegationService.revokeDelegation({ id: 2147483000, userId: admin.id, userRole: 'admin' }));
  if (missing !== 404) problems.push(`revoking a missing delegation came back with ${missing ?? 'acceptance'}, not 404`);
  return problems;
}
