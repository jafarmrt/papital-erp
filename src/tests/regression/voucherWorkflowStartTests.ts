import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVouchers, workflowInstances } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { VoucherService } from '../../services/accounting/voucher.service.js';
import { WorkflowDefinitionService } from '../../services/workflow/workflowDefinitionService.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, accountIdsByCode, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v10.1.10 (TD-1263, D-06 part B, decision ت۶ «خودکار»): a manual draft voucher enters the active journal voucher workflow
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

      // an automatic voucher (not manual) never starts one
      const automaticId = await VoucherService.createJournalVoucher({
        date, description: 'Automatic voucher', status: 'draft',
        items: [{ accountId: acc['7001'], debit: 500, credit: 0 }, { accountId: acc['1001'], debit: 0, credit: 500 }],
      } as Parameters<typeof VoucherService.createJournalVoucher>[0]);
      expect(!(await voucherInstance(Number(automaticId))), 'an automatic draft voucher started a workflow');
      return 'manual draft starts the workflow; page approve, finalize, batch and revert refused while it runs; the workflow step approves';
    }));
  }

  return results;
}
