import { and, eq } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { workflowInstances } from '../../db/schema.js';
import { WorkflowTransitionExecutor } from '../../services/workflow/workflowTransitionExecutor.js';
import { TestCaseResult } from '../types.js';
import { brief, client, errorCode, openingVouchersOf, ownLedgerAccount, runCase, storedOpeningDate, tagOf } from './bankOpeningDateTests.js';

/**
 * 10.3 package 4 (OBS-R1-65, delta review of #377): the start date moves while the account's approval is open, so the
 * approval and an edit of the date must take turns on the account row. On the first fix the approval read the row without
 * a lock: an edit that came between its read and its commit answered 200, and the voucher kept the old day, so the
 * account's start date and its opening voucher's date differed for good (and the date could no longer be set back).
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/** Waits until `count` other sessions wait on a lock; false when they never do within about five seconds */
async function lockWaitersReach(count: number): Promise<boolean> {
  for (let i = 0; i < 100; i++) {
    const n = Number((await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rows[0]?.n ?? 0);
    if (n >= count) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function runBankOpeningApprovalRaceTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const raceId = 'reg_bank_opening_approval_date_race_obs_r1_65';
  if (!shouldRun(raceId, 'obs-r1-65', 'td-986', 'treasury', 'bank', 'opening', 'workflow', 'concurrency', 'package4')) return results;

  await runCase(results, raceId, '10.3 package 4: an edit of the start date during the approval that issues the opening voucher waits for it, so the voucher and the account keep one start date (OBS-R1-65)', async () => {
    const { createTestUser, createTestWorkflow } = await import('../fixtures/factories.js');
    const api = await client();
    const approver = await createTestUser({ role: 'admin' });
    const problems: string[] = [];
    const wf = await createTestWorkflow({
      definition: { entityType: 'bank_account' },
      states: [{ key: 'draft', title: 'Draft', type: 'initial' }, { key: 'approved', title: 'Approved', type: 'terminal' }],
      transitions: [{ fromKey: 'draft', toKey: 'approved', actionKey: 'approve_obs_r1_65_race', title: 'Approve' }],
    });
    let bankId = 0;
    try {
      const res = await api.post('/api/accounting/bank-accounts', {
        title: `Race bank ${tagOf()}`, type: 'bank', accountId: await ownLedgerAccount('Race bank'), initialBalance: 3_000_000, openingDate: '2026-04-09',
      });
      if (res.status !== 201) throw new Error(`bank create under the workflow returned ${brief(res)}`);
      bankId = Number(res.body.id);
    } finally {
      await wf.restore();
    }
    const [instance] = await orm.select({ id: workflowInstances.id }).from(workflowInstances)
      .where(and(eq(workflowInstances.entityType, 'bank_account'), eq(workflowInstances.entityId, String(bankId))));
    if (!instance) throw new Error('the bank has no workflow instance');

    // park the approval at its fiscal-year check: hold the year's row, which the check reads FOR SHARE
    await pool.query(`INSERT INTO fiscal_periods (fiscal_year, status) VALUES (1405, 'open') ON CONFLICT (fiscal_year) DO NOTHING`);
    const holder = await pool.connect();
    let held = false;
    try {
      await holder.query('BEGIN');
      held = true;
      await holder.query('SELECT 1 FROM fiscal_periods WHERE fiscal_year = 1405 FOR UPDATE');
      const approval = WorkflowTransitionExecutor.executeTransition({
        instanceId: instance.id, transitionId: wf.transitions[0].id, userId: approver.id, userName: approver.username, userRole: 'admin', userPermissions: ['*'],
      }).then(() => 'approved', (err: unknown) => `refused ${String((err as { code?: string }).code ?? (err as Error).message)}`);
      if (!await lockWaitersReach(1)) problems.push('the approval never waited on the held fiscal year');
      const edit = api.put(`/api/accounting/bank-accounts/${bankId}`, { openingDate: '2026-04-10' }).then(r => r);
      // with the account row locked by the approval the edit waits too; on the first fix it answered at once
      await lockWaitersReach(2);
      await holder.query('COMMIT');
      held = false;
      const [approved, edited] = await Promise.all([approval, edit]);
      if (approved !== 'approved') problems.push(`the approval ended ${approved}`);
      if (edited.status !== 422 || errorCode(edited) !== 'BANK_OPENING_DATE_LOCKED') problems.push(`the edit during the approval returned ${brief(edited)}, expected 422 BANK_OPENING_DATE_LOCKED after the voucher`);
    } finally {
      if (held) await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
    const vouchers = await openingVouchersOf(bankId);
    const startDate = await storedOpeningDate(bankId);
    if (vouchers.length !== 1) problems.push(`the approval issued ${vouchers.length} opening vouchers, expected 1`);
    else if (vouchers[0].date !== startDate) problems.push(`the opening voucher is dated ${vouchers[0].date} but the account starts ${startDate}`);
    if (problems.length > 0) throw new Error(problems.join(' | '));
    return `the edit waited for the approval and answered 422 BANK_OPENING_DATE_LOCKED; voucher and account both on ${startDate}`;
  });
  return results;
}
