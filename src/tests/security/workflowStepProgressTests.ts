import { TestCaseResult } from '../types.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * Phase 3, lane L4 (guide finding, TD-1172): the instance answer carries only the signature progress of the current
 * step's actions, so the stepper never lists the previous step's signer under the step being signed. Test names and
 * failure messages are English (terminal output).
 */
export async function runWorkflowStepProgressTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_progress_current_step_td_1172', 'security', 'td1172', 'workflow', 'package14')) {
    await runCase(results, {
      id: 'sec_workflow_progress_current_step_td_1172',
      name: 'The instance answer carries only the current step\'s signature progress (TD-1172)',
      details: 'draft -> review -> done: after the first action the answer has no progress for it; the stored progress is kept',
    }, async (h, wrong) => {
      const code = `WFL4_PROG_${h.tag}_${Math.floor(Math.random() * 1e6)}`;
      const entityType = `wfl4p_${h.tag}`;
      try {
        const saved = await WorkflowDefinitionService.saveWorkflowDefinition({
          code, title: 'دو گام', entityType,
          states: [
            { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
            { stateKey: 'review', title: 'بررسی انبار', stateType: 'intermediate' },
            { stateKey: 'done', title: 'تأیید شده', stateType: 'terminal' },
            { stateKey: 'rejected', title: 'رد شده', stateType: 'terminal' },
          ],
          transitions: [
            { fromStateKey: 'draft', toStateKey: 'review', actionKey: 'send', title: 'ارسال' },
            { fromStateKey: 'review', toStateKey: 'done', actionKey: 'approve', title: 'تأیید' },
            { fromStateKey: 'review', toStateKey: 'rejected', actionKey: 'reject', title: 'رد' },
          ],
        });
        const [admin] = await h.q(`SELECT id, full_name FROM users WHERE username = 'pen_admin' AND is_deleted = 0`);
        await WorkflowTransitionExecutor.startInstance({
          workflowDefinitionId: Number(saved?.definition.id), entityType, entityId: '1', userId: Number(admin?.id), userName: String(admin?.full_name),
        });
        const [inst] = await h.q(`SELECT id FROM workflow_instances WHERE entity_type = $1`, [entityType]);
        const statuses = await h.walk(Number(inst?.id), ['send'], h.admin);
        if (statuses[0] !== 200) {
          wrong.push(`the first action returned ${String(statuses[0])}`);
          return;
        }
        const [sendTr] = await h.q(`SELECT id FROM workflow_transitions WHERE workflow_definition_id = $1 AND action_key = 'send'`, [saved?.definition.id]);
        const [stored] = await h.q(`SELECT approval_progress_json FROM workflow_instances WHERE id = $1`, [inst?.id]);
        const storedKeys = Object.keys((stored?.approval_progress_json ?? {}) as Record<string, unknown>);
        const answer = await WorkflowTransitionExecutor.getInstanceByEntity(entityType, '1', Number(admin?.id), 'admin', []);
        const shownKeys = Object.keys((answer?.approvalProgress ?? {}) as Record<string, unknown>);
        if (shownKeys.includes(String(sendTr?.id))) wrong.push('the answer shows the previous step\'s signature progress under the current step');
        if (!storedKeys.includes(String(sendTr?.id))) wrong.push('the stored progress of the finished action was removed');
      } finally {
        const ids = (await h.q(`SELECT id FROM workflow_definitions WHERE code = $1`, [code])).map(r => Number(r.id));
        if (ids.length > 0) {
          await h.q(`DELETE FROM workflow_instances WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
          await h.q(`DELETE FROM workflow_definition_versions WHERE definition_id = ANY($1::int[])`, [ids]);
          await h.q(`DELETE FROM workflow_transitions WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
          await h.q(`DELETE FROM workflow_states WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
          await h.q(`DELETE FROM workflow_definitions WHERE id = ANY($1::int[])`, [ids]);
        }
      }
    });
  }

  return results;
}
