import { TestCaseResult } from '../types.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * Package 14 (workflow), PR د: the approval inbox rows as the browser needs them, through the real Express routes.
 * Test names and failure messages are English (terminal output).
 */

const inboxCode = (h: Harness, label: string): string => `WF14D_${label}_${h.tag}_${Math.floor(Math.random() * 1e6)}`;

async function dropDefinition(h: Harness, code: string): Promise<void> {
  const ids = (await h.q(`SELECT id FROM workflow_definitions WHERE code = $1`, [code])).map(r => Number(r.id));
  if (ids.length === 0) return;
  await h.q(`DELETE FROM workflow_instances WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_definition_versions WHERE definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_transitions WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_states WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_definitions WHERE id = ANY($1::int[])`, [ids]);
}

/** A workflow whose first step has one approve action and two reject actions, started by the admin. */
async function startTwoRejectWorkflow(h: Harness, code: string): Promise<{ instanceId: number; rejectIds: number[] }> {
  const entityType = `wf14d_${h.tag}`;
  const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
    code, title: 'دو اقدام رد', entityType,
    states: [
      { stateKey: 'review', title: 'بررسی کارشناس', stateType: 'initial' },
      { stateKey: 'done', title: 'تأیید شده', stateType: 'terminal' },
      { stateKey: 'rejected', title: 'رد شده', stateType: 'terminal' },
    ],
    transitions: [
      { fromStateKey: 'review', toStateKey: 'done', actionKey: 'approve', title: 'تأیید' },
      { fromStateKey: 'review', toStateKey: 'rejected', actionKey: 'reject_back', title: 'رد و بازگشت' },
      { fromStateKey: 'review', toStateKey: 'rejected', actionKey: 'reject_final', title: 'رد نهایی' },
    ],
  });
  const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
  const [admin] = await h.q(`SELECT id, full_name FROM users WHERE username = 'pen_admin' AND is_deleted = 0`);
  const inst = await WorkflowTransitionExecutor.startInstance({
    workflowDefinitionId: Number(saved?.definition.id), entityType, entityId: '1', userId: Number(admin?.id), userName: String(admin?.full_name),
  });
  const rejects = await h.q(`SELECT id FROM workflow_transitions WHERE workflow_definition_id = $1 AND action_key LIKE 'reject%' ORDER BY id`, [saved?.definition.id]);
  return { instanceId: inst.id, rejectIds: rejects.map(r => Number(r.id)) };
}

async function inboxRowOf(h: Harness, instanceId: number): Promise<Row | undefined> {
  const res = await h.get('/api/workflow/tasks/my-tasks?status=pending&limit=1000');
  return (Array.isArray(res.body?.data) ? (res.body.data as Row[]) : []).find(r => Number(r.instanceId) === instanceId);
}

export async function runWorkflowInboxTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_inbox_reject_choice_td_463', 'security', 'td463', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_inbox_reject_choice_td_463',
      name: 'Inbox rows list the reject actions of the current step, and the chosen one rejects a step with several (TD-463)',
      details: 'a step with two reject actions: the row carries both; reject without a choice is 422 WF_TASK_REJECT_AMBIGUOUS; reject with the chosen transitionId is 200 and the history records that action',
    }, async (h, wrong) => {
      const code = inboxCode(h, 'REJECT');
      try {
        const { instanceId, rejectIds } = await startTwoRejectWorkflow(h, code);
        const row = await inboxRowOf(h, instanceId);
        if (!row) {
          wrong.push('the admin inbox has no row for the new instance');
          return;
        }
        const offered = (Array.isArray(row.rejectTransitions) ? (row.rejectTransitions as Row[]) : []).map(r => Number(r.id)).sort((a, b) => a - b);
        if (JSON.stringify(offered) !== JSON.stringify(rejectIds)) wrong.push(`inbox row reject actions are ${JSON.stringify(row.rejectTransitions)}, expected ids ${JSON.stringify(rejectIds)}`);

        const ambiguous = await h.post(`/api/workflow/tasks/${row.id}/execute`, { action: 'reject', comment: 'no choice' });
        if (ambiguous.status !== 422 || !JSON.stringify(ambiguous.body).includes('WF_TASK_REJECT_AMBIGUOUS')) {
          wrong.push(`reject without a choice returned ${ambiguous.status} ${JSON.stringify(ambiguous.body).slice(0, 160)}`);
        }
        const chosen = rejectIds[1];
        const ok = await h.post(`/api/workflow/tasks/${row.id}/execute`, { action: 'reject', comment: 'final', transitionId: chosen });
        if (ok.status !== 200) wrong.push(`reject with transitionId returned ${ok.status} ${JSON.stringify(ok.body).slice(0, 160)}`);
        const [log] = await h.q(`SELECT transition_id FROM workflow_history_logs WHERE instance_id = $1 AND transition_id IS NOT NULL ORDER BY id DESC LIMIT 1`, [instanceId]);
        if (Number(log?.transition_id) !== chosen) wrong.push(`history records transition ${String(log?.transition_id)}, not the chosen ${chosen}`);
      } finally {
        await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_inbox_card_fields_td_465', 'security', 'td465', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_inbox_card_fields_td_465',
      name: 'Inbox rows carry the current step title from the instance snapshot and the name of who started the instance (TD-465)',
      details: 'the row of a new instance has currentStepTitle = its first step and instance.startedByName = the starter; the step title comes from the snapshot, so a later design rename does not change it',
    }, async (h, wrong) => {
      const code = inboxCode(h, 'CARD');
      try {
        const { instanceId } = await startTwoRejectWorkflow(h, code);
        const [admin] = await h.q(`SELECT full_name FROM users WHERE username = 'pen_admin' AND is_deleted = 0`);
        await h.q(`UPDATE workflow_states SET title = 'renamed after start' WHERE workflow_definition_id IN (SELECT id FROM workflow_definitions WHERE code = $1)`, [code]);
        const row = await inboxRowOf(h, instanceId);
        if (!row) {
          wrong.push('the admin inbox has no row for the new instance');
          return;
        }
        if (row.currentStepTitle !== 'بررسی کارشناس') wrong.push(`currentStepTitle is ${JSON.stringify(row.currentStepTitle)}, not the snapshot step title`);
        const startedByName = (row.instance as Row | undefined)?.startedByName;
        if (!startedByName || startedByName !== admin?.full_name) wrong.push(`instance.startedByName is ${JSON.stringify(startedByName)}, not ${JSON.stringify(admin?.full_name)}`);
        if (typeof row.amount !== 'number') wrong.push(`amount is ${typeof row.amount}, not a number`);
      } finally {
        await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_delegation_scope_td_467', 'security', 'td467', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_delegation_scope_td_467',
      name: 'A delegation scope is ALL or the code of a defined workflow; any other scope is refused with 422 (TD-467)',
      details: 'scopes invoice, transfer and project (offered by the old form, matching no workflow) get 422 and are not stored; ALL and an existing workflow code (any case) are stored',
    }, async (h, wrong) => {
      const deputy = await h.sessionWith(['workflow.view', 'workflow.approve']);
      const start = new Date(Date.now() - 3600_000).toISOString();
      const end = new Date(Date.now() + 86_400_000).toISOString();
      const create = (scope: string) => h.post('/api/workflow/delegations', { toUserId: deputy.userId, scope, startDate: start, endDate: end, reason: `td467 ${scope}` });
      try {
        for (const scope of ['invoice', 'transfer', 'project', 'NO_SUCH_WORKFLOW']) {
          const res = await create(scope);
          if (res.status !== 422) wrong.push(`scope ${scope} returned ${res.status}, not 422`);
        }
        const stored = await h.q(`SELECT scope FROM workflow_delegations WHERE to_user_id = $1 ORDER BY id`, [deputy.userId]);
        if (stored.length > 0) wrong.push(`refused scopes were stored: ${stored.map(r => String(r.scope)).join(', ')}`);
        for (const scope of ['ALL', 'DOC_APPROVAL_WORKFLOW', 'doc_approval_workflow']) {
          const res = await create(scope);
          if (res.status !== 200) wrong.push(`scope ${scope} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`);
        }
      } finally {
        await h.q(`DELETE FROM workflow_delegations WHERE to_user_id = $1`, [deputy.userId]);
      }
    });
  }

  return results;
}
