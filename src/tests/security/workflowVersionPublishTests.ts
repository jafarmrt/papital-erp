import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';
import { dropDefinitions } from './workflowDefinitionSwitchTests.js';

/**
 * v10.1.19 (TD-1270, D-06 part D, decisions ت۴ / ت۱۰): a design save of an existing workflow is a draft that new records
 * do not see; `workflow.admin` publishes it or reverts to an earlier version, which is published as a new version. Running
 * records keep their own version. All through the real Express routes.
 */

const AUDIT_ENTITY = 'طرح گردش کار';

const design = (code: string, entityType: string, withReject: boolean, requiredRole = '') => ({
  code, title: `گردش کار ${code}`, entityType,
  states: [
    { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
    { stateKey: 'done', title: 'تأیید شده', stateType: 'terminal' },
    ...(withReject ? [{ stateKey: 'rejected', title: 'رد شده', stateType: 'terminal' }] : []),
  ],
  transitions: [
    { fromStateKey: 'draft', toStateKey: 'done', actionKey: 'approve', title: 'تأیید', requiredRole },
    ...(withReject ? [{ fromStateKey: 'draft', toStateKey: 'rejected', actionKey: 'reject', title: 'رد' }] : []),
  ],
});

async function save(h: Harness, body: Record<string, unknown>): Promise<number> {
  const res = await h.post('/api/workflow/definitions', body);
  const id = Number((res.body?.data?.definition ?? res.body?.data)?.id);
  if (res.status !== 200 || !(id > 0)) throw new Error(`saving workflow ${String(body.code)} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  return id;
}

const defRow = async (h: Harness, id: number): Promise<Row | undefined> =>
  (await h.q(`SELECT version, published_version FROM workflow_definitions WHERE id = $1`, [id]))[0];

const statuses = async (h: Harness, id: number): Promise<string> =>
  (await h.q(`SELECT version, status FROM workflow_definition_versions WHERE definition_id = $1 ORDER BY version`, [id]))
    .map(r => `${String(r.version)}:${String(r.status)}`).join(',');

const auditCount = async (h: Harness, id: number): Promise<number> =>
  (await h.q(`SELECT id FROM activity_logs WHERE entity = $1 AND entity_id = $2`, [AUDIT_ENTITY, String(id)])).length;

/** Starts a record and answers its version and how many steps its snapshot holds. */
async function startRecord(h: Harness, code: string, entityType: string, entityId: string): Promise<{ version: number; steps: number }> {
  const started = await h.start({ workflowCode: code, entityType, entityId });
  if (started.status !== 200) throw new Error(`starting record ${entityId} returned ${started.status}: ${JSON.stringify(started.body).slice(0, 200)}`);
  const [inst] = await h.q(`SELECT definition_version, jsonb_array_length(snapshot_dsl -> 'states') AS steps FROM workflow_instances WHERE id = $1`, [Number(started.body.data?.id)]);
  return { version: Number(inst?.definition_version), steps: Number(inst?.steps) };
}

export async function runWorkflowVersionPublishTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_draft_publish_td_1270', 'security', 'td1270', 'd-06', 'workflow')) {
    await runCase(results, {
      id: 'sec_workflow_draft_publish_td_1270',
      name: 'v10.1.19: a design save of an existing workflow is a draft new records do not see until workflow.admin publishes it; the draft and its changes are listed; a stale or missing draft is refused (TD-1270)',
      details: 'new workflow published at once; edit saved as draft v2 (published stays 1); record started meanwhile runs v1; GET draft lists the added step and action; workflow.manage 403; stale draftVersion 409 WF_DRAFT_CHANGED; publish 200 with an audit row, v1 retired; next record runs v2; publish again 409 WF_NO_DRAFT',
    }, async (h, wrong) => {
      const type = `wfdp_${h.tag}`;
      const code = `WFDP_${h.tag}`;
      const ids: number[] = [];
      try {
        const id = await save(h, design(code, type, false));
        ids.push(id);
        const created = await defRow(h, id);
        if (Number(created?.published_version) !== 1 || await statuses(h, id) !== '1:published') {
          wrong.push(`a new workflow is published_version ${String(created?.published_version)} with versions ${await statuses(h, id)}, not 1 and 1:published`);
        }

        await save(h, { ...design(code, type, true), id });
        const drafted = await defRow(h, id);
        if (Number(drafted?.version) !== 2 || Number(drafted?.published_version) !== 1) {
          wrong.push(`after an edit the workflow is version ${String(drafted?.version)} published ${String(drafted?.published_version)}, not 2 and 1`);
        }
        if (await statuses(h, id) !== '1:published,2:draft') wrong.push(`after an edit the versions are ${await statuses(h, id)}, not 1:published,2:draft`);

        const before = await startRecord(h, code, type, '1');
        if (before.version !== 1 || before.steps !== 2) wrong.push(`a record started while a draft waits runs version ${before.version} with ${before.steps} steps, not 1 with 2`);

        const draft = await h.get(`/api/workflow/definitions/${id}/draft`);
        const diff = draft.body?.diff as { addedSteps?: Row[]; addedActions?: Row[]; removedSteps?: Row[] } | undefined;
        if (draft.status !== 200 || Number(draft.body?.draftVersion) !== 2 || Number(draft.body?.publishedVersion) !== 1) {
          wrong.push(`GET draft returned ${draft.status} draft ${String(draft.body?.draftVersion)} published ${String(draft.body?.publishedVersion)}`);
        } else if (diff?.addedSteps?.map(s => s.key).join(',') !== 'rejected' || diff?.addedActions?.length !== 1 || (diff?.removedSteps?.length ?? 0) !== 0) {
          wrong.push(`the draft diff is ${JSON.stringify(diff).slice(0, 200)}, not one added step «rejected» and one added action`);
        }

        const manager = await h.sessionWith(['workflow.view', 'workflow.manage']);
        const managerTry = await h.post(`/api/workflow/definitions/${id}/publish`, { draftVersion: 2 }, manager);
        if (managerTry.status !== 403) wrong.push(`workflow.manage published a draft with ${managerTry.status}, not 403`);
        const stale = await h.post(`/api/workflow/definitions/${id}/publish`, { draftVersion: 1 });
        if (stale.status !== 409 || stale.body?.code !== 'WF_DRAFT_CHANGED') wrong.push(`publishing a stale draft returned ${stale.status} ${String(stale.body?.code)}, not 409 WF_DRAFT_CHANGED`);

        const switcher = await h.sessionWith(['workflow.view', 'workflow.admin']);
        const audits = await auditCount(h, id);
        const publish = await h.post(`/api/workflow/definitions/${id}/publish`, { draftVersion: 2 }, switcher);
        if (publish.status !== 200 || Number(publish.body?.data?.publishedVersion) !== 2) wrong.push(`publishing returned ${publish.status} ${JSON.stringify(publish.body).slice(0, 150)}`);
        if (Number((await defRow(h, id))?.published_version) !== 2) wrong.push('publishing left published_version unchanged');
        if (await statuses(h, id) !== '1:retired,2:published') wrong.push(`after publishing the versions are ${await statuses(h, id)}, not 1:retired,2:published`);
        if (await auditCount(h, id) !== audits + 1) wrong.push('publishing wrote no audit row');

        const after = await startRecord(h, code, type, '2');
        if (after.version !== 2 || after.steps !== 3) wrong.push(`a record started after publishing runs version ${after.version} with ${after.steps} steps, not 2 with 3`);
        const [kept] = await h.q(`SELECT jsonb_array_length(snapshot_dsl -> 'states') AS steps FROM workflow_instances WHERE entity_type = $1 AND entity_id = '1'`, [type]);
        if (Number(kept?.steps) !== 2) wrong.push(`the record started before publishing now holds ${String(kept?.steps)} steps, not its own 2`);

        const again = await h.post(`/api/workflow/definitions/${id}/publish`, { draftVersion: 2 });
        if (again.status !== 409 || again.body?.code !== 'WF_NO_DRAFT') wrong.push(`publishing without a draft returned ${again.status} ${String(again.body?.code)}, not 409 WF_NO_DRAFT`);
      } finally {
        await dropDefinitions(h, ids);
      }
    });
  }

  if (shouldRun('sec_workflow_revert_version_td_1270', 'security', 'td1270', 'd-06', 'workflow')) {
    await runCase(results, {
      id: 'sec_workflow_revert_version_td_1270',
      name: 'v10.1.19: workflow.admin reverts a workflow to an earlier version, published as a new version that sets the waiting draft aside; history is kept; the current version, a missing one and workflow.manage are refused (TD-1270)',
      details: 'v1 two steps, v2 three steps published, v3 draft; revert to 1 gives v4 published, v3 retired, step tables back to two steps, an audit row naming version 1; next record runs v4; revert to the published v4 409; v99 404; workflow.manage 403',
    }, async (h, wrong) => {
      const type = `wfrv_${h.tag}`;
      const code = `WFRV_${h.tag}`;
      const ids: number[] = [];
      try {
        const id = await save(h, design(code, type, false));
        ids.push(id);
        await save(h, { ...design(code, type, true), id });
        const published = await h.post(`/api/workflow/definitions/${id}/publish`, { draftVersion: 2 });
        if (published.status !== 200) throw new Error(`publishing version 2 returned ${published.status}`);
        await save(h, { ...design(code, type, true), id, description: 'draft 3' });

        const manager = await h.sessionWith(['workflow.view', 'workflow.manage']);
        const managerTry = await h.post(`/api/workflow/definitions/${id}/revert`, { version: 1 }, manager);
        if (managerTry.status !== 403) wrong.push(`workflow.manage reverted a workflow with ${managerTry.status}, not 403`);

        const audits = await auditCount(h, id);
        const revert = await h.post(`/api/workflow/definitions/${id}/revert`, { version: 1 });
        const data = revert.body?.data as Row | undefined;
        if (revert.status !== 200 || Number(data?.publishedVersion) !== 4 || Number(data?.discardedDraftVersion) !== 3) {
          wrong.push(`reverting to version 1 returned ${revert.status} ${JSON.stringify(revert.body).slice(0, 200)}`);
        }
        if (await statuses(h, id) !== '1:retired,2:retired,3:retired,4:published') wrong.push(`after the revert the versions are ${await statuses(h, id)}`);
        const steps = await h.q(`SELECT state_key FROM workflow_states WHERE workflow_definition_id = $1 ORDER BY state_key`, [id]);
        if (steps.map(s => s.state_key).join(',') !== 'done,draft') wrong.push(`after the revert the design has steps ${steps.map(s => s.state_key).join(',')}, not done,draft`);
        const [audit] = await h.q(`SELECT details FROM activity_logs WHERE entity = $1 AND entity_id = $2 ORDER BY id DESC LIMIT 1`, [AUDIT_ENTITY, String(id)]);
        const details = (typeof audit?.details === 'string' ? JSON.parse(audit.details) : audit?.details) as Row | undefined;
        if (await auditCount(h, id) !== audits + 1 || Number(details?.revertedFrom) !== 1) wrong.push(`the revert audit row is ${JSON.stringify(details).slice(0, 150)}`);

        const record = await startRecord(h, code, type, '1');
        if (record.version !== 4 || record.steps !== 2) wrong.push(`a record started after the revert runs version ${record.version} with ${record.steps} steps, not 4 with 2`);

        const current = await h.post(`/api/workflow/definitions/${id}/revert`, { version: 4 });
        if (current.status !== 409 || current.body?.code !== 'WF_VERSION_ALREADY_PUBLISHED') wrong.push(`reverting to the published version returned ${current.status} ${String(current.body?.code)}`);
        const missing = await h.post(`/api/workflow/definitions/${id}/revert`, { version: 99 });
        if (missing.status !== 404) wrong.push(`reverting to a missing version returned ${missing.status}, not 404`);
      } finally {
        await dropDefinitions(h, ids);
      }
    });
  }

  if (shouldRun('sec_workflow_published_role_kept_td_1270', 'security', 'td1270', 'd-06', 'workflow')) {
    await runCase(results, {
      id: 'sec_workflow_published_role_kept_td_1270',
      name: 'v10.1.19: a role the published version asks is not deleted while a draft without it waits (TD-1270)',
      details: 'workflow published with a step role; a draft drops it; DELETE /roles/:id is 409 ROLE_USED_BY_WORKFLOW',
    }, async (h, wrong) => {
      const type = `wfrl_${h.tag}`;
      const code = `WFRL_${h.tag}`;
      const ids: number[] = [];
      try {
        const holder = await h.sessionWith(['workflow.view']);
        const [role] = await h.q(`SELECT id FROM roles WHERE code = $1`, [holder.role]);
        await h.q(`UPDATE users SET is_deleted = 1 WHERE id = $1`, [holder.userId]);
        const id = await save(h, design(code, type, false, holder.role));
        ids.push(id);
        await save(h, { ...design(code, type, false), id });
        const del = await h.del(`/api/roles/${Number(role?.id)}`);
        if (del.status !== 409 || del.body?.code !== 'ROLE_USED_BY_WORKFLOW') wrong.push(`deleting a role of the published version returned ${del.status} ${String(del.body?.code)}, not 409 ROLE_USED_BY_WORKFLOW`);
      } finally {
        await dropDefinitions(h, ids);
      }
    });
  }

  return results;
}
