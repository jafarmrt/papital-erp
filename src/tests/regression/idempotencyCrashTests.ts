import request from 'supertest';
import { pool } from '../../db/drizzle.js';
import { IdempotencyService } from '../../services/idempotency.service.js';
import { addLog, fundedBank, issueApproved, newTask, newWorker } from '../invariants/payrollScenarios.js';
import { TestCaseResult, makeTestCase } from '../types.js';

/**
 * v10.2.35 (pre-existing money risk raised in the #351 review): a payroll or piecework write completes its resubmission key
 * inside its own transaction. Before, the key was completed only after the answer was ready (`saveResponse` in the
 * middleware), so a process that died between the payment's commit and that step left the key `processing`; once its lock
 * lapsed a resend took the key over and paid a second time. The crash is simulated by a `saveResponse` that never writes,
 * then the lock is lapsed by hand. Through the real Express routes; red on v10.2.34: the resend pays again and logs again.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

let seq = 0;
const tagOf = () => `${String(Date.now()).slice(-6)}${++seq}`;
const brief = (res: { status: number; body?: unknown }) => `${res.status} ${JSON.stringify(res.body ?? null).slice(0, 220)}`;
const utcNow = `(now() AT TIME ZONE 'UTC')`;

async function adminClient() {
  const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
  const app = await getTestApp();
  const s = await getAdminSession();
  return {
    post: (url: string, key: string, body: object) =>
      request(app).post(url).set('Cookie', s.cookie).set('x-csrf-token', s.csrfToken).set('Idempotency-Key', key).send(body),
  };
}

/** Runs `send` as if the process died once the write committed: the middleware's own completion of the key never lands */
async function withCrashAfterCommit<T>(send: () => Promise<T>): Promise<T> {
  const saveResponse = IdempotencyService.saveResponse;
  IdempotencyService.saveResponse = async () => undefined;
  try {
    return await send();
  } finally {
    IdempotencyService.saveResponse = saveResponse;
  }
}

const keyState = async (key: string) =>
  (await pool.query<{ status: string }>('SELECT status FROM idempotency_keys WHERE key = $1', [key])).rows[0]?.status ?? 'none';
/** The lock of a crashed run has lapsed (its heartbeat died with it) */
const lapseLock = (key: string) =>
  pool.query(`UPDATE idempotency_keys SET locked_until = ${utcNow} - interval '1 minute' WHERE key = $1`, [key]);

/** Waits until `count` other sessions wait on a row lock (the requests sent are parked behind the held row) */
async function waitForLockWaiters(count: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const n = Number((await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rows[0]?.n ?? 0);
    if (n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`setup: ${count} requests never waited on the held payslip`);
}

async function runCase(results: TestCaseResult[], id: string, name: string, keys: string[], body: () => Promise<string>): Promise<void> {
  const tStart = Date.now();
  try {
    const details = await body();
    results.push(makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart, details }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (keys.length > 0) await pool.query('DELETE FROM idempotency_keys WHERE key = ANY($1::text[])', [keys]).catch(() => undefined);
  }
}

export async function runIdempotencyCrashTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  const paymentId = 'reg_idempotency_payment_crash_after_commit_pays_once';
  if (shouldRun(paymentId, 'idempotency', 'resubmission', 'payroll', 'treasury', 'crash', 'package11')) {
    const key = `crash-pay-${tagOf()}`;
    await runCase(results, paymentId, 'v10.2.35: a payslip payment whose process dies after the commit pays once; a resend after the lock lapses gets the «already registered» notice', [key], async () => {
      const problems: string[] = [];
      const workerId = await newWorker(`ERP-TEST-MARKER crash pay ${tagOf()}`);
      await addLog(workerId, await newTask(), '2026-04-05', 1_000_000);
      const issued = await issueApproved({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'crash' });
      if (!issued.payroll) throw new Error(`setup: issuing the payslip failed (${issued.error})`);
      const payrollId = issued.payroll.id;
      const bankId = await fundedBank();
      const api = await adminClient();
      const url = `/api/piecework/payrolls/${payrollId}/register-payment`;
      const body = { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 };

      const first = await withCrashAfterCommit(() => api.post(url, key, body));
      if (first.status !== 200) throw new Error(`setup: the payment answered ${brief(first)}`);
      const afterCrash = await keyState(key);
      if (afterCrash !== 'completed') problems.push(`after the crash the key is "${afterCrash}", expected completed with the payment`);
      await lapseLock(key);

      const resend = await api.post(url, key, body);
      if (resend.status !== 200 || resend.body?.idempotentReplay !== true || resend.headers['x-idempotency-hit'] !== 'true') {
        problems.push(`the resend answered ${brief(resend)}, expected the replay notice`);
      }
      const paid = (await pool.query<{ p: string }>('SELECT coalesce(paid_amount, 0)::text AS p FROM piecework_payrolls WHERE id = $1', [payrollId])).rows[0]?.p;
      if (Number(paid) !== 300_000) problems.push(`the payslip shows ${paid} paid, expected 300000 (paid twice)`);
      const rows = Number((await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1 AND type = 'payment'`, [bankId])).rows[0]?.n ?? 0);
      if (rows !== 1) problems.push(`${rows} treasury payments recorded, expected 1`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'key completed with the payment; resend replayed; paid once';
    });
  }

  const takeoverId = 'reg_idempotency_lapsed_lock_takeover_pays_once';
  if (shouldRun(takeoverId, 'idempotency', 'resubmission', 'payroll', 'treasury', 'crash', 'package11')) {
    const key = `crash-takeover-${tagOf()}`;
    await runCase(results, takeoverId, 'v10.2.35 (#353 review M1): a payment whose lock lapses while it waits, and the resend that takes its key over, pay once; the run that completes the key second rolls back with 409', [key], async () => {
      const problems: string[] = [];
      const workerId = await newWorker(`ERP-TEST-MARKER crash takeover ${tagOf()}`);
      await addLog(workerId, await newTask(), '2026-04-05', 1_000_000);
      const issued = await issueApproved({ personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30', username: 'crash' });
      if (!issued.payroll) throw new Error(`setup: issuing the payslip failed (${issued.error})`);
      const payrollId = issued.payroll.id;
      const bankId = await fundedBank();
      const api = await adminClient();
      const url = `/api/piecework/payrolls/${payrollId}/register-payment`;
      const body = { bankAccountId: bankId, method: 'bank_transfer', amount: 300_000 };

      // the payslip row is held, so run A waits inside its transaction; its lock lapses and run B takes the key over
      const holder = await pool.connect();
      let answers: Array<{ status: number; body?: { code?: string } }>;
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM piecework_payrolls WHERE id = $1 FOR UPDATE', [payrollId]);
        const runA = api.post(url, key, body).then((r) => r);
        await waitForLockWaiters(1);
        await lapseLock(key);
        const runB = api.post(url, key, body).then((r) => r);
        await waitForLockWaiters(2);
        await holder.query('COMMIT');
        answers = await Promise.all([runA, runB]);
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
      const statuses = answers.map((a) => a.status).sort();
      if (statuses.join(',') !== '200,409') problems.push(`the two runs answered ${answers.map(brief).join(' and ')}, expected one 200 and one 409`);
      const refused = answers.find((a) => a.status === 409);
      if (refused && refused.body?.code !== 'IDEMPOTENCY_IN_FLIGHT') problems.push(`the refused run answered ${brief(refused)}, expected IDEMPOTENCY_IN_FLIGHT`);
      const paid = (await pool.query<{ p: string }>('SELECT coalesce(paid_amount, 0)::text AS p FROM piecework_payrolls WHERE id = $1', [payrollId])).rows[0]?.p;
      if (Number(paid) !== 300_000) problems.push(`the payslip shows ${paid} paid, expected 300000 (paid twice)`);
      const rows = Number((await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM treasury_transactions WHERE bank_account_id = $1 AND type = 'payment'`, [bankId])).rows[0]?.n ?? 0);
      if (rows !== 1) problems.push(`${rows} treasury payments recorded, expected 1`);
      const again = await api.post(url, key, body);
      if (again.body?.idempotentReplay !== true) problems.push(`a third send answered ${brief(again)}, expected the replay notice`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'one run paid, the other rolled back with 409; a third send replayed';
    });
  }

  const logId = 'reg_idempotency_work_log_crash_after_commit_logs_once';
  if (shouldRun(logId, 'idempotency', 'resubmission', 'piecework', 'crash', 'package11')) {
    const key = `crash-log-${tagOf()}`;
    await runCase(results, logId, 'v10.2.35: a work log whose process dies after the commit is saved once; a resend after the lock lapses gets the notice', [key], async () => {
      const problems: string[] = [];
      const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
      const workerId = await newWorker(`ERP-TEST-MARKER crash log ${tagOf()}`);
      const body = { personnelId: workerId, taskId: await newTask(), date: await businessTodayIsoDate(), quantity: 2 };
      const api = await adminClient();

      const first = await withCrashAfterCommit(() => api.post('/api/piecework/logs', key, body));
      if (first.status !== 201) throw new Error(`setup: the work log answered ${brief(first)}`);
      await lapseLock(key);
      const resend = await api.post('/api/piecework/logs', key, body);
      if (resend.body?.idempotentReplay !== true) problems.push(`the resend answered ${brief(resend)}, expected the replay notice`);
      const logs = Number((await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0', [workerId])).rows[0]?.n ?? 0);
      if (logs !== 1) problems.push(`${logs} work logs saved, expected 1`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return 'one work log; resend replayed';
    });
  }

  const refusedId = 'reg_idempotency_refused_payslip_releases_key';
  if (shouldRun(refusedId, 'idempotency', 'resubmission', 'payroll', 'crash', 'package11')) {
    const key = `crash-refused-${tagOf()}`;
    await runCase(results, refusedId, 'v10.2.35: a payslip the service refuses without throwing (no work in the period) does not complete its key, so the same request runs again once the work is logged', [key], async () => {
      const problems: string[] = [];
      const workerId = await newWorker(`ERP-TEST-MARKER crash refused ${tagOf()}`);
      const body = { personnelId: workerId, startDate: '2026-04-01', endDate: '2026-04-30' };
      const api = await adminClient();

      const refused = await api.post('/api/piecework/payrolls', key, body);
      if (refused.status !== 400) throw new Error(`setup: a payslip without work answered ${brief(refused)}`);
      const state = await keyState(key);
      if (state === 'completed') problems.push('a refused payslip completed its key');
      await addLog(workerId, await newTask(), '2026-04-05', 500_000);
      const issued = await api.post('/api/piecework/payrolls', key, body);
      if (issued.status !== 201 || issued.body?.idempotentReplay === true) problems.push(`the same request after logging work answered ${brief(issued)}, expected a new payslip`);
      if (problems.length > 0) throw new Error(problems.join(' | '));
      return `refused (key ${state}), then issued`;
    });
  }

  return results;
}
