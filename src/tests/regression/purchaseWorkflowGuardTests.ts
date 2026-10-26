import request from 'supertest';
import { and, asc, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { purchaseRequisitions, workflowDefinitions, workflowInstances, workflowStates, workflowTransitions } from '../../db/schema.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { ensurePublishedSnapshot, publishedVersionOf } from '../../services/workflow/workflowSnapshot.js';
import { ensureRequisitionApproved } from '../../services/procurement/requisitionApproval.js';
import { upgradeLegacySeedGuards } from '../../services/workflow/seedGuardUpgrade.js';
import { PURCHASE_REQUISITION_GUARD_UPGRADE } from '../../services/workflow/purchaseWorkflowGuards.js';
import { buildUnguardedPurchaseActionHealthTest, findUnguardedPurchaseActions } from '../../services/accounting/unguardedPurchaseActionHealth.js';
import { buildUnknownPermissionActionHealthTest, findUnknownPermissionActions } from '../../services/accounting/workflowUnknownPermissionHealth.js';
import { createTestRole, createTestUser } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/**
 * Payroll duties plan PR 2 (v10.0.37 on, OBS-R2-36 of TD-992, decision t11 «الف»): the default purchase requisition
 * workflow asks a permission on every action and its creator does not approve it. Red on v10.0.27, where no action of
 * the seed had a role or a permission and the creator approved their own requisition.
 */

const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 220)}`;
const expect = (cond: boolean, message: string) => { if (!cond) throw new Error(message); };

async function clientWith(permissions: string[]) {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const role = await createTestRole({ permissions });
  const user = await createTestUser({ role: role.code });
  const s = await loginTestUserWithSession(app, user.username);
  return {
    userId: user.id,
    username: user.username,
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: unknown) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
  };
}

async function guardsOf(definitionId: number): Promise<Record<string, { perm: string; excluded: number }>> {
  const rows = await orm.select({
    actionKey: workflowTransitions.actionKey, perm: workflowTransitions.requiredPermission, excluded: workflowTransitions.isInitiatorExcluded,
  }).from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, definitionId));
  return Object.fromEntries(rows.map(r => [r.actionKey, { perm: r.perm ?? '', excluded: Number(r.excluded ?? 0) }]));
}

async function stepOf(requisitionId: number): Promise<string> {
  const [row] = await orm.select({ stateKey: workflowStates.stateKey })
    .from(purchaseRequisitions)
    .innerJoin(workflowInstances, eq(workflowInstances.id, purchaseRequisitions.workflowInstanceId))
    .innerJoin(workflowStates, eq(workflowStates.id, workflowInstances.currentStateId))
    .where(eq(purchaseRequisitions.id, requisitionId));
  return row?.stateKey ?? 'none';
}

export async function runPurchaseWorkflowGuardTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_purchase_workflow_guard_obs_r2_36', 'obs-r2-36', 'workflow')) {
    await runCase(results, 'reg_purchase_workflow_guard_obs_r2_36', 'OBS-R2-36: the purchase requisition workflow asks a permission on every action; an untouched old seed is upgraded once, an edited one is listed by the health check', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, 'PURCHASE_REQUISITION_WORKFLOW'));
      expect(!!def, 'purchase requisition workflow is not seeded');
      const seeded = await guardsOf(def.id);
      expect(seeded.approve_request?.perm === 'procurement.approve' && seeded.approve_request.excluded === 1
        && seeded.receive_items?.perm === 'warehouse.in' && seeded.reject_request?.perm === 'procurement.approve'
        && seeded.cancel_order?.perm === 'procurement.approve' && seeded.reopen?.perm === 'procurement.create', `new seed guards ${JSON.stringify(seeded)}`);
      expect((await findUnguardedPurchaseActions(orm)).length === 0, 'fresh seed is listed as unguarded');

      // back to the seed before v10.0.37, as an existing install holds it
      const toLegacy = () => orm.update(workflowTransitions).set({ requiredPermission: '', isInitiatorExcluded: 0 })
        .where(eq(workflowTransitions.workflowDefinitionId, def.id));
      await toLegacy();
      expect((await findUnguardedPurchaseActions(orm)).length === 5, 'legacy seed actions are not listed');
      expect(await upgradeLegacySeedGuards(PURCHASE_REQUISITION_GUARD_UPGRADE) === true, 'untouched old seed was not upgraded');
      const upgraded = await guardsOf(def.id);
      expect(upgraded.approve_request?.perm === 'procurement.approve' && upgraded.approve_request.excluded === 1
        && upgraded.receive_items?.perm === 'warehouse.in', `upgraded guards ${JSON.stringify(upgraded)}`);
      expect(await upgradeLegacySeedGuards(PURCHASE_REQUISITION_GUARD_UPGRADE) === false, 'second run changed the definition again');

      // an edited old definition is left alone and listed
      await toLegacy();
      await orm.update(workflowTransitions).set({ title: 'Edited by the admin' })
        .where(and(eq(workflowTransitions.workflowDefinitionId, def.id), eq(workflowTransitions.actionKey, 'reopen')));
      expect(await upgradeLegacySeedGuards(PURCHASE_REQUISITION_GUARD_UPGRADE) === false, 'edited definition was upgraded');
      expect((await guardsOf(def.id)).approve_request?.perm === '', 'edited definition guards changed');
      const health = buildUnguardedPurchaseActionHealthTest(await findUnguardedPurchaseActions(orm));
      expect(health.status === 'warning' && health.count === 5, `health check ${health.status} / ${health.count}`);
      return 'seed guards every action; upgrade runs once and only on the untouched old seed; an edited one is listed';
    }));
  }

  if (shouldRun('reg_workflow_unknown_permission_health', 'workflow', 'permission', 'health')) {
    await runCase(results, 'reg_workflow_unknown_permission_health', 'Closing sweep (#304 review): an active workflow action whose permission is no longer a catalog key (audit.create, removed by 0123) is listed by the health check, in the step tables and in the published version', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const [def] = await orm.select().from(workflowDefinitions).where(eq(workflowDefinitions.code, 'PURCHASE_REQUISITION_WORKFLOW'));
      expect(!!def, 'purchase requisition workflow is not seeded');
      expect((await findUnknownPermissionActions(orm)).length === 0, 'fresh seed is listed with an unknown permission');

      const reopen = and(eq(workflowTransitions.workflowDefinitionId, def.id), eq(workflowTransitions.actionKey, 'reopen'));
      await orm.update(workflowTransitions).set({ requiredPermission: 'audit.create' }).where(reopen);
      const live = await findUnknownPermissionActions(orm);
      expect(live.length === 1 && live[0].requiredPermission === 'audit.create' && live[0].definitionId === def.id, `step tables: ${JSON.stringify(live)}`);
      const health = buildUnknownPermissionActionHealthTest(live);
      expect(health.status === 'warning' && health.count === 1, `health check ${health.status} / ${health.count}`);

      // the step tables are fixed again, but the published version still holds the removed key
      await orm.update(workflowTransitions).set({ requiredPermission: 'procurement.create' }).where(reopen);
      await pool.query(`UPDATE workflow_definition_versions v
        SET dsl_json = jsonb_set(v.dsl_json, '{transitions}', (SELECT jsonb_agg(CASE WHEN t ->> 'actionKey' = 'reopen'
          THEN jsonb_set(t, '{requiredPermission}', '"audit.create"') ELSE t END) FROM jsonb_array_elements(v.dsl_json -> 'transitions') t))
        WHERE v.definition_id = $1 AND v.status = 'published'`, [def.id]);
      const published = await findUnknownPermissionActions(orm);
      expect(published.length === 1 && published[0].requiredPermission === 'audit.create', `published version: ${JSON.stringify(published)}`);
      return 'an action with a removed permission is listed from the step tables and from the published version';
    }));
  }

  if (shouldRun('reg_purchase_initiator_excluded_obs_r2_36', 'obs-r2-36', 'workflow')) {
    await runCase(results, 'reg_purchase_initiator_excluded_obs_r2_36', 'OBS-R2-36: the creator of a purchase requisition does not approve it; another approver does', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const keys = ['procurement.view', 'procurement.create', 'procurement.approve'];
      const maker = await clientWith(keys);
      const checker = await clientWith(keys);
      const created = await maker.post('/api/procurement/requisitions', {
        title: 'Duties test requisition', priority: 'normal',
        items: [{ itemName: 'Duties test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
      });
      expect(created.status === 201, `requisition create returned ${brief(created)}`);
      const id = Number(created.body?.data?.id);
      expect(await stepOf(id) === 'pending', 'requisition did not start in the pending step');

      const own = await maker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(own.status === 403 && own.body?.code === 'WF_INITIATOR_EXCLUDED', `creator approving own requisition returned ${brief(own)}`);
      expect(await stepOf(id) === 'pending', 'refused approval moved the requisition');

      const other = await checker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(other.status === 200, `another approver returned ${brief(other)}`);
      expect(await stepOf(id) === 'ordered', 'approval by another user did not reach the ordered step');
      return 'creator refused with WF_INITIATOR_EXCLUDED; another holder of procurement.approve approved';
    }));
  }

  if (shouldRun('reg_split_button_initiator_v11_6_3a_u10', 'u10', 'workflow', 'procurement')) {
    await runCase(results, 'reg_split_button_initiator_v11_6_3a_u10', 'v11 phase 6.3a (U10): the requisition list marks an open requisition its viewer started and may not approve, for that viewer only and only until it is approved', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const keys = ['procurement.view', 'procurement.create', 'procurement.approve', 'procurement.order'];
      const maker = await clientWith(keys);
      const checker = await clientWith(keys);
      const created = await maker.post('/api/procurement/requisitions', {
        title: 'Split button initiator test', priority: 'normal',
        items: [{ itemName: 'Split button test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
      });
      expect(created.status === 201, `requisition create returned ${brief(created)}`);
      const id = Number(created.body?.data?.id);
      const markOf = async (client: typeof maker) => {
        const res = await client.get('/api/procurement/requisitions?search=Split%20button%20initiator&limit=50');
        expect(res.status === 200, `requisition list returned ${brief(res)}`);
        const row = (Array.isArray(res.body?.data) ? res.body.data : []).find((r: { id: number }) => Number(r.id) === id);
        expect(Boolean(row), `requisition ${id} missing from the list: ${brief(res)}`);
        return row.initiatorCannotApprove === true;
      };
      expect(await markOf(maker), 'the list does not mark the open requisition for its creator');
      expect(!(await markOf(checker)), 'the list marks the requisition for another approver');

      const approved = await checker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(approved.status === 200, `another approver returned ${brief(approved)}`);
      expect(!(await markOf(maker)), 'the list still marks the requisition for its creator after another user approved it');
      return 'marked for the creator while open, not for another approver, not after approval';
    }));
  }

  if (shouldRun('reg_lazy_requisition_instance_requester_v11_6_3a_u10', 'u10', 'workflow', 'procurement')) {
    await runCase(results, 'reg_lazy_requisition_instance_requester_v11_6_3a_u10', 'v11 phase 6.3a (reviews of #406, U10): a requisition without a workflow instance is marked for its requester in the list and the window, its own approval is refused, and an approval by another user (by action or by convert) starts the instance in the requester\'s name and goes through', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const keys = ['procurement.view', 'procurement.create', 'procurement.approve', 'procurement.order'];
      const maker = await clientWith(keys);
      // the checker also holds `workflow.approve`, so the first step's task notice is meant for them
      const checker = await clientWith([...keys, 'workflow.approve']);
      // another approver who would see the first step's task in their inbox
      const bystander = await clientWith([...keys, 'workflow.approve']);
      // an older requisition, or one whose workflow failed to start at registration, has no instance
      const withoutInstance = async (title: string) => {
        const created = await maker.post('/api/procurement/requisitions', {
          title, priority: 'normal',
          items: [{ itemName: 'Lazy instance test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
        });
        expect(created.status === 201, `requisition create returned ${brief(created)}`);
        const createdId = Number(created.body?.data?.id);
        const [row] = await orm.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, createdId));
        await orm.update(workflowInstances).set({ status: 'TERMINATED' }).where(eq(workflowInstances.id, Number(row.workflowInstanceId)));
        await orm.update(purchaseRequisitions).set({ workflowInstanceId: null }).where(eq(purchaseRequisitions.id, createdId));
        return { id: createdId, code: String(row.code) };
      };
      const { id } = await withoutInstance('Lazy instance requester test');

      const markOf = async (client: typeof maker) => {
        const res = await client.get('/api/procurement/requisitions?search=Lazy%20instance%20requester&limit=50');
        expect(res.status === 200, `requisition list returned ${brief(res)}`);
        const listed = (Array.isArray(res.body?.data) ? res.body.data : []).find((r: { id: number }) => Number(r.id) === id);
        expect(Boolean(listed), `requisition ${id} missing from the list: ${brief(res)}`);
        return listed.initiatorCannotApprove === true;
      };
      expect(await markOf(maker), 'the list does not mark the requisition without an instance for its requester');
      expect(!(await markOf(checker)), 'the list marks the requisition without an instance for another approver');
      // review 3 of #406: the requisition window reads the requisition again and carries the same mark
      const detailMarkOf = async (client: typeof maker) => (await client.get(`/api/procurement/requisitions/${id}`)).body?.data?.initiatorCannotApprove === true;
      expect(await detailMarkOf(maker), 'the requisition window does not mark the requisition for its requester');
      expect(!(await detailMarkOf(checker)), 'the requisition window marks the requisition for another approver');

      // the requester's own approval is refused and starts nothing
      const own = await maker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(own.status === 403 && own.body?.code === 'WF_INITIATOR_EXCLUDED', `the requester's own approval returned ${brief(own)}`);
      expect(await stepOf(id) === 'none', 'the refused approval left a workflow instance');

      // the approve button of the desk and the requisition window (workflow-action), with no instance started before it;
      // the approver who starts it is not told of the task they finish in the same step
      const taskNotices = async () => Promise.all([checker, bystander, maker].map(async client =>
        Number((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'task'`, [client.userId])).rows[0]?.n ?? 0)));
      const tasksBefore = (await taskNotices()).join(',');
      const approved = await checker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(approved.status === 200, `another approver returned ${brief(approved)}`);
      const startedByOf = async (requisitionId: number) => (await orm.select({ startedBy: workflowInstances.startedBy }).from(purchaseRequisitions)
        .innerJoin(workflowInstances, eq(workflowInstances.id, purchaseRequisitions.workflowInstanceId))
        .where(eq(purchaseRequisitions.id, requisitionId)))[0]?.startedBy;
      expect(await startedByOf(id) === maker.userId, `the missing instance was started by user ${await startedByOf(id)}, expected the requester ${maker.userId}`);
      expect(await stepOf(id) === 'ordered', 'approval by another user did not reach the ordered step');
      const tasksAfter = (await taskNotices()).join(',');
      expect(tasksAfter === tasksBefore, `the start of the instance announced the task the approval finished (approver, other approver, requester notices ${tasksBefore} -> ${tasksAfter})`);

      // the split and convert path (`ensureRequisitionApproved`) starts a missing instance the same way
      const second = await withoutInstance('Lazy instance requester convert test');
      await orm.transaction(tx => ensureRequisitionApproved(tx, { ...second, workflowInstanceId: null, requestedById: maker.userId },
        { id: checker.userId, username: checker.username, permissions: keys }, { mayApprove: true, comment: 'Lazy instance convert test' }));
      expect(await startedByOf(second.id) === maker.userId, `the convert path started the instance as user ${await startedByOf(second.id)}, expected the requester ${maker.userId}`);
      expect(await stepOf(second.id) === 'ordered', 'the convert path did not approve the requisition');
      return 'marked for the requester only, in the list and the window; the requester\'s own approval 403 with no instance; another approver approved it (by action and by convert), the instance names the requester and nobody is told of the finished first step';
    }));
  }

  if (shouldRun('reg_lazy_requisition_start_notice_quorum_v11_6_3a_u10', 'u10', 'workflow', 'procurement', 'notice')) {
    await runCase(results, 'reg_lazy_requisition_start_notice_quorum_v11_6_3a_u10', 'v11 phase 6.3a (review 5 of #406, U10): when the approval that starts a missing workflow instance leaves the first step open (it wants two signatures), the held notice of that step reaches the other approver, not the approver who signed', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const [definition] = await orm.select().from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.entityType, 'purchase_requisition'), eq(workflowDefinitions.isActive, 1)))
        .orderBy(asc(workflowDefinitions.id)).limit(1);
      expect(Boolean(definition), 'no active purchase requisition workflow');
      // the approval of the first step wants two signatures, in the step tables and in a published version made from them
      await orm.update(workflowTransitions).set({ approvalRuleType: 'K_OF_N', kValue: 2 })
        .where(and(eq(workflowTransitions.workflowDefinitionId, definition.id), eq(workflowTransitions.actionKey, 'approve_request')));
      await pool.query(`UPDATE workflow_definition_versions v
        SET dsl_json = jsonb_set(v.dsl_json, '{transitions}', (SELECT jsonb_agg(CASE WHEN t ->> 'actionKey' = 'approve_request'
          THEN t || '{"approvalRuleType": "K_OF_N", "kValue": 2}'::jsonb ELSE t END) FROM jsonb_array_elements(v.dsl_json -> 'transitions') t))
        WHERE v.definition_id = $1 AND v.status = 'published'`, [definition.id]);

      const keys = ['procurement.view', 'procurement.create', 'procurement.approve', 'procurement.order'];
      const maker = await clientWith(keys);
      const checker = await clientWith([...keys, 'workflow.approve']);
      const otherApprover = await clientWith([...keys, 'workflow.approve']);
      const created = await maker.post('/api/procurement/requisitions', {
        title: 'Lazy instance quorum notice test', priority: 'normal',
        items: [{ itemName: 'Quorum notice test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
      });
      expect(created.status === 201, `requisition create returned ${brief(created)}`);
      const id = Number(created.body?.data?.id);
      const [row] = await orm.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
      await orm.update(workflowInstances).set({ status: 'TERMINATED' }).where(eq(workflowInstances.id, Number(row.workflowInstanceId)));
      await orm.update(purchaseRequisitions).set({ workflowInstanceId: null }).where(eq(purchaseRequisitions.id, id));

      const taskNotices = async () => Promise.all([checker, otherApprover, maker].map(async client =>
        Number((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'task'`, [client.userId])).rows[0]?.n ?? 0)));
      const [checkerBefore, otherBefore, makerBefore] = await taskNotices();
      const signed = await checker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(signed.status === 200, `the first signature returned ${brief(signed)}`);
      expect(await stepOf(id) === 'pending', 'the first of two signatures moved the requisition on');
      const [checkerAfter, otherAfter, makerAfter] = await taskNotices();
      expect(otherAfter === otherBefore + 1, `the other approver got ${otherAfter - otherBefore} notices of the open first step, expected 1`);
      expect(checkerAfter === checkerBefore, `the approver who signed got ${checkerAfter - checkerBefore} notices of the step they signed`);
      expect(makerAfter === makerBefore, `the requester got ${makerAfter - makerBefore} task notices`);
      return 'first of two signatures: step still open, the other approver told once, the signer and the requester not';
    }));
  }

  if (shouldRun('reg_requisition_relink_open_instance_no_notice_v11_6_3a_u10', 'u10', 'workflow', 'procurement', 'notice')) {
    await runCase(results, 'reg_requisition_relink_open_instance_no_notice_v11_6_3a_u10', 'v11 phase 6.3a (review 6 of #406, U10): a requisition that lost only its link to an instance still in progress is linked to that instance again on an approval, and nobody is told again of a step they were told of when it started', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const [definition] = await orm.select().from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.entityType, 'purchase_requisition'), eq(workflowDefinitions.isActive, 1)))
        .orderBy(asc(workflowDefinitions.id)).limit(1);
      expect(Boolean(definition), 'no active purchase requisition workflow');
      // two signatures, so the step stays open after the first and a held notice would show
      await orm.update(workflowTransitions).set({ approvalRuleType: 'K_OF_N', kValue: 2 })
        .where(and(eq(workflowTransitions.workflowDefinitionId, definition.id), eq(workflowTransitions.actionKey, 'approve_request')));
      await pool.query(`UPDATE workflow_definition_versions v
        SET dsl_json = jsonb_set(v.dsl_json, '{transitions}', (SELECT jsonb_agg(CASE WHEN t ->> 'actionKey' = 'approve_request'
          THEN t || '{"approvalRuleType": "K_OF_N", "kValue": 2}'::jsonb ELSE t END) FROM jsonb_array_elements(v.dsl_json -> 'transitions') t))
        WHERE v.definition_id = $1 AND v.status = 'published'`, [definition.id]);

      const keys = ['procurement.view', 'procurement.create', 'procurement.approve', 'procurement.order'];
      const maker = await clientWith(keys);
      const checker = await clientWith([...keys, 'workflow.approve']);
      const otherApprover = await clientWith([...keys, 'workflow.approve']);
      const created = await maker.post('/api/procurement/requisitions', {
        title: 'Relink open instance notice test', priority: 'normal',
        items: [{ itemName: 'Relink notice test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
      });
      expect(created.status === 201, `requisition create returned ${brief(created)}`);
      const id = Number(created.body?.data?.id);
      const [row] = await orm.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
      const openInstanceId = Number(row.workflowInstanceId);
      expect(openInstanceId > 0, 'the requisition started with no workflow instance');
      // only the link is lost; the instance stays in progress
      await orm.update(purchaseRequisitions).set({ workflowInstanceId: null }).where(eq(purchaseRequisitions.id, id));

      const taskNotices = async () => Promise.all([checker, otherApprover, maker].map(async client =>
        Number((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'task'`, [client.userId])).rows[0]?.n ?? 0)));
      const [checkerBefore, otherBefore, makerBefore] = await taskNotices();
      const signed = await checker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(signed.status === 200, `the first signature returned ${brief(signed)}`);
      expect(await stepOf(id) === 'pending', 'the first of two signatures moved the requisition on');
      const [after] = await orm.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
      expect(Number(after.workflowInstanceId) === openInstanceId, `the requisition was linked to instance ${after.workflowInstanceId}, expected the open ${openInstanceId}`);
      const [checkerAfter, otherAfter, makerAfter] = await taskNotices();
      expect(otherAfter === otherBefore, `the other approver got ${otherAfter - otherBefore} notices of a step they were told of at the start, expected 0`);
      expect(checkerAfter === checkerBefore, `the approver who signed got ${checkerAfter - checkerBefore} notices`);
      expect(makerAfter === makerBefore, `the requester got ${makerAfter - makerBefore} task notices`);
      return 'link lost, instance open: linked again to the same instance, no second notice to anyone';
    }));
  }

  if (shouldRun('reg_requisition_mark_published_design_v11_6_3a_u10', 'u10', 'workflow', 'procurement')) {
    await runCase(results, 'reg_requisition_mark_published_design_v11_6_3a_u10', 'v11 phase 6.3a (review 4 of #406, U10): the initiator mark of a requisition without a workflow instance follows the published design, as its start does, not a draft saved in the designer', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const keys = ['procurement.view', 'procurement.create', 'procurement.approve', 'procurement.order'];
      const maker = await clientWith(keys);
      const [definition] = await orm.select().from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.entityType, 'purchase_requisition'), eq(workflowDefinitions.isActive, 1)))
        .orderBy(asc(workflowDefinitions.id)).limit(1);
      expect(Boolean(definition), 'no active purchase requisition workflow');
      // the designer saves a draft that lets the initiator approve: the step tables change, the published version stays
      await ensurePublishedSnapshot(orm, definition.id, { title: definition.title });
      const published = publishedVersionOf(definition);
      await orm.update(workflowDefinitions).set({ publishedVersion: published, version: published + 1 }).where(eq(workflowDefinitions.id, definition.id));
      await orm.update(workflowTransitions).set({ isInitiatorExcluded: 0 }).where(eq(workflowTransitions.workflowDefinitionId, definition.id));

      const created = await maker.post('/api/procurement/requisitions', {
        title: 'Published design mark test', priority: 'normal',
        items: [{ itemName: 'Published design test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
      });
      expect(created.status === 201, `requisition create returned ${brief(created)}`);
      const id = Number(created.body?.data?.id);
      const [row] = await orm.select().from(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
      await orm.update(workflowInstances).set({ status: 'TERMINATED' }).where(eq(workflowInstances.id, Number(row.workflowInstanceId)));
      await orm.update(purchaseRequisitions).set({ workflowInstanceId: null }).where(eq(purchaseRequisitions.id, id));

      const detail = await maker.get(`/api/procurement/requisitions/${id}`);
      expect(detail.body?.data?.initiatorCannotApprove === true, `the window mark read the draft: ${brief(detail)}`);
      const own = await maker.post(`/api/procurement/requisitions/${id}/workflow-action`, { actionKey: 'approve_request' });
      expect(own.status === 403 && own.body?.code === 'WF_INITIATOR_EXCLUDED', `the requester's own approval returned ${brief(own)}`);
      return 'with a draft that lets the initiator approve, the mark and the start both follow the published design: marked, own approval 403';
    }));
  }

  if (shouldRun('reg_requisition_workflow_actions_obs_r2_38', 'obs-r2-38', 'workflow', 'procurement')) {
    await runCase(results, 'reg_requisition_workflow_actions_obs_r2_38', 'OBS-R2-38: the requisition window reads the actions this user may run in the current step; the creator is not offered the approval', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const keys = ['procurement.view', 'procurement.create', 'procurement.approve'];
      const maker = await clientWith(keys);
      const checker = await clientWith(keys);
      const reader = await clientWith(['procurement.view']);
      const created = await maker.post('/api/procurement/requisitions', {
        title: 'Duties test actions', priority: 'normal',
        items: [{ itemName: 'Duties test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
      });
      expect(created.status === 201, `requisition create returned ${brief(created)}`);
      const id = Number(created.body?.data?.id);
      const keysOf = (res: request.Response) => (Array.isArray(res.body?.data?.actions) ? res.body.data.actions : []).map((a: { actionKey: string }) => a.actionKey).sort().join(',');

      const own = await maker.get(`/api/procurement/requisitions/${id}/workflow-actions`);
      expect(own.status === 200 && own.body?.data?.hasInstance === true, `creator read returned ${brief(own)}`);
      expect(keysOf(own) === 'reject_request', `creator is offered ${keysOf(own)}`);
      const other = await checker.get(`/api/procurement/requisitions/${id}/workflow-actions`);
      expect(keysOf(other) === 'approve_request,reject_request', `another approver is offered ${keysOf(other)}`);
      // a reader without workflow keys reads the list too (the window asks it), and is offered nothing
      const plain = await reader.get(`/api/procurement/requisitions/${id}/workflow-actions`);
      expect(plain.status === 200 && keysOf(plain) === '', `reader returned ${brief(plain)}`);
      return 'creator offered reject only; another approver approve and reject; a plain reader nothing';
    }));
  }

  if (shouldRun('reg_procurement_manage_not_approver_td_1126', 'td-1126', 'obs-r2-36', 'workflow', 'procurement')) {
    await runCase(results, 'reg_procurement_manage_not_approver_td_1126', 'TD-1126: procurement.manage does not approve a requisition on convert; only procurement.approve runs the approval, else 409 REQUISITION_NOT_APPROVED', () => inFiscalSandbox(async () => {
      await WorkflowEngineService.seedDefaultWorkflows();
      const maker = await clientWith(['procurement.view', 'procurement.create']);
      const manager = await clientWith(['procurement.view', 'procurement.order', 'procurement.manage']);
      const created = await maker.post('/api/procurement/requisitions', {
        title: 'Duties test manager convert', priority: 'normal',
        items: [{ itemName: 'Duties test service', unit: 'عدد', requestedQty: 1, unitPriceEstimate: 1000 }],
      });
      expect(created.status === 201, `requisition create returned ${brief(created)}`);
      const id = Number(created.body?.data?.id);
      const converted = await manager.post(`/api/procurement/requisitions/${id}/convert-to-orders`, {
        orderGroups: [{ supplierName: 'Duties test supplier', docType: 'receipt', status: 'draft', items: [{ itemId: 1, quantity: 1, unitPrice: 1000 }] }],
      });
      expect(converted.status === 409 && converted.body?.code === 'REQUISITION_NOT_APPROVED', `manager converting a pending requisition returned ${brief(converted)}`);
      expect(await stepOf(id) === 'pending', 'refused convert moved the requisition');
      return 'a procurement.manage holder without procurement.approve gets REQUISITION_NOT_APPROVED, not a refused self-approval';
    }));
  }

  return results;
}
