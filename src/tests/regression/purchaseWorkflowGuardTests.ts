import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { purchaseRequisitions, workflowDefinitions, workflowInstances, workflowStates, workflowTransitions } from '../../db/schema.js';
import { WorkflowEngineService } from '../../services/workflow/workflowEngineService.js';
import { upgradeLegacySeedGuards } from '../../services/workflow/seedGuardUpgrade.js';
import { PURCHASE_REQUISITION_GUARD_UPGRADE } from '../../services/workflow/purchaseWorkflowGuards.js';
import { buildUnguardedPurchaseActionHealthTest, findUnguardedPurchaseActions } from '../../services/accounting/unguardedPurchaseActionHealth.js';
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
