import { TestCaseResult } from '../types.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * Phase 3, lane L4 (side findings of the role guides): who sees an inbox task, the permission's name in a refusal,
 * and the signer's name. Test names and failure messages are English (terminal output).
 */

const gateCode = (h: Harness, label: string): string => `WFL4_${label}_${h.tag}_${Math.floor(Math.random() * 1e6)}`;

async function dropDefinition(h: Harness, code: string): Promise<void> {
  const ids = (await h.q(`SELECT id FROM workflow_definitions WHERE code = $1`, [code])).map(r => Number(r.id));
  if (ids.length === 0) return;
  await h.q(`DELETE FROM workflow_instances WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_definition_versions WHERE definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_transitions WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_states WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_definitions WHERE id = ANY($1::int[])`, [ids]);
}

/** A one-step workflow whose approve action has no role and the given permission, started by the admin. */
async function startOneStep(h: Harness, code: string, requiredPermission = ''): Promise<{ instanceId: number; approveId: number }> {
  const entityType = `wfl4_${h.tag}`;
  const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
    code, title: 'گام بی نقش', entityType,
    states: [
      { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
      { stateKey: 'done', title: 'تأیید شده', stateType: 'terminal' },
      { stateKey: 'rejected', title: 'رد شده', stateType: 'terminal' },
    ],
    transitions: [
      { fromStateKey: 'draft', toStateKey: 'done', actionKey: 'send', title: 'ارسال', requiredPermission },
      { fromStateKey: 'draft', toStateKey: 'rejected', actionKey: 'reject', title: 'رد' },
    ],
  });
  const { WorkflowTransitionExecutor } = await import('../../services/workflow/workflowTransitionExecutor.js');
  const [admin] = await h.q(`SELECT id, full_name FROM users WHERE username = 'pen_admin' AND is_deleted = 0`);
  const inst = await WorkflowTransitionExecutor.startInstance({
    workflowDefinitionId: Number(saved?.definition.id), entityType, entityId: '1', userId: Number(admin?.id), userName: String(admin?.full_name),
  });
  const [approve] = await h.q(`SELECT id FROM workflow_transitions WHERE workflow_definition_id = $1 AND action_key = 'send'`, [saved?.definition.id]);
  return { instanceId: inst.id, approveId: Number(approve?.id) };
}

function rowsOf(body: unknown): Row[] {
  const data = (body as { data?: unknown } | undefined)?.data;
  return Array.isArray(data) ? (data as Row[]) : [];
}

export async function runWorkflowInboxGateTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_inbox_execute_keys_td_1150', 'security', 'td1150', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_inbox_execute_keys_td_1150',
      name: 'The inbox lists a pending task only to a user who may execute it (TD-1150)',
      details: 'a roleless step: a workflow.view-only user gets no inbox row and a zero pending count; a workflow.approve user gets the row',
    }, async (h, wrong) => {
      const code = gateCode(h, 'KEYS');
      try {
        const { instanceId } = await startOneStep(h, code);
        const reader = await h.sessionWith(['workflow.view']);
        const approver = await h.sessionWith(['workflow.view', 'workflow.approve']);
        const readerRows = rowsOf((await h.get('/api/workflow/tasks/my-tasks?status=pending&limit=1000', reader)).body);
        if (readerRows.some(r => Number(r.instanceId) === instanceId)) wrong.push('a workflow.view-only user gets an inbox task they cannot execute');
        const stats = await h.get('/api/workflow/tasks/stats', reader);
        if (Number(stats.body?.pendingCount) !== 0) wrong.push(`a workflow.view-only user has pendingCount ${String(stats.body?.pendingCount)}, expected 0`);
        const approverRows = rowsOf((await h.get('/api/workflow/tasks/my-tasks?status=pending&limit=1000', approver)).body);
        if (!approverRows.some(r => Number(r.instanceId) === instanceId)) wrong.push('a workflow.approve user lost the roleless task');
      } finally {
        await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_permission_title_td_1152', 'security', 'td1152', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_permission_title_td_1152',
      name: 'A step refused for its required permission names the permission in Persian, not its key (TD-1152)',
      details: 'a step asking warehouse.out, run by a workflow.approve user without it: 403 WF_PERMISSION_REQUIRED whose message has the catalog title and not the key',
    }, async (h, wrong) => {
      const code = gateCode(h, 'TITLE');
      try {
        const { instanceId, approveId } = await startOneStep(h, code, 'warehouse.out');
        const approver = await h.sessionWith(['workflow.view', 'workflow.approve']);
        const res = await h.post('/api/workflow/transition', { instanceId, transitionId: approveId }, approver);
        const body = JSON.stringify(res.body);
        if (res.status !== 403 || !body.includes('WF_PERMISSION_REQUIRED')) wrong.push(`expected 403 WF_PERMISSION_REQUIRED, got ${res.status} ${body.slice(0, 160)}`);
        const message = String(res.body?.error ?? res.body?.message ?? '');
        if (message.includes('warehouse.out')) wrong.push(`the message shows the permission key: ${message}`);
        if (!message.includes('ثبت خروج کالا')) wrong.push(`the message does not name the permission: ${message}`);
      } finally {
        await dropDefinition(h, code);
      }
    });
  }

  if (shouldRun('sec_workflow_signer_full_name_td_1153', 'security', 'td1153', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_signer_full_name_td_1153',
      name: 'A signature and its history row carry the signer\'s full name, not the username (TD-1153)',
      details: 'a workflow.approve user runs a roleless step through /workflow/transition: the history row and the stored signature have users.full_name',
    }, async (h, wrong) => {
      const code = gateCode(h, 'NAME');
      try {
        const { instanceId, approveId } = await startOneStep(h, code);
        const approver = await h.sessionWith(['workflow.view', 'workflow.approve']);
        const [user] = await h.q(`SELECT username, full_name FROM users WHERE id = $1`, [approver.userId]);
        const fullName = String(user?.full_name ?? '');
        if (!fullName || fullName === user?.username) {
          wrong.push('the test user has no distinct full name');
          return;
        }
        const res = await h.post('/api/workflow/transition', { instanceId, transitionId: approveId }, approver);
        if (res.status !== 200) {
          wrong.push(`the transition returned ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
          return;
        }
        const [log] = await h.q(`SELECT performed_by_name FROM workflow_history_logs WHERE instance_id = $1 AND transition_id = $2 ORDER BY id DESC LIMIT 1`, [instanceId, approveId]);
        if (log?.performed_by_name !== fullName) wrong.push(`history performed_by_name is «${String(log?.performed_by_name)}», expected the full name`);
        const [inst] = await h.q(`SELECT approval_progress_json FROM workflow_instances WHERE id = $1`, [instanceId]);
        const progress = (inst?.approval_progress_json ?? {}) as Record<string, { signatures?: Array<{ userName?: string }> }>;
        const names = Object.values(progress).flatMap(p => (p.signatures ?? []).map(s => s.userName));
        if (names.length > 0 && !names.includes(fullName)) wrong.push(`stored signatures are ${JSON.stringify(names)}, expected the full name`);
      } finally {
        await dropDefinition(h, code);
      }
    });
  }

  return results;
}
