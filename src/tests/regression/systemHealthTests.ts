import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/** System health page findings of package 1 (B01-13, B01-39) */
export async function runSystemHealthTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return [...await runUnknownSubsystemTest(shouldRun)];
}

/**
 * Package 1 finding B01-13, TD-593: one try/catch around every subsystem query answered zeros with `status: 'ok'` when
 * any query failed, and `observability` was a constant `ok`. With one unbalanced voucher and a failing dead-letter
 * count, v9.0.357 answered `accounting {"totalVouchers":0,"unbalancedVouchers":0,"status":"ok"}`.
 */
async function runUnknownSubsystemTest(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_system_health_unknown_subsystem_td_593';
  if (!shouldRun(id, 'td593', 'b01-13', 'health', 'package1')) return [];
  const name = 'v9.0.358: a failed subsystem query is reported as unknown, the other subsystems keep their real state (TD-593)';
  const tStart = Date.now();
  const { SystemHealthService } = await import('../../services/system/systemHealth.service.js');
  const realDlqCount = SystemHealthService.countDeadLetterEvents;
  const realOverdue = SystemHealthService.countOverdueSlaTasks;
  let voucherId = 0;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const { createTestVoucher } = await import('../fixtures/factories.js');
    const { pool } = await import('../../db/drizzle.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];

    const account = (await pool.query(`SELECT id FROM accounts WHERE is_deleted = 0 ORDER BY id LIMIT 1`)).rows[0] as { id: number };
    const { voucher } = await createTestVoucher({ status: 'draft' }, [{ accountId: account.id, debit: 1000, credit: 0 }]);
    voucherId = voucher.id;

    type Sub = { status?: string; message?: string } & Record<string, unknown>;
    const health = async () => {
      const res = await request(app).get('/api/system/health').set('Cookie', admin.cookie);
      if (res.status !== 200) throw new Error(`health answered ${res.status}`);
      return res.body as { outbox: Sub; accounting: Sub; workflow: Sub; observability?: unknown };
    };

    const before = await health();
    if (before.accounting.status !== 'error' || Number(before.accounting.unbalancedVouchers) < 1) {
      wrong.push(`unbalanced voucher not reported before the failure: ${JSON.stringify(before.accounting)}`);
    }
    if ('observability' in before) wrong.push('the constant observability status is still sent');

    // the dead-letter count fails: the outbox is unknown, the voucher balance is still read
    SystemHealthService.countDeadLetterEvents = async () => { throw new Error('relation "dead_letter_events" does not exist'); };
    const outboxDown = await health();
    SystemHealthService.countDeadLetterEvents = realDlqCount;
    if (outboxDown.outbox.status !== 'unknown' || outboxDown.outbox.dlqCount !== null || outboxDown.outbox.pendingCount !== null) {
      wrong.push(`failed outbox query reported as ${JSON.stringify(outboxDown.outbox)} (expected unknown with null counts)`);
    }
    if (!outboxDown.outbox.message || /relation|exist/i.test(outboxDown.outbox.message)) {
      wrong.push(`outbox message ${JSON.stringify(outboxDown.outbox.message)} (expected a Persian note without the database error)`);
    }
    if (outboxDown.accounting.status !== 'error' || Number(outboxDown.accounting.unbalancedVouchers) < 1) {
      wrong.push(`with the outbox query failing, accounting answered ${JSON.stringify(outboxDown.accounting)} (expected the unbalanced voucher)`);
    }
    if (outboxDown.workflow.status === 'unknown') wrong.push('workflow reported unknown although its queries succeeded');

    // the overdue count fails: only the workflow is unknown
    SystemHealthService.countOverdueSlaTasks = async () => { throw new Error('statement timeout'); };
    const workflowDown = await health();
    SystemHealthService.countOverdueSlaTasks = realOverdue;
    if (workflowDown.workflow.status !== 'unknown' || workflowDown.workflow.overdueSlaTasks !== null) {
      wrong.push(`failed workflow query reported as ${JSON.stringify(workflowDown.workflow)}`);
    }
    if (workflowDown.outbox.status === 'unknown' || workflowDown.accounting.status !== 'error') {
      wrong.push(`workflow failure changed the other subsystems: ${JSON.stringify({ outbox: workflowDown.outbox, accounting: workflowDown.accounting })}`);
    }

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'outbox and workflow failures each reported as unknown with null counts; the unbalanced voucher still reported',
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    SystemHealthService.countDeadLetterEvents = realDlqCount;
    SystemHealthService.countOverdueSlaTasks = realOverdue;
    if (voucherId) {
      const { pool } = await import('../../db/drizzle.js');
      await pool.query(`DELETE FROM journal_voucher_items WHERE voucher_id = $1`, [voucherId]);
      await pool.query(`DELETE FROM journal_vouchers WHERE id = $1`, [voucherId]);
    }
  }
}
