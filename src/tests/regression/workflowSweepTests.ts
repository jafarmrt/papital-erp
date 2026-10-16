import { and, eq, inArray, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { bankAccounts, outboxEvents, purchaseRequisitions, workflowHistoryLogs, workflowInstances, workflowTransitions } from '../../db/schema.js';
import { money } from '../../lib/money.js';
import type { DbExecutor } from '../../db/drizzle.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * Closing sweep, workflow engine observations of package 14 (OBS-R2-67, -68, -69, -70, -72, -78): each test is red on
 * v10.1.53. Every case runs in its own isolated schema.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-6)}${++seq}`;

async function adminUser() {
  const { createTestUser } = await import('../fixtures/factories.js');
  return createTestUser({ role: 'admin' });
}

/** A workflow of a record type no domain registers (no domain action, no entity check), with the given steps and actions */
async function sweepWorkflow(entityType: string, states: Array<{ key: string; title: string; type: string }>, transitions: Array<{ fromKey: string; toKey: string; actionKey: string; title: string }>) {
  const { createTestWorkflow } = await import('../fixtures/factories.js');
  return createTestWorkflow({ definition: { entityType, code: tag('WFSWEEP_') }, states, transitions });
}

export async function runWorkflowSweepTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const contextId = 'reg_workflow_entity_context_obs_r2_67';
  if (shouldRun(contextId, 'obs-r2-67', 'workflow', 'context', 'rule')) {
    await runCase(results, contextId, 'closing sweep: the workflow rule context of a bank account and a purchase requisition carries their fields, and a database error reaches the caller (OBS-R2-67)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { getEntityContext } = await import('../../services/workflow/workflowDslParser.js');
      const [bank] = await orm.insert(bankAccounts).values({
        code: tag('BSW'), title: 'sweep bank', type: 'bank', currency: 'IRR', initialBalance: money(5000000), currentBalance: money(5000000),
      }).returning();
      const bankContext = await getEntityContext('bank_account', String(bank.id));
      if (bankContext.amount !== 5000000) problems.push(`bank account amount ${String(bankContext.amount)}, expected 5000000`);
      if (bankContext.currency !== 'IRR') problems.push(`bank account currency ${String(bankContext.currency)}`);
      if (bankContext.code !== bank.code) problems.push(`bank account code ${String(bankContext.code)}`);
      if (bankContext.type !== 'bank') problems.push(`bank account type ${String(bankContext.type)}`);

      const [req] = await orm.insert(purchaseRequisitions).values({
        code: tag('PRSW'), title: 'sweep requisition', totalEstimatedAmount: money(750000),
        items: [{ name: 'a', quantity: 1 }, { name: 'b', quantity: 2 }],
      }).returning();
      const reqContext = await getEntityContext('purchase_requisition', String(req.id));
      if (reqContext.amount !== 750000) problems.push(`requisition amount ${String(reqContext.amount)}, expected 750000`);
      if (reqContext.itemCount !== 2) problems.push(`requisition item count ${String(reqContext.itemCount)}, expected 2`);
      if (reqContext.status !== 'pending') problems.push(`requisition status ${String(reqContext.status)}`);

      const failing = { select: () => { throw new Error('forced context read failure'); } } as unknown as DbExecutor;
      let thrown = '';
      try {
        const context = await getEntityContext('bank_account', String(bank.id), failing);
        problems.push(`a failing read returned a context instead of an error: ${JSON.stringify(context)}`);
      } catch (err) {
        thrown = err instanceof Error ? err.message : String(err);
      }
      if (thrown && !thrown.includes('forced context read failure')) problems.push(`unexpected error: ${thrown}`);

      // the inbox shows a card whose context cannot be read without its context instead of failing the page
      const { inboxEntityFields } = await import('../../services/workflow/workflowInboxRows.js');
      const inboxInstance = {
        id: 0, workflowDefinitionId: 0, definitionVersion: 1, entityType: 'bank_account', entityId: String(bank.id), currentStateId: 0,
        status: 'IN_PROGRESS', startedBy: null, startedByName: '', snapshotDsl: null, createdAt: new Date(), updatedAt: new Date(),
      } as unknown as Parameters<typeof inboxEntityFields>[0];
      try {
        const card = await inboxEntityFields(inboxInstance, async () => { throw new Error('forced context read failure'); });
        if (card.refNumber !== String(bank.id) || card.amount !== 0) problems.push(`inbox card without context ${JSON.stringify({ refNumber: card.refNumber, amount: card.amount })}`);
      } catch (err) {
        problems.push(`one unreadable context failed the inbox card: ${err instanceof Error ? err.message : String(err)}`);
      }
      assertNoProblems(problems);
      return 'bank account and requisition context filled; a read error propagates; the inbox card falls back';
    }));
  }

  const cancelId = 'reg_workflow_canceled_end_event_obs_r2_68';
  if (shouldRun(cancelId, 'obs-r2-68', 'workflow', 'canceled', 'event', 'outbox')) {
    await runCase(results, cancelId, 'closing sweep: a terminal canceled step ends the instance COMPLETED and publishes WorkflowCompleted with outcome canceled, never WorkflowRejected (OBS-R2-68)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
      const user = await adminUser();
      const entityType = tag('wfsweep_cancel_');
      const wf = await sweepWorkflow(entityType,
        [{ key: 'draft', title: 'draft', type: 'initial' }, { key: 'canceled', title: 'canceled', type: 'terminal' }],
        [{ fromKey: 'draft', toKey: 'canceled', actionKey: 'cancel', title: 'cancel' }]);
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: wf.definition.id, entityType, entityId: '1', userId: user.id, userName: user.username });
      await WorkflowTransitionExecutor.executeTransition({
        instanceId: instance.id, transitionId: wf.transitions[0].id, userId: user.id, userName: user.username, userRole: 'admin', userPermissions: ['*'],
      });
      const [after] = await orm.select().from(workflowInstances).where(eq(workflowInstances.id, instance.id));
      if (after?.status !== 'COMPLETED') problems.push(`instance status ${String(after?.status)}, expected COMPLETED`);
      const ends = await orm.select({ eventType: outboxEvents.eventType, payload: outboxEvents.payload }).from(outboxEvents)
        .where(and(eq(outboxEvents.aggregateId, String(instance.id)), inArray(outboxEvents.eventType, ['WorkflowCompleted', 'WorkflowRejected'])));
      if (ends.length !== 1) problems.push(`${ends.length} end events, expected exactly one`);
      if (ends.some(e => e.eventType === 'WorkflowRejected')) problems.push('a canceled end published WorkflowRejected');
      const completed = ends.find(e => e.eventType === 'WorkflowCompleted');
      if (!completed) problems.push('no WorkflowCompleted for a canceled end');
      else if ((completed.payload as Record<string, unknown>)?.outcome !== 'canceled') problems.push(`WorkflowCompleted outcome ${String((completed.payload as Record<string, unknown>)?.outcome)}, expected canceled`);
      const [moved] = await orm.select({ payload: outboxEvents.payload }).from(outboxEvents)
        .where(and(eq(outboxEvents.aggregateId, String(1)), eq(outboxEvents.eventType, 'WorkflowTransitioned'), sql`${outboxEvents.payload} ->> 'instanceId' = ${String(instance.id)}`));
      const movedPayload = (moved?.payload ?? {}) as Record<string, unknown>;
      if (movedPayload.isRejected === true || movedPayload.isCompleted !== true) problems.push(`WorkflowTransitioned flags isCompleted=${String(movedPayload.isCompleted)} isRejected=${String(movedPayload.isRejected)}`);
      assertNoProblems(problems);
      return 'COMPLETED with WorkflowCompleted (outcome canceled)';
    }));
  }

  const orderId = 'reg_workflow_history_order_obs_r2_69';
  if (shouldRun(orderId, 'obs-r2-69', 'workflow', 'history', 'order')) {
    await runCase(results, orderId, 'closing sweep: workflow history rows with the same created_at come back in id order (OBS-R2-69)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { createTestWorkflowInstance } = await import('../fixtures/factories.js');
      const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
      const entityType = tag('wfsweep_order_');
      const wf = await sweepWorkflow(entityType,
        [{ key: 'draft', title: 'draft', type: 'initial' }, { key: 'approved', title: 'approved', type: 'terminal' }],
        [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve', title: 'approve' }]);
      const instance = await createTestWorkflowInstance(wf.definition.id, wf.states.draft.id, entityType, '7');
      const at = '2026-01-01 10:00:00';
      // three ids from the sequence, written newest first: the physical order of the rows is the reverse of their ids
      const reserved = (await orm.execute(sql`SELECT nextval(pg_get_serial_sequence('workflow_history_logs', 'id'))::int AS id FROM generate_series(1, 3)`)).rows
        .map(r => Number((r as { id: number }).id)).sort((a, b) => a - b);
      for (const id of [...reserved].reverse()) {
        await orm.insert(workflowHistoryLogs).values({ id, instanceId: instance.id, toStateId: wf.states.draft.id, actionKey: `row_${id}`, actionTitle: 'row', createdAt: at });
      }
      const inserted = reserved.map(id => ({ id }));
      const expected = inserted.map(r => r.id).join(',');
      const check = (label: string, rows: Array<{ id: number }> | undefined) => {
        const got = (rows ?? []).map(r => r.id).join(',');
        if (got !== expected) problems.push(`${label} order ${got}, expected ${expected}`);
      };
      check('getWorkflowHistory', await WorkflowTransitionExecutor.getWorkflowHistory(instance.id));
      check('getInstanceById', (await WorkflowTransitionExecutor.getInstanceById(instance.id))?.history);
      check('getInstanceByEntity', (await WorkflowTransitionExecutor.getInstanceByEntity(entityType, '7', undefined, 'admin'))?.history);
      assertNoProblems(problems);
      return 'history ordered by created_at, then id';
    }));
  }

  const inboxId = 'reg_workflow_inbox_limit_obs_r2_70';
  if (shouldRun(inboxId, 'obs-r2-70', 'workflow', 'inbox', 'limit')) {
    await runCase(results, inboxId, 'closing sweep: the inbox page holds at most 100 rows; a larger limit is 400 on the route and capped in the service (OBS-R2-70)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const admin = await sandboxAdminClient();
      const big = await admin.get('/api/workflow/tasks/my-tasks?status=pending&limit=1000');
      if (big.status !== 400) problems.push(`limit=1000 answered ${big.status}, expected 400`);
      const ok = await admin.get('/api/workflow/tasks/my-tasks?status=pending&limit=100');
      if (ok.status !== 200) problems.push(`limit=100 answered ${ok.status}`);
      const { WorkflowTaskService } = await import('../../services/workflow/workflowTaskService.js');
      const user = await adminUser();
      const page = await WorkflowTaskService.getMyTasks({ userId: user.id, userRole: 'admin', limit: 5000 });
      if (!(Number(page.limit) <= 100)) problems.push(`service page limit ${String(page.limit)}, expected at most 100`);
      assertNoProblems(problems);
      return 'route 400 above 100; service capped';
    }));
  }

  const slaId = 'reg_workflow_sla_from_step_entry_obs_r2_72';
  if (shouldRun(slaId, 'obs-r2-72', 'workflow', 'sla', 'signature')) {
    await runCase(results, slaId, 'closing sweep: a partial signature does not restart the SLA count of the step; hours in the step run from its entry (OBS-R2-72)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
      const { WorkflowSlaEvaluator } = await import('../../services/workflow/workflowSlaEvaluator.js');
      const user = await adminUser();
      const entityType = tag('wfsweep_sla_');
      const wf = await sweepWorkflow(entityType,
        [{ key: 'draft', title: 'draft', type: 'initial' }, { key: 'approved', title: 'approved', type: 'terminal' }],
        [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve', title: 'approve' }]);
      await orm.update(workflowTransitions).set({ approvalRuleType: 'K_OF_N', kValue: 2 }).where(eq(workflowTransitions.id, wf.transitions[0].id));
      const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: wf.definition.id, entityType, entityId: '1', userId: user.id, userName: user.username });
      // the step was entered 48 hours ago (SLA 24 hours)
      await orm.execute(sql`UPDATE workflow_instances SET created_at = now() - interval '48 hours', updated_at = now() - interval '48 hours' WHERE id = ${instance.id}`);
      await orm.execute(sql`UPDATE workflow_history_logs SET created_at = now() - interval '48 hours' WHERE instance_id = ${instance.id}`);
      const signed = await WorkflowTransitionExecutor.executeTransition({
        instanceId: instance.id, transitionId: wf.transitions[0].id, userId: user.id, userName: user.username, userRole: 'admin', userPermissions: ['*'],
      });
      if ('toState' in signed) problems.push('the first of two signatures advanced the step');
      const analytics = await WorkflowSlaEvaluator.getSlaAnalytics();
      const overdue = analytics.overdueInstances.find(i => i.instanceId === instance.id);
      if (!overdue) problems.push('an instance 48 hours in a 24-hour step is not overdue after a partial signature');
      else if (overdue.hoursInState < 47) problems.push(`hours in step ${overdue.hoursInState}, expected about 48`);
      assertNoProblems(problems);
      return `overdue ${overdue?.hoursInState ?? '?'} hours`;
    }));
  }

  const healthId = 'reg_workflow_unguarded_instance_health_obs_r2_78';
  if (shouldRun(healthId, 'obs-r2-78', 'workflow', 'health', 'snapshot', 'td444')) {
    await runCase(results, healthId, 'closing sweep: the health check lists running document workflow instances whose snapshot holds an approval action with neither role nor permission, and rewrites none (OBS-R2-78)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { createTestWorkflow } = await import('../fixtures/factories.js');
      const { FinancialHealthService } = await import('../../services/accounting/financialHealth.service.js');
      const wf = await createTestWorkflow({ definition: { entityType: 'document', code: tag('WFSWEEP_DOC_') } });
      const snapshotOf = (permission: string) => ({
        code: wf.definition.code,
        states: [
          { id: 990001, stateKey: 'draft', title: 'draft', stateType: 'initial' },
          { id: 990002, stateKey: 'approved', title: 'approved', stateType: 'terminal' },
        ],
        transitions: [{ id: 990003, fromStateId: 990001, toStateId: 990002, actionKey: 'approve', title: 'legacy approve', requiredRole: '', requiredPermission: permission }],
      });
      const insertInstance = async (entityId: string, permission: string, status = 'IN_PROGRESS') => {
        const [row] = await orm.insert(workflowInstances).values({
          workflowDefinitionId: wf.definition.id, definitionVersion: 1, entityType: 'document', entityId, currentStateId: 990001,
          status, snapshotDsl: snapshotOf(permission), version: 1,
        }).returning();
        return row;
      };
      const roleless = await insertInstance(tag('9'), '');
      const guarded = await insertInstance(tag('8'), 'accounting.vouchers');
      const finished = await insertInstance(tag('7'), '', 'COMPLETED');
      const rejected = await insertInstance(tag('6'), '', 'REJECTED');
      const report = await FinancialHealthService.runHealthCheck();
      const test = (report.tests ?? []).find((t: { id: string }) => t.id === 'workflow_unguarded_document_instance');
      if (!test) problems.push('no workflow_unguarded_document_instance health check');
      const listed = new Set(((test?.items ?? []) as Array<{ id: number }>).map(i => Number(i.id)));
      if (!listed.has(roleless.id)) problems.push('the running instance with a roleless approval is not listed');
      if (listed.has(guarded.id)) problems.push('an instance whose approval has a permission is listed');
      if (listed.has(finished.id)) problems.push('a finished instance is listed');
      if (!listed.has(rejected.id)) problems.push('a rejected instance (still open through its reopen action) with a roleless approval is not listed');
      const [after] = await orm.select({ snapshot: workflowInstances.snapshotDsl }).from(workflowInstances).where(eq(workflowInstances.id, roleless.id));
      const kept = ((after?.snapshot ?? {}) as { transitions?: Array<{ requiredRole?: string; requiredPermission?: string }> }).transitions?.[0];
      if (kept?.requiredRole !== '' || kept?.requiredPermission !== '') problems.push('the health check rewrote the instance snapshot');
      assertNoProblems(problems);
      return `listed ${listed.size} instance(s)`;
    }));
  }

  return results;
}
