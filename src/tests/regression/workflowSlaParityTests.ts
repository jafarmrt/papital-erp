import { asc, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowHistoryLogs, workflowInstances, workflowStates } from '../../db/schema.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/**
 * 10.2 package 11 (OBS-R2-71, TD-1323): the SLA report is computed in PostgreSQL instead of loading every instance, snapshot
 * and history row. This case keeps the earlier in-memory loop as a reference and requires the same numbers on a workflow
 * whose instances finished, run late, run on time, carry partial signatures and keep an older snapshot of their steps.
 */

let seq = 0;
const tag = (prefix: string) => `${prefix}${Date.now().toString().slice(-6)}${++seq}`;

type StateRow = typeof workflowStates.$inferSelect;
type HistoryRow = typeof workflowHistoryLogs.$inferSelect;

/** The report as v10.2.9 computed it: every row in memory (kept only to compare with) */
async function referenceSlaAnalytics() {
  const { createStateResolver, currentStepEnteredAt, isStepEntry } = await import('../../services/workflow/workflowSlaEvaluator.js');
  const allInstances = await orm.select().from(workflowInstances);
  const activeInstances = allInstances.filter(i => i.status === 'IN_PROGRESS');
  const instanceById = new Map(allInstances.map(i => [i.id, i]));
  const states: StateRow[] = await orm.select().from(workflowStates);
  const resolve = createStateResolver(states);
  const historyLogs = await orm.select().from(workflowHistoryLogs).orderBy(asc(workflowHistoryLogs.createdAt), asc(workflowHistoryLogs.id));
  const logsByInstance: Record<number, HistoryRow[]> = {};
  for (const log of historyLogs) (logsByInstance[log.instanceId] ??= []).push(log);
  const now = Date.now();
  const stats: Record<number, { activeCount: number; overdueCount: number; transitions: number; hours: number; slaHours: number; title: string }> = {};
  const row = (id: number, title: string, slaHours: number) => (stats[id] ??= { activeCount: 0, overdueCount: 0, transitions: 0, hours: 0, slaHours, title });
  for (const s of states) row(s.id, s.title, s.slaHours || 24);
  let violations = 0;
  let checked = 0;
  const overdue: Array<{ instanceId: number; hoursInState: number; slaHours: number; stateTitle: string }> = [];
  for (const inst of activeInstances) {
    const state = resolve(inst.workflowDefinitionId, inst.snapshotDsl, inst.currentStateId);
    const slaHours = state?.slaHours ?? 24;
    const enteredAt = currentStepEnteredAt(inst, logsByInstance[inst.id] ?? []);
    const hoursInState = Math.round(((now - new Date(enteredAt || '').getTime()) / 3600000) * 10) / 10;
    const isOverdue = hoursInState > slaHours;
    if (state) {
      row(state.rowId, state.title, state.slaHours).activeCount++;
      if (isOverdue) stats[state.rowId].overdueCount++;
    }
    if (isOverdue) {
      violations++;
      overdue.push({ instanceId: inst.id, hoursInState, slaHours, stateTitle: state?.title || 'نامشخص' });
    }
  }
  for (const instId in logsByInstance) {
    const logs = logsByInstance[instId].filter(isStepEntry);
    const inst = instanceById.get(Number(instId));
    for (let i = 0; i < logs.length - 1; i++) {
      const state = inst ? resolve(inst.workflowDefinitionId, inst.snapshotDsl, logs[i].toStateId) : undefined;
      if (!state) continue;
      const hours = (new Date(logs[i + 1].createdAt || '').getTime() - new Date(logs[i].createdAt || '').getTime()) / 3600000;
      const st = row(state.rowId, state.title, state.slaHours);
      st.transitions++;
      st.hours += hours;
      checked++;
      if (hours > state.slaHours) violations++;
    }
  }
  return {
    total: allInstances.length,
    active: activeInstances.length,
    completed: allInstances.filter(i => i.status === 'COMPLETED').length,
    compliance: checked > 0 ? Math.max(0, Math.round(((checked - violations) / checked) * 100)) : 100,
    overdue,
    stats,
  };
}

export async function runWorkflowSlaParityTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const id = 'reg_workflow_sla_in_sql_td_1323';
  if (shouldRun(id, 'td_1323', 'obs_r2_71', 'workflow', 'sla')) {
    await runCase(results, id, 'OBS-R2-71: the SLA report is computed in SQL and gives the numbers of the earlier in-memory loop: counts, overdue instances, per-step transitions, averages, bottlenecks and compliance (TD-1323)', async () => inFiscalSandbox(async () => {
      const problems: string[] = [];
      const { createTestWorkflow, createTestUser } = await import('../fixtures/factories.js');
      const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
      const { WorkflowSlaEvaluator } = await import('../../services/workflow/workflowSlaEvaluator.js');
      const user = await createTestUser({ role: 'admin' });
      const entityType = tag('wfsla_');
      const wf = await createTestWorkflow({
        definition: { entityType, code: tag('WFSLA_') },
        states: [{ key: 'draft', title: 'draft', type: 'initial' }, { key: 'review', title: 'review', type: 'normal' }, { key: 'approved', title: 'approved', type: 'terminal' }],
        transitions: [{ fromKey: 'draft', toKey: 'review', actionKey: 'submit', title: 'submit' }, { fromKey: 'review', toKey: 'approved', actionKey: 'approve', title: 'approve' }],
      });
      const submit = wf.transitions.find((t: { actionKey: string }) => t.actionKey === 'submit');
      const approve = wf.transitions.find((t: { actionKey: string }) => t.actionKey === 'approve');
      await orm.update(workflowStates).set({ slaHours: 10 }).where(eq(workflowStates.id, wf.states.draft.id));
      await orm.update(workflowStates).set({ slaHours: 5 }).where(eq(workflowStates.id, wf.states.review.id));

      const run = async (entityId: string, steps: Array<{ id: number }>, hoursAgo: number[]) => {
        const instance = await WorkflowTransitionExecutor.startInstance({ workflowDefinitionId: wf.definition.id, entityType, entityId, userId: user.id, userName: user.username });
        for (const step of steps) {
          await WorkflowTransitionExecutor.executeTransition({ instanceId: instance.id, transitionId: step.id, userId: user.id, userName: user.username, userRole: 'admin', userPermissions: ['*'] });
        }
        const rows = await orm.select({ id: workflowHistoryLogs.id }).from(workflowHistoryLogs).where(eq(workflowHistoryLogs.instanceId, instance.id)).orderBy(asc(workflowHistoryLogs.id));
        if (rows.length !== hoursAgo.length) problems.push(`instance ${entityId} has ${rows.length} history rows, the case expects ${hoursAgo.length}`);
        for (const [i, r] of rows.entries()) {
          await orm.execute(sql`UPDATE workflow_history_logs SET created_at = now() - make_interval(secs => ${hoursAgo[i] * 3600}::float8) WHERE id = ${r.id}`);
        }
        await orm.execute(sql`UPDATE workflow_instances SET created_at = now() - make_interval(secs => ${hoursAgo[0] * 3600}::float8) WHERE id = ${instance.id}`);
        return instance.id;
      };
      // finished: draft 12 h (late against 10), review 3 h
      await run('1', [submit!, approve!], [100, 88, 85]);
      // finished: draft 1 h, review 9 h (late against 5), with a partial signature in review that is no step entry
      const second = await run('2', [submit!, approve!], [60, 59, 50]);
      await orm.insert(workflowHistoryLogs).values({ instanceId: second, toStateId: wf.states.review.id, actionKey: 'approve_SIGN', actionTitle: 'sign', createdAt: sql`now() - interval '55 hours'` as unknown as string });
      // running late in review (30 h against 5), and running on time in draft
      const late = await run('3', [submit!], [40.25, 30.25]);
      await run('4', [], [1.25]);
      // the live step gets another deadline: started instances keep their snapshot's
      await orm.update(workflowStates).set({ slaHours: 100 }).where(eq(workflowStates.id, wf.states.review.id));

      const report = await WorkflowSlaEvaluator.getSlaAnalytics();
      const expected = await referenceSlaAnalytics();
      if (report.kpi.totalInstances !== expected.total || report.kpi.activeInstances !== expected.active || report.kpi.completedInstances !== expected.completed) {
        problems.push(`counts ${report.kpi.totalInstances}/${report.kpi.activeInstances}/${report.kpi.completedInstances}, expected ${expected.total}/${expected.active}/${expected.completed}`);
      }
      if (report.kpi.slaComplianceRate !== expected.compliance) problems.push(`compliance ${report.kpi.slaComplianceRate}, expected ${expected.compliance}`);
      const gotOverdue = report.overdueInstances.map(o => o.instanceId).sort((a, b) => a - b).join(',');
      const wantOverdue = expected.overdue.map(o => o.instanceId).sort((a, b) => a - b).join(',');
      if (gotOverdue !== wantOverdue) problems.push(`overdue instances ${gotOverdue}, expected ${wantOverdue}`);
      const lateRow = report.overdueInstances.find(o => o.instanceId === late);
      if (!lateRow || lateRow.slaHours !== 5 || Math.abs(lateRow.hoursInState - 30.3) > 0.11) problems.push(`the late instance shows ${JSON.stringify(lateRow)}, expected about 30.3 h against its snapshot's 5`);
      for (const st of report.stateSlaReport) {
        const want = expected.stats[st.stateId];
        if (!want) { problems.push(`step ${st.stateId} is not in the reference`); continue; }
        const wantAvg = want.transitions > 0 ? Math.round((want.hours / want.transitions) * 10) / 10 : 0;
        if (st.activeCount !== want.activeCount || st.overdueCount !== want.overdueCount || st.totalCompletedTransitions !== want.transitions
          || st.avgDurationHours !== wantAvg || st.slaHours !== want.slaHours || st.stateTitle !== want.title) {
          problems.push(`step ${st.stateTitle}: active ${st.activeCount}, overdue ${st.overdueCount}, transitions ${st.totalCompletedTransitions}, avg ${st.avgDurationHours}, sla ${st.slaHours}; expected ${want.activeCount}, ${want.overdueCount}, ${want.transitions}, ${wantAvg}, ${want.slaHours}`);
        }
      }
      if (Object.keys(expected.stats).length !== report.stateSlaReport.length) problems.push(`${report.stateSlaReport.length} steps, expected ${Object.keys(expected.stats).length}`);
      const review = report.stateSlaReport.find(s => s.stateId === wf.states.review.id);
      if (review?.totalCompletedTransitions !== 2 || review.avgDurationHours !== 6) problems.push(`review counted ${review?.totalCompletedTransitions} transitions averaging ${review?.avgDurationHours} h, expected 2 averaging 6 (the signature is no entry)`);
      assertNoProblems(problems);
      return `compliance ${report.kpi.slaComplianceRate}%, ${report.overdueInstances.length} overdue`;
    }));
  }

  return results;
}
