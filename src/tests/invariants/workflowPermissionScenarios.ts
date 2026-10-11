import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { WorkflowTaskService } from '../../services/workflow/workflowTaskService.js';
import { delegate } from './workflowDelegationScenarios.js';
import { createTestRole } from '../fixtures/factories.js';
import { defineWorkflow, instanceRow, refusalStatus, startWf, tasksOf, transit, runTask, uniqueTag, wfUser } from './workflowScenarioHelpers.js';

/**
 * v8.0.100 — مجوز لازم انتقال گردش‌کار (حوزه G). هر تابع فهرست مشکلات را برمی‌گرداند؛ فهرست خالی یعنی رفتار درست.
 */

/**
 * TD-391 (تصمیم مالک محصول «بررسی شود»): انتقالی که «مجوز لازم» دارد فقط برای دارنده آن مجوز (از نقشش یا مجوزهای خودش)
 * و ادمین است؛ پیش‌تر ستون ذخیره می‌شد ولی هیچ‌جا سنجیده نمی‌شد.
 */
export async function checkTransitionRequiredPermission(): Promise<string[]> {
  const problems: string[] = [];
  // v9.0.128 (TD-542): مجوز لازم کلید فهرست مجوزهاست؛ کلیدی که کاربران آزمون جز از این راه ندارند
  const permission = 'accounting.fiscal_close';
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
  if (status !== 403) problems.push(`a user without the permission "${permission}" ${status === null ? 'ran the transition' : `was refused with code ${status}`}, not 403`);
  const [task] = await tasksOf(blocked);
  if (task && (await refusalStatus(() => runTask(task.id, without))) === null) problems.push('a user without permission ran the inbox task');
  if ((await instanceRow(blocked)).status !== 'IN_PROGRESS') problems.push('the workflow advanced on the action of a user without permission');
  const offered = await WorkflowTransitionExecutor.getAvailableTransitions(blocked, wf.stateId.draft, without.role, without.id, undefined, undefined, undefined, []);
  if (offered.some(t => t.id === wf.transitionId.approve)) problems.push('a transition that needs a permission was offered to a user without it');
  const check = await WorkflowTransitionExecutor.checkCanTransition({ instanceId: blocked, transitionId: wf.transitionId.approve, userRole: without.role, userPermissions: [] });
  if (check.allowed) problems.push('the transition check returned "allowed" for a user without permission');

  for (const [label, user] of [['نقش دارای مجوز', withRole], ['مجوز خود کاربر', withOwn], ['ادمین', admin]] as const) {
    const instanceId = await startWf(wf);
    const offeredTo = await WorkflowTransitionExecutor.getAvailableTransitions(instanceId, wf.stateId.draft, user.role, user.id, undefined, undefined, undefined, user.permissions);
    if (!offeredTo.some(t => t.id === wf.transitionId.approve)) problems.push(`the transition was not offered to ${label}`);
    const refused = await refusalStatus(() => transit(instanceId, wf.transitionId.approve, user));
    if (refused !== null) problems.push(`${label} did not run the transition (code ${refused})`);
    else if ((await instanceRow(instanceId)).status !== 'COMPLETED') problems.push(`the workflow did not finish on the action of ${label}`);
  }
  return problems;
}

/**
 * TD-392 (تصمیم مالک محصول «گزینه در هر گام»): انتقالی که تیک «آغازکننده تأیید نکند» دارد برای آغازکننده فرایند (به نام
 * خودش یا از راه جانشینش) بسته است و در کارتابل و اقدام‌های پیشنهادی او نمی‌آید؛ همکار هم‌نقش و ادمین اجرا می‌کنند و
 * گام بی تیک مثل پیش برای آغازکننده باز است. پیش‌تر طرح راهی برای منع آن نداشت.
 */
export async function checkInitiatorExcludedStep(): Promise<string[]> {
  const problems: string[] = [];
  const role = `wfg_sod_${uniqueTag()}`;
  const [initiator, colleague] = [await wfUser(role), await wfUser(role)];
  const deputy = await wfUser(`wfg_deputy_${uniqueTag()}`);
  const admin = await wfUser('admin', []);
  const spec = (excludeInitiator: boolean) => ({
    states: [{ key: 'draft', type: 'initial' as const }, { key: 'done', type: 'terminal' as const }],
    transitions: [{ from: 'draft', to: 'done', action: 'approve', role, excludeInitiator }],
  });
  const wf = await defineWorkflow(spec(true));
  await delegate(initiator, deputy);

  const instanceId = await startWf(wf, uniqueTag(), initiator);
  const status = await refusalStatus(() => transit(instanceId, wf.transitionId.approve, initiator));
  if (status !== 403) problems.push(`the initiator ${status === null ? 'ran the step' : `was refused with code ${status}`} on an "initiator may not approve" step, not 403`);
  const [task] = await tasksOf(instanceId);
  if (task && (await refusalStatus(() => runTask(task.id, initiator))) === null) problems.push('the initiator ran the step task from the inbox');
  if (task && (await refusalStatus(() => runTask(task.id, deputy))) === null) problems.push('the deputy of the initiator ran the step task in their name');
  const inbox = await WorkflowTaskService.getMyTasks({ userId: initiator.id, userRole: initiator.role, userPermissions: initiator.permissions });
  if (inbox.data.some(t => t.instanceId === instanceId)) problems.push('the step task appeared in the inbox of the initiator');
  const offered = await WorkflowTransitionExecutor.getAvailableTransitions(instanceId, wf.stateId.draft, initiator.role, initiator.id, undefined, undefined, undefined, initiator.permissions);
  if (offered.length > 0) problems.push('the "initiator does not approve" step was offered to the initiator');
  const colleagueInbox = await WorkflowTaskService.getMyTasks({ userId: colleague.id, userRole: colleague.role, userPermissions: colleague.permissions });
  if (!colleagueInbox.data.some(t => t.instanceId === instanceId)) problems.push('the step task did not appear in the inbox of a colleague with the same role');
  if (await refusalStatus(() => transit(instanceId, wf.transitionId.approve, colleague)) !== null) problems.push('a colleague with the same role did not run the step');
  if ((await instanceRow(instanceId)).status !== 'COMPLETED') problems.push('the workflow did not finish with the signature of the colleague');

  const byAdmin = await startWf(wf, uniqueTag(), admin);
  if (await refusalStatus(() => transit(byAdmin, wf.transitionId.approve, admin)) !== null) problems.push('the admin did not run the step of their own workflow');
  const plain = await defineWorkflow(spec(false));
  const plainInstance = await startWf(plain, uniqueTag(), initiator);
  if (await refusalStatus(() => transit(plainInstance, plain.transitionId.approve, initiator)) !== null) problems.push('a step without the option was closed for the initiator');
  return problems;
}
