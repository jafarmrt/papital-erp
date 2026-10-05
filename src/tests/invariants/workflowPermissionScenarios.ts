import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { createTestRole } from '../fixtures/factories.js';
import { defineWorkflow, instanceRow, refusalStatus, startWf, tasksOf, transit, runTask, uniqueTag, wfUser } from './workflowScenarioHelpers.js';

/**
 * v8.0.91 — مجوز لازم انتقال گردش‌کار (حوزه G). هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

/**
 * TD-391 (تصمیم مالک محصول «بررسی شود»): انتقالی که «مجوز لازم» دارد فقط برای دارنده آن مجوز (از نقشش یا مجوزهای خودش)
 * و ادمین است؛ پیش‌تر ستون ذخیره می‌شد ولی هیچ‌جا سنجیده نمی‌شد.
 */
export async function checkTransitionRequiredPermission(): Promise<string[]> {
  const problems: string[] = [];
  const permission = `wfg.approve_${uniqueTag()}`;
  const allowedRole = `wfg_perm_${uniqueTag()}`;
  await createTestRole({ code: allowedRole, name: allowedRole, permissions: [permission] });
  const without = await wfUser(`wfg_noperm_${uniqueTag()}`, []);
  const withRole = await wfUser(allowedRole, []);
  const withOwn = await wfUser(`wfg_ownperm_${uniqueTag()}`, [permission]);
  const admin = await wfUser('admin', []);
  const wf = await defineWorkflow({
    states: [{ key: 'draft', type: 'initial' }, { key: 'done', type: 'terminal' }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', permission }],
  });

  const blocked = await startWf(wf);
  const status = await refusalStatus(() => transit(blocked, wf.transitionId.approve, without));
  if (status !== 403) problems.push(`کاربر بی مجوز «${permission}» انتقال را ${status === null ? 'اجرا کرد' : `با کد ${status} رد شد`}، نه ۴۰۳`);
  const [task] = await tasksOf(blocked);
  if (task && (await refusalStatus(() => runTask(task.id, without))) === null) problems.push('کاربر بی مجوز کار کارتابل را اجرا کرد');
  if ((await instanceRow(blocked)).status !== 'IN_PROGRESS') problems.push('فرایند با اقدام کاربر بی مجوز پیش رفت');
  const offered = await WorkflowTransitionExecutor.getAvailableTransitions(blocked, wf.stateId.draft, without.role, without.id, undefined, undefined, undefined, []);
  if (offered.some(t => t.id === wf.transitionId.approve)) problems.push('انتقال نیازمند مجوز به کاربر بی مجوز پیشنهاد شد');
  const check = await WorkflowTransitionExecutor.checkCanTransition({ instanceId: blocked, transitionId: wf.transitionId.approve, userRole: without.role, userPermissions: [] });
  if (check.allowed) problems.push('بررسی امکان انتقال برای کاربر بی مجوز «مجاز» برگرداند');

  for (const [label, user] of [['نقش دارای مجوز', withRole], ['مجوز خود کاربر', withOwn], ['ادمین', admin]] as const) {
    const instanceId = await startWf(wf);
    const offeredTo = await WorkflowTransitionExecutor.getAvailableTransitions(instanceId, wf.stateId.draft, user.role, user.id, undefined, undefined, undefined, user.permissions);
    if (!offeredTo.some(t => t.id === wf.transitionId.approve)) problems.push(`انتقال به ${label} پیشنهاد نشد`);
    const refused = await refusalStatus(() => transit(instanceId, wf.transitionId.approve, user));
    if (refused !== null) problems.push(`${label} انتقال را اجرا نکرد (کد ${refused})`);
    else if ((await instanceRow(instanceId)).status !== 'COMPLETED') problems.push(`فرایند با اقدام ${label} تمام نشد`);
  }
  return problems;
}
