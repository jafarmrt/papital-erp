import { TestCaseResult } from '../types.js';
import { isCatalogPermission } from '../../lib/permissions/permissionCatalog.js';
import { WORKFLOW_TEMPLATES } from '../../lib/workflow/workflowTemplates.js';
import { dropDefinitions } from './workflowDefinitionSwitchTests.js';
import { runCase, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.1.8 (TD-1263, D-06 part B): «ساخت از الگو» makes an inactive definition from one of the four ready-made templates
 * (decisions ت۴ / ت۵), its actions guarded by catalog permission keys only; and a workflow starts only on the server,
 * in its record's create transaction (OWN-04, decision ت۷ «برداشتن»), so `POST /workflow/start` is gone. Red on
 * v10.1.7, where the template route did not exist and the browser could start any workflow on any record id.
 */

const AUDIT_ENTITY = 'طرح گردش کار';

export async function runWorkflowTemplateTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_templates_td_1263', 'security', 'td1263', 'd-06', 'workflow')) {
    await runCase(results, {
      id: 'sec_workflow_templates_td_1263',
      name: 'v10.1.8: «ساخت از الگو» makes an inactive definition from each of the four templates, guarded by catalog permissions only, with an audit row; the active definitions stay as they are (TD-1263)',
      details: 'workflow.view 403; unknown template 400; item, bank account, purchase requisition and journal voucher templates 201 and inactive with the template steps and actions, no role code; a second copy takes a new code; the seeded active definitions stay active',
    }, async (h, wrong) => {
      const ids: number[] = [];
      const activeBefore = (await h.q(`SELECT id FROM workflow_definitions WHERE is_active = 1 ORDER BY id`)).map(r => Number(r.id));
      try {
        const viewer = await h.sessionWith(['workflow.view']);
        const refused = await h.post('/api/workflow/definitions/from-template', { templateId: 'item' }, viewer);
        if (refused.status !== 403) wrong.push(`workflow.view alone made a definition from a template: ${refused.status}`);
        const unknown = await h.post('/api/workflow/definitions/from-template', { templateId: 'no_such_template' });
        if (unknown.status !== 400) wrong.push(`an unknown template returned ${unknown.status}, not 400`);

        const designer = await h.sessionWith(['workflow.view', 'workflow.manage']);
        for (const template of WORKFLOW_TEMPLATES) {
          const res = await h.post('/api/workflow/definitions/from-template', { templateId: template.id }, designer);
          const id = Number(res.body?.data?.id);
          if (res.status !== 201 || !(id > 0)) { wrong.push(`template ${template.id} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 160)}`); continue; }
          ids.push(id);
          const [def] = await h.q(`SELECT code, entity_type, is_active FROM workflow_definitions WHERE id = $1`, [id]);
          if (Number(def?.is_active) !== 0) wrong.push(`template ${template.id} made an active definition`);
          if (def?.entity_type !== template.entityType) wrong.push(`template ${template.id} made record type ${String(def?.entity_type)}`);
          if (!String(def?.code).startsWith(template.code)) wrong.push(`template ${template.id} got code ${String(def?.code)}`);
          const states = await h.q(`SELECT state_key FROM workflow_states WHERE workflow_definition_id = $1`, [id]);
          const transitions = await h.q(`SELECT action_key, required_role, required_permission FROM workflow_transitions WHERE workflow_definition_id = $1`, [id]);
          if (states.length !== template.states.length) wrong.push(`template ${template.id} made ${states.length} steps, not ${template.states.length}`);
          if (transitions.length !== template.transitions.length) wrong.push(`template ${template.id} made ${transitions.length} actions, not ${template.transitions.length}`);
          for (const tr of transitions) {
            if (String(tr.required_role ?? '').trim() !== '') wrong.push(`template ${template.id} action ${String(tr.action_key)} is guarded by role ${String(tr.required_role)}`);
            const key = String(tr.required_permission ?? '').trim();
            if (key && !isCatalogPermission(key)) wrong.push(`template ${template.id} action ${String(tr.action_key)} asks unknown key ${key}`);
          }
          const audit = await h.q(`SELECT details FROM activity_logs WHERE entity = $1 AND entity_id = $2`, [AUDIT_ENTITY, String(id)]);
          if (!audit.some(a => JSON.stringify(a.details ?? '').includes(template.id))) wrong.push(`template ${template.id} definition has no audit row naming its template`);
        }

        const again = await h.post('/api/workflow/definitions/from-template', { templateId: 'item' }, designer);
        const againId = Number(again.body?.data?.id);
        if (again.status === 201 && againId > 0) ids.push(againId);
        const codes = (await h.q(`SELECT code FROM workflow_definitions WHERE id = ANY($1::int[])`, [ids])).map(r => String(r.code));
        if (again.status !== 201 || new Set(codes).size !== codes.length) wrong.push(`a second item template copy returned ${again.status} with codes ${codes.join(', ')}`);

        const activeAfter = (await h.q(`SELECT id FROM workflow_definitions WHERE is_active = 1 ORDER BY id`)).map(r => Number(r.id));
        if (JSON.stringify(activeAfter) !== JSON.stringify(activeBefore)) wrong.push(`active definitions changed from ${activeBefore.join(',')} to ${activeAfter.join(',')}`);
      } finally {
        await dropDefinitions(h, ids);
      }
    });
  }

  if (shouldRun('sec_workflow_start_route_removed_td_1263', 'security', 'td1263', 'own-04', 'workflow')) {
    await runCase(results, {
      id: 'sec_workflow_start_route_removed_td_1263',
      name: 'v10.1.8: the browser cannot start a workflow; POST /workflow/start is gone and the instance read offers no start (TD-1263, OWN-04)',
      details: 'POST /api/workflow/start 404 for the system admin; GET /api/workflow/instance of a record without a workflow answers instance null with no startable flag',
    }, async (h, wrong) => {
      const start = await h.post('/api/workflow/start', { workflowCode: 'JOURNAL_VOUCHER_WORKFLOW', entityType: 'journal_voucher', entityId: '999999901' });
      if (start.status !== 404) wrong.push(`POST /api/workflow/start returned ${start.status}, not 404`);
      const read = await h.get('/api/workflow/instance/journal_voucher/999999901');
      if (read.status === 200 && (read.body?.instance !== null || 'startable' in (read.body ?? {}))) {
        wrong.push(`instance read of a record without a workflow returned ${JSON.stringify(read.body).slice(0, 160)}`);
      }
    });
  }

  return results;
}
