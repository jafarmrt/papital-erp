import { TestCaseResult } from '../types.js';
import { runCase, type Harness, type Row, type ShouldRun } from './workflowTestHarness.js';

/**
 * v10.1.7 (TD-1229, D-06 part A): a workflow definition is turned on and off, archived and restored from the workflow
 * page; at most one definition of a record type is active, a new one is active only when its type has none (decision
 * ت۲۷), the record type changes only while inactive and never used, and the purchase requisition workflow is never left
 * off. All through the real Express routes.
 */

const AUDIT_ENTITY = 'طرح گردش کار';

const twoStepDesign = (code: string, entityType: string, title = `گردش کار ${code}`) => ({
  code, title, entityType,
  states: [
    { stateKey: 'draft', title: 'پیش‌نویس', stateType: 'initial' },
    { stateKey: 'done', title: 'تأیید شده', stateType: 'terminal' },
  ],
  transitions: [{ fromStateKey: 'draft', toStateKey: 'done', actionKey: 'approve', title: 'تأیید' }],
});

const defRow = async (h: Harness, id: number): Promise<Row | undefined> =>
  (await h.q(`SELECT id, entity_type, is_active, is_archived FROM workflow_definitions WHERE id = $1`, [id]))[0];

const auditCount = async (h: Harness, id: number): Promise<number> =>
  (await h.q(`SELECT id FROM activity_logs WHERE entity = $1 AND entity_id = $2`, [AUDIT_ENTITY, String(id)])).length;

async function saveDesign(h: Harness, body: Record<string, unknown>): Promise<{ id: number; isActive: number }> {
  const res = await h.post('/api/workflow/definitions', body);
  const def = res.body?.data?.definition ?? res.body?.data;
  const id = Number(def?.id);
  if (res.status !== 200 || !(id > 0)) throw new Error(`saving workflow ${String(body.code)} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  return { id, isActive: Number(def?.isActive) };
}

async function dropDefinitions(h: Harness, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await h.q(`DELETE FROM workflow_instances WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_definition_versions WHERE definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_transitions WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_states WHERE workflow_definition_id = ANY($1::int[])`, [ids]);
  await h.q(`DELETE FROM workflow_definitions WHERE id = ANY($1::int[])`, [ids]);
}

export async function runWorkflowDefinitionSwitchTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('sec_workflow_definition_switch_td_1229', 'security', 'td1229', 'd-06', 'workflow')) {
    await runCase(results, {
      id: 'sec_workflow_definition_switch_td_1229',
      name: 'v10.1.7: one active workflow per record type; a workflow is turned on (replacing the active one only when asked), off, archived and restored, each with an audit row; workflow.manage cannot switch (TD-1229)',
      details: 'second workflow of a type is saved inactive; activate without replaceActive 409 naming the active one, with it 200 and the old one off; archive an active one 409; off, archive, activate archived 409, restore inactive; workflow.manage 403, workflow.admin 200; a second active row is refused by the unique index',
    }, async (h, wrong) => {
      const type = `wfsw_${h.tag}`;
      const ids: number[] = [];
      try {
        const a = await saveDesign(h, twoStepDesign(`WFSW_A_${h.tag}`, type));
        ids.push(a.id);
        const b = await saveDesign(h, twoStepDesign(`WFSW_B_${h.tag}`, type));
        ids.push(b.id);
        if (a.isActive !== 1) wrong.push(`the first workflow of a type was saved with is_active ${a.isActive}, not 1`);
        if (b.isActive !== 0) wrong.push(`a second workflow of a type with an active one was saved with is_active ${b.isActive}, not 0`);

        const ask = await h.post(`/api/workflow/definitions/${b.id}/activate`, {});
        if (ask.status !== 409 || ask.body?.code !== 'WF_ACTIVE_DEFINITION_EXISTS') wrong.push(`activating beside an active workflow returned ${ask.status} ${String(ask.body?.code)}, not 409 WF_ACTIVE_DEFINITION_EXISTS`);
        else if (Number(ask.body?.details?.activeDefinitionId) !== a.id) wrong.push(`the refusal named workflow ${String(ask.body?.details?.activeDefinitionId)}, not ${a.id}`);
        if (Number((await defRow(h, a.id))?.is_active) !== 1) wrong.push('the refused activation turned the active workflow off');

        const manager = await h.sessionWith(['workflow.view', 'workflow.manage']);
        const managerTry = await h.post(`/api/workflow/definitions/${b.id}/activate`, { replaceActive: true }, manager);
        if (managerTry.status !== 403) wrong.push(`workflow.manage activated a workflow with ${managerTry.status}, not 403`);
        const switcher = await h.sessionWith(['workflow.view', 'workflow.admin']);
        const auditA = await auditCount(h, a.id);
        const replace = await h.post(`/api/workflow/definitions/${b.id}/activate`, { replaceActive: true }, switcher);
        if (replace.status !== 200) wrong.push(`activating with replaceActive returned ${replace.status}`);
        if (Number(replace.body?.data?.replaced?.id) !== a.id) wrong.push(`the answer named replaced ${JSON.stringify(replace.body?.data?.replaced)}`);
        const [rowA, rowB] = [await defRow(h, a.id), await defRow(h, b.id)];
        if (Number(rowA?.is_active) !== 0 || Number(rowB?.is_active) !== 1) wrong.push(`after the replacement A is ${String(rowA?.is_active)} and B ${String(rowB?.is_active)}, not 0 and 1`);
        if (await auditCount(h, a.id) !== auditA + 1) wrong.push('turning the replaced workflow off wrote no audit row of its own');

        const archiveActive = await h.post(`/api/workflow/definitions/${b.id}/archive`, {});
        if (archiveActive.status !== 409 || archiveActive.body?.code !== 'WF_DEFINITION_ACTIVE') wrong.push(`archiving an active workflow returned ${archiveActive.status} ${String(archiveActive.body?.code)}`);
        const off = await h.post(`/api/workflow/definitions/${b.id}/deactivate`, {});
        if (off.status !== 200 || Number((await defRow(h, b.id))?.is_active) !== 0) wrong.push(`deactivating returned ${off.status} and left is_active ${String((await defRow(h, b.id))?.is_active)}`);
        const archived = await h.post(`/api/workflow/definitions/${b.id}/archive`, {});
        if (archived.status !== 200 || Number((await defRow(h, b.id))?.is_archived) !== 1) wrong.push(`archiving returned ${archived.status} and left is_archived ${String((await defRow(h, b.id))?.is_archived)}`);
        const list = await h.get('/api/workflow/definitions');
        const listed = (Array.isArray(list.body) ? list.body : (Array.isArray(list.body?.data) ? list.body.data : [])).find((d: Row) => Number(d.id) === b.id);
        if (Number(listed?.isArchived) !== 1) wrong.push('the definitions list does not carry isArchived of the archived workflow');
        const activateArchived = await h.post(`/api/workflow/definitions/${b.id}/activate`, { replaceActive: true });
        if (activateArchived.status !== 409 || activateArchived.body?.code !== 'WF_DEFINITION_ARCHIVED') wrong.push(`activating an archived workflow returned ${activateArchived.status} ${String(activateArchived.body?.code)}`);
        const restored = await h.post(`/api/workflow/definitions/${b.id}/restore`, {});
        const rowRestored = await defRow(h, b.id);
        if (restored.status !== 200 || Number(rowRestored?.is_archived) !== 0 || Number(rowRestored?.is_active) !== 0) wrong.push(`restoring returned ${restored.status} with ${JSON.stringify(rowRestored)}, not inactive and unarchived`);
        const logs = await h.q(`SELECT details FROM activity_logs WHERE entity = $1 AND entity_id = $2 ORDER BY id`, [AUDIT_ENTITY, String(b.id)]);
        const states = logs.map(l => (l.details as { after?: { isActive?: number; isArchived?: number } } | null)?.after).filter(Boolean);
        const trail = states.map(s => `${s?.isActive}${s?.isArchived}`).join(',');
        if (!trail.endsWith('10,00,01,00')) wrong.push(`the audit trail of B is ${trail}, expected it to end 10,00,01,00`);

        let refused = '';
        try {
          await h.q(`UPDATE workflow_definitions SET is_active = 1 WHERE id = ANY($1::int[])`, [ids]);
        } catch (err) {
          refused = String((err as { code?: string }).code ?? '');
        }
        if (refused !== '23505') wrong.push(`two active workflows of one type were stored (error code «${refused}», expected 23505)`);
      } finally {
        await dropDefinitions(h, ids);
      }
    });
  }

  if (shouldRun('sec_workflow_entity_type_lock_td_1229', 'security', 'td1229', 'obs-pr-15', 'obs-r2-64', 'workflow')) {
    await runCase(results, {
      id: 'sec_workflow_entity_type_lock_td_1229',
      name: 'v10.1.7: the designer save changes the record type only of an inactive workflow no record entered, and writes an audit row with before and after (TD-1229, OBS-PR-15, OBS-R2-64)',
      details: 'type change of an active workflow 422 WF_ENTITY_TYPE_LOCKED; of an inactive unused one 200 and stored; of an inactive one with a started record 422; each save writes one audit row',
    }, async (h, wrong) => {
      const typeA = `wfst_${h.tag}`;
      const typeB = `wfsu_${h.tag}`;
      const ids: number[] = [];
      try {
        const active = await saveDesign(h, twoStepDesign(`WFST_A_${h.tag}`, typeA));
        ids.push(active.id);
        const spare = await saveDesign(h, twoStepDesign(`WFST_B_${h.tag}`, typeA));
        ids.push(spare.id);

        const auditBefore = await auditCount(h, active.id);
        const lockedActive = await h.post('/api/workflow/definitions', { ...twoStepDesign(`WFST_A_${h.tag}`, typeB), id: active.id });
        if (lockedActive.status !== 422 || lockedActive.body?.code !== 'WF_ENTITY_TYPE_LOCKED') wrong.push(`changing the type of an active workflow returned ${lockedActive.status} ${String(lockedActive.body?.code)}`);
        if ((await defRow(h, active.id))?.entity_type !== typeA) wrong.push('the active workflow changed its record type');
        const sameType = await h.post('/api/workflow/definitions', { ...twoStepDesign(`WFST_A_${h.tag}`, typeA, 'عنوان تازه'), id: active.id });
        if (sameType.status !== 200) wrong.push(`saving the active workflow on its own type returned ${sameType.status}`);
        const saveLog = (await h.q(`SELECT action, details FROM activity_logs WHERE entity = $1 AND entity_id = $2 ORDER BY id DESC LIMIT 1`, [AUDIT_ENTITY, String(active.id)]))[0];
        const saveDetails = saveLog?.details as { before?: { title?: string }; after?: { title?: string } } | undefined;
        if (await auditCount(h, active.id) !== auditBefore + 1) wrong.push(`the design save wrote ${await auditCount(h, active.id) - auditBefore} audit rows, not 1`);
        else if (saveLog?.action !== 'UPDATE' || saveDetails?.after?.title !== 'عنوان تازه' || !saveDetails?.before?.title) wrong.push(`the design save audit row is ${JSON.stringify(saveLog)}`);

        const moved = await h.post('/api/workflow/definitions', { ...twoStepDesign(`WFST_B_${h.tag}`, typeB), id: spare.id });
        if (moved.status !== 200 || (await defRow(h, spare.id))?.entity_type !== typeB) wrong.push(`changing the type of an inactive unused workflow returned ${moved.status} and stored ${String((await defRow(h, spare.id))?.entity_type)}`);

        const [state] = await h.q(`SELECT id FROM workflow_states WHERE workflow_definition_id = $1 ORDER BY id LIMIT 1`, [spare.id]);
        await h.q(`INSERT INTO workflow_instances (workflow_definition_id, definition_version, entity_type, entity_id, current_state_id, status, version)
                   VALUES ($1, 1, $2, $3, $4, 'COMPLETED', 1)`, [spare.id, typeB, `WFST-${h.tag}`, state?.id]);
        const used = await h.post('/api/workflow/definitions', { ...twoStepDesign(`WFST_B_${h.tag}`, typeA), id: spare.id });
        if (used.status !== 422 || used.body?.code !== 'WF_ENTITY_TYPE_LOCKED') wrong.push(`changing the type of a workflow a record entered returned ${used.status} ${String(used.body?.code)}`);
        const detail = await h.get(`/api/workflow/definitions/${spare.id}`);
        const started = Number(detail.body?.data?.startedInstanceCount ?? detail.body?.startedInstanceCount);
        if (started !== 1) wrong.push(`the definition detail carries startedInstanceCount ${started}, not 1`);
      } finally {
        await dropDefinitions(h, ids);
      }
    });
  }

  if (shouldRun('sec_workflow_requisition_by_type_td_1229', 'security', 'td1229', 'workflow', 'procurement')) {
    await runCase(results, {
      id: 'sec_workflow_requisition_by_type_td_1229',
      name: 'v10.1.7: the purchase requisition workflow is never turned off; a new requisition starts with the active requisition workflow, not a fixed code (TD-1229)',
      details: 'deactivating the requisition workflow 409 WF_REQUIRED_WORKFLOW; a copy activated in its place starts the next requisition; the seed workflow takes the type back',
    }, async (h, wrong) => {
      const [seed] = await h.q(`SELECT id FROM workflow_definitions WHERE entity_type = 'purchase_requisition' AND is_active = 1`);
      const seedId = Number(seed?.id);
      if (!(seedId > 0)) throw new Error('no active purchase requisition workflow in the test schema');
      const off = await h.post(`/api/workflow/definitions/${seedId}/deactivate`, {});
      if (off.status !== 409 || off.body?.code !== 'WF_REQUIRED_WORKFLOW') wrong.push(`deactivating the requisition workflow returned ${off.status} ${String(off.body?.code)}`);
      if (Number((await defRow(h, seedId))?.is_active) !== 1) wrong.push('the requisition workflow was turned off');

      const states = await h.q(`SELECT id, state_key, title, state_type, step_order FROM workflow_states WHERE workflow_definition_id = $1 ORDER BY id`, [seedId]);
      const transitions = await h.q(`SELECT from_state_id, to_state_id, action_key, title, required_role, required_permission, approval_rule_type, k_value, is_initiator_excluded
                                     FROM workflow_transitions WHERE workflow_definition_id = $1 ORDER BY id`, [seedId]);
      const ids: number[] = [];
      try {
        const copy = await saveDesign(h, {
          code: `WFREQ_${h.tag}`, title: `درخواست خرید ${h.tag}`, entityType: 'purchase_requisition',
          states: states.map(s => ({ id: s.id, stateKey: s.state_key, title: s.title, stateType: s.state_type, stepOrder: s.step_order })),
          transitions: transitions.map(t => ({
            fromStateId: t.from_state_id, toStateId: t.to_state_id, actionKey: t.action_key, title: t.title, requiredRole: t.required_role ?? '',
            requiredPermission: t.required_permission ?? '', approvalRuleType: t.approval_rule_type, kValue: t.k_value, isInitiatorExcluded: Number(t.is_initiator_excluded) === 1,
          })),
        });
        ids.push(copy.id);
        if (copy.isActive !== 0) wrong.push('a second requisition workflow was saved active');
        const on = await h.post(`/api/workflow/definitions/${copy.id}/activate`, { replaceActive: true });
        if (on.status !== 200) throw new Error(`activating the copy returned ${on.status}: ${JSON.stringify(on.body).slice(0, 200)}`);
        const created = await h.post('/api/procurement/requisitions', {
          title: `درخواست گردش کار ${h.tag}`, priority: 'normal',
          items: [{ itemName: `خدمت آزمون ${h.tag}`, unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
        });
        const reqId = Number(created.body?.data?.id);
        if (created.status !== 201 || !(reqId > 0)) wrong.push(`creating a requisition under the copy returned ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
        else {
          const [inst] = await h.q(`SELECT workflow_definition_id FROM workflow_instances WHERE entity_type = 'purchase_requisition' AND entity_id = $1`, [String(reqId)]);
          if (Number(inst?.workflow_definition_id) !== copy.id) wrong.push(`the requisition started workflow ${String(inst?.workflow_definition_id)}, not the active copy ${copy.id}`);
          await h.q(`UPDATE workflow_instances SET status = 'TERMINATED' WHERE entity_type = 'purchase_requisition' AND entity_id = $1`, [String(reqId)]);
        }
      } finally {
        await h.post(`/api/workflow/definitions/${seedId}/activate`, { replaceActive: true });
        if (Number((await defRow(h, seedId))?.is_active) !== 1) wrong.push('the seed requisition workflow did not take its type back');
        await h.q(`UPDATE workflow_definitions SET is_active = 0 WHERE id = ANY($1::int[])`, [ids]);
      }
    });
  }

  if (shouldRun('sec_workflow_active_definition_health_td_1229', 'security', 'td1229', 'workflow', 'health')) {
    await runCase(results, {
      id: 'sec_workflow_active_definition_health_td_1229',
      name: 'v10.1.7: migration 0110 builds the one-active-workflow index and the health check lists record types with two active workflows (TD-1229)',
      details: 'the index exists in the test schema and the check is healthy; with the index dropped inside a rolled-back transaction and two active workflows of one type the check warns and names both',
    }, async (h, wrong) => {
      const { buildActiveDefinitionHealthTest, findDuplicateActiveDefinitions, hasActiveDefinitionUniqueIndex } = await import('../../services/accounting/workflowActiveDefinitionHealth.js');
      const { orm } = await import('../../db/drizzle.js');
      if (!(await hasActiveDefinitionUniqueIndex(orm))) wrong.push('the unique index uq_workflow_definitions_active_entity_type is missing');
      const clean = buildActiveDefinitionHealthTest(await findDuplicateActiveDefinitions(orm), true);
      if (clean.status !== 'healthy' || clean.count !== 0) wrong.push(`the clean check is ${clean.status} with ${clean.count}`);
      const type = `wfhc_${h.tag}`;
      const { sql } = await import('drizzle-orm');
      let dirty: ReturnType<typeof buildActiveDefinitionHealthTest> | undefined;
      const ROLLBACK = 'rollback-health-scenario';
      await orm.transaction(async (tx) => {
        await tx.execute(sql`DROP INDEX uq_workflow_definitions_active_entity_type`);
        await tx.execute(sql`INSERT INTO workflow_definitions (code, title, entity_type, version, is_active) VALUES (${`WFHC_A_${h.tag}`}, 'الف', ${type}, 1, 1), (${`WFHC_B_${h.tag}`}, 'ب', ${type}, 1, 1)`);
        dirty = buildActiveDefinitionHealthTest(await findDuplicateActiveDefinitions(tx), await hasActiveDefinitionUniqueIndex(tx));
        throw new Error(ROLLBACK);
      }).catch((err: unknown) => {
        if (!(err instanceof Error && err.message === ROLLBACK)) throw err;
      });
      if (dirty?.status !== 'warning' || dirty.count !== 1 || dirty.items?.length !== 2) wrong.push(`with two active workflows of one type the check is ${JSON.stringify({ status: dirty?.status, count: dirty?.count, items: dirty?.items?.length })}`);
      if (Number(dirty?.metrics?.uniqueIndexPresent) !== 0) wrong.push('the check did not see the dropped index');
      if (!(await hasActiveDefinitionUniqueIndex(orm))) wrong.push('the index did not come back after the rollback');
    });
  }

  return results;
}
