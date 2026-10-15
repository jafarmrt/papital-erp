import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVouchers, workflowInstances } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { createTestRole, createTestUser } from '../fixtures/factories.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v10.1.11 (TD-1263, D-06 part B, decision ت۶ «خودکار»): a manual draft voucher enters the active journal voucher workflow
 * in its create transaction, and while that workflow runs the voucher page does not approve, finalize or revert it (409
 * VOUCHER_IN_WORKFLOW; a batch leaves it out with the reason); the workflow's own steps still do. Red on v10.1.7, where a
 * manual voucher started no workflow and the page changed its status freely.
 */

const brief = (res: request.Response) => `${res.status} ${JSON.stringify(res.body ?? {}).slice(0, 220)}`;
const expect = (cond: boolean, message: string) => { if (!cond) throw new Error(message); };

async function voucherInstance(voucherId: number) {
  const [row] = await orm.select().from(workflowInstances)
    .where(and(eq(workflowInstances.entityType, 'journal_voucher'), eq(workflowInstances.entityId, String(voucherId))));
  return row;
}

async function statusOf(id: number): Promise<string> {
  const [row] = await orm.select({ status: journalVouchers.status }).from(journalVouchers).where(eq(journalVouchers.id, id));
  return row?.status ?? 'missing';
}

/** The transition of the instance's current step with this action key, from the instance's own snapshot */
function transitionId(instance: Awaited<ReturnType<typeof voucherInstance>>, actionKey: string): number {
  const transitions = ((instance?.snapshotDsl as { transitions?: Array<Record<string, unknown>> } | null)?.transitions ?? []);
  const found = transitions.find(t => t.actionKey === actionKey && t.fromStateId === instance?.currentStateId);
  return Number(found?.id ?? 0);
}

/** A logged-in user whose role holds exactly these permissions (inside the sandbox) */
async function clientWith(permissions: string[]) {
  const { getTestApp, loginTestUserWithSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const role = await createTestRole({ permissions });
  const user = await createTestUser({ role: role.code });
  const s = await loginTestUserWithSession(app, user.username);
  return {
    userId: user.id,
    get: (url: string) => request(app).get(url).set('Cookie', s.cookie),
    post: (url: string, body: unknown) => request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
    put: (url: string, body: unknown) => request(app).put(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).send(body as object),
  };
}

const RECORD = ['accounting.view', 'accounting.vouchers', 'workflow.approve'];
const APPROVE = [...RECORD, 'accounting.vouchers_approve'];

export async function runVoucherWorkflowStartTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  if (shouldRun('reg_manual_voucher_workflow_start_td_1263', 'td-1263', 'd-06', 'voucher_workflow')) {
    await runCase(results, 'reg_manual_voucher_workflow_start_td_1263', 'TD-1263: a manual draft voucher enters the active journal voucher workflow on create; the voucher page does not approve, finalize or revert it while it runs', () => inFiscalSandbox(async () => {
      await WorkflowDefinitionService.seedDefaultWorkflows();
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('7001', '1001');
      const date = await businessTodayIsoDate();
      const created = await admin.post('/api/accounting/vouchers', {
        date, description: 'Workflow start test voucher',
        items: [{ accountId: acc['7001'], debit: 1000, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 1000 }],
      });
      expect(created.status === 201, `voucher create returned ${brief(created)}`);
      const id = Number(created.body.id);

      const instance = await voucherInstance(id);
      expect(instance?.status === 'IN_PROGRESS', `manual draft voucher got workflow instance ${JSON.stringify(instance?.status ?? null)}, not a running one`);
      const read = await admin.get(`/api/accounting/vouchers/${id}`);
      expect(read.body?.inWorkflow === true, `voucher read did not say it is in its workflow: ${brief(read)}`);

      for (const [label, res] of [
        ['status approved', await admin.put(`/api/accounting/vouchers/${id}/status`, { status: 'approved' })],
        ['finalize', await admin.post(`/api/accounting/vouchers/${id}/finalize`, {})],
      ] as const) {
        expect(res.status === 409 && res.body?.code === 'VOUCHER_IN_WORKFLOW', `${label} of a voucher in its workflow returned ${brief(res)}`);
      }
      const batch = await admin.post('/api/accounting/vouchers/batch-approve', { ids: [id] });
      expect(batch.status === 200 && batch.body?.approvedCount === 0 && batch.body?.refused?.length === 1, `batch approve returned ${brief(batch)}`);
      const batchFin = await admin.post('/api/accounting/vouchers/batch-finalize', { ids: [id] });
      expect(batchFin.status === 200 && batchFin.body?.finalizedCount === 0, `batch finalize returned ${brief(batchFin)}`);
      expect(await statusOf(id) === 'draft', `voucher left draft from the page: ${await statusOf(id)}`);

      // the workflow's own step approves it
      const step = await admin.post('/api/workflow/transition', { instanceId: instance.id, transitionId: transitionId(instance, 'approve_voucher') });
      expect(step.status === 200, `workflow approve returned ${brief(step)}`);
      expect(await statusOf(id) === 'approved', `workflow approve left the voucher ${await statusOf(id)}`);
      const revert = await admin.put(`/api/accounting/vouchers/${id}/status`, { status: 'draft' });
      expect(revert.status === 409 && revert.body?.code === 'VOUCHER_IN_WORKFLOW', `page revert to draft returned ${brief(revert)}`);

      // reversing it, or correcting another one, closes its workflow
      const reversed = await admin.post(`/api/accounting/vouchers/${id}/reverse`, { reason: 'Workflow close test' });
      expect(reversed.status < 300, `reverse returned ${brief(reversed)}`);
      expect((await voucherInstance(id))?.status === 'TERMINATED', `reversing left the workflow ${String((await voucherInstance(id))?.status)}`);
      const afterReverse = await admin.get(`/api/accounting/vouchers/${id}`);
      expect(afterReverse.body?.inWorkflow === false, `reversed voucher still shows in its workflow: ${brief(afterReverse)}`);
      const second = await admin.post('/api/accounting/vouchers', {
        date, description: 'Workflow correction test voucher',
        items: [{ accountId: acc['7001'], debit: 700, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 700 }],
      });
      const secondId = Number(second.body?.id);
      const secondInstance = await voucherInstance(secondId);
      const secondStep = await admin.post('/api/workflow/transition', { instanceId: secondInstance?.id, transitionId: transitionId(secondInstance, 'approve_voucher') });
      expect(secondStep.status === 200, `second workflow approve returned ${brief(secondStep)}`);
      const corrected = await admin.post(`/api/accounting/vouchers/${secondId}/correct`, {
        reason: 'Workflow close test', newItems: [{ accountId: acc['7001'], debit: 800, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 800 }],
      });
      expect(corrected.status < 300, `correct returned ${brief(corrected)}`);
      expect((await voucherInstance(secondId))?.status === 'TERMINATED', `correcting left the workflow ${String((await voucherInstance(secondId))?.status)}`);

      // an automatic voucher (not manual) never starts one
      const automaticId = await VoucherService.createJournalVoucher({
        date, description: 'Automatic voucher', status: 'draft',
        items: [{ accountId: acc['7001'], debit: 500, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 500 }],
      } as Parameters<typeof VoucherService.createJournalVoucher>[0]);
      expect(!(await voucherInstance(Number(automaticId))), 'an automatic draft voucher started a workflow');
      return 'manual draft starts the workflow; page approve, finalize, batch and revert refused while it runs; the workflow step approves; reverse and correct close it';
    }));
  }

  if (shouldRun('reg_voucher_deputy_maker_td_1268', 'td-1268', 'td-1265', 'd-06', 'voucher_workflow', 'delegation', 'maker')) {
    await runCase(results, 'reg_voucher_deputy_maker_td_1268', 'TD-1268 / TD-1265: a deputy signing in the maker\'s name does not approve the maker\'s voucher; another approver\'s deputy does; a closed voucher workflow leaves the voucher draft and the page keeps the maker rule and the approve key', () => inFiscalSandbox(async () => {
      await WorkflowDefinitionService.seedDefaultWorkflows();
      const admin = await sandboxAdminClient();
      const acc = await accountIdsByCode('7001', '1001');
      const date = await businessTodayIsoDate();
      const maker = await clientWith(APPROVE);
      const checker = await clientWith(APPROVE);
      const deputy = await clientWith(['workflow.approve']);
      const recorder = await clientWith(RECORD);
      const draftBy = async (api: Awaited<ReturnType<typeof clientWith>>, amount: number) => {
        const res = await api.post('/api/accounting/vouchers', {
          date, description: `Deputy maker test ${amount}`,
          items: [{ accountId: acc['7001'], debit: amount, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: amount }],
        });
        expect(res.status === 201, `voucher create returned ${brief(res)}`);
        const id = Number(res.body.id);
        const instance = await voucherInstance(id);
        expect(instance?.status === 'IN_PROGRESS', `manual voucher ${id} did not enter its workflow`);
        return { id, instance };
      };
      const end = new Date(Date.parse(`${date}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);

      // the maker delegates to a deputy who holds no voucher key: the deputy signs in the maker's name, so it is the maker approving
      const own = await draftBy(maker, 1100);
      const given = await maker.post('/api/workflow/delegations', { toUserId: deputy.userId, scope: 'ALL', startDate: date, endDate: end, reason: 'Deputy maker test' });
      expect(given.status === 200, `maker delegation returned ${brief(given)}`);
      const byDeputy = await deputy.post('/api/workflow/transition', { instanceId: own.instance.id, transitionId: transitionId(own.instance, 'approve_voucher') });
      expect(byDeputy.status === 403 && byDeputy.body?.code === 'VOUCHER_MAKER_CANNOT_APPROVE', `the maker's deputy approving the maker's voucher returned ${brief(byDeputy)}`);
      expect(await statusOf(own.id) === 'draft', `the maker's voucher left draft through the deputy: ${await statusOf(own.id)}`);
      const revoked = await maker.post(`/api/workflow/delegations/${Number(given.body?.data?.id)}/revoke`, {});
      expect(revoked.status === 200, `revoking the maker's delegation returned ${brief(revoked)}`);

      // another approver's deputy signs in that approver's name and approves
      const toChecker = await checker.post('/api/workflow/delegations', { toUserId: deputy.userId, scope: 'ALL', startDate: date, endDate: end, reason: 'Deputy checker test' });
      expect(toChecker.status === 200, `checker delegation returned ${brief(toChecker)}`);
      const forChecker = await deputy.post('/api/workflow/transition', { instanceId: own.instance.id, transitionId: transitionId(own.instance, 'approve_voucher') });
      expect(forChecker.status === 200, `the checker's deputy approving returned ${brief(forChecker)}`);
      expect(await statusOf(own.id) === 'approved', `the checker's deputy left the voucher ${await statusOf(own.id)}`);

      // «بستن فرایند» touches only the workflow rows: the voucher stays draft, and the page then keeps every check
      const stuck = await draftBy(maker, 1200);
      const closed = await admin.post(`/api/workflow/instances/${stuck.instance.id}/terminate`, { reason: 'Approve step has no signer' });
      expect(closed.status === 200, `closing the voucher workflow returned ${brief(closed)}`);
      expect(await statusOf(stuck.id) === 'draft', `closing the workflow changed the voucher to ${await statusOf(stuck.id)}`);
      const read = await admin.get(`/api/accounting/vouchers/${stuck.id}`);
      expect(read.body?.inWorkflow === false, `a voucher whose workflow was closed still shows in its workflow: ${brief(read)}`);
      const byMaker = await maker.put(`/api/accounting/vouchers/${stuck.id}/status`, { status: 'approved' });
      expect(byMaker.status === 403 && byMaker.body?.code === 'VOUCHER_MAKER_CANNOT_APPROVE', `the maker approving after the close returned ${brief(byMaker)}`);
      const byRecorder = await recorder.put(`/api/accounting/vouchers/${stuck.id}/status`, { status: 'approved' });
      expect(byRecorder.status === 403, `approving without accounting.vouchers_approve after the close returned ${brief(byRecorder)}`);
      expect(await statusOf(stuck.id) === 'draft', `the refused approvals changed the voucher to ${await statusOf(stuck.id)}`);
      const byChecker = await checker.put(`/api/accounting/vouchers/${stuck.id}/status`, { status: 'approved' });
      expect(byChecker.status === 200 && await statusOf(stuck.id) === 'approved', `another approver after the close returned ${brief(byChecker)}`);
      return 'the maker\'s deputy is refused, another approver\'s deputy approves; after a close the voucher stays draft and the page keeps the maker rule and the approve key';
    }));
  }

  return results;
}
