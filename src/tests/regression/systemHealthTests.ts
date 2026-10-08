import request from 'supertest';
import { TestCaseResult, makeTestCase } from '../types.js';

type ShouldRun = (id: string, ...extra: string[]) => boolean;

/** System health page and setup findings of package 1 (B01-13, B01-39, B01-42, B01-43) */
export async function runSystemHealthTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  return [
    ...await runUnknownSubsystemTest(shouldRun), ...await runStorageDirectoriesTest(shouldRun),
    ...await runStuckOutboxCountTest(shouldRun), ...await runServerWordingTest(shouldRun),
  ];
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

/**
 * Package 1 finding B01-39, TD-619: the storage card checked public/uploads by writing a test file there on every
 * call, never the attachment root (ATTACHMENTS_DIR), so with an unwritable attachment directory a document with an
 * attachment failed with 500 while the card said `{"status":"ok","writable":true}` (v9.0.358).
 */
async function runStorageDirectoriesTest(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_system_health_storage_directories_td_619';
  if (!shouldRun(id, 'td619', 'b01-39', 'health', 'package1')) return [];
  const name = 'v9.0.359: the storage card checks the attachment and image directories without writing to them (TD-619)';
  const tStart = Date.now();
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const savedDir = process.env.ATTACHMENTS_DIR;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'td619-'));
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];
    type Location = { kind: string; path: string; writable: boolean; message: string };
    type Storage = { status?: string; writable?: boolean; locations?: Location[] };
    const storage = async () => {
      const res = await request(app).get('/api/system/health').set('Cookie', admin.cookie);
      if (res.status !== 200) throw new Error(`health answered ${res.status}`);
      return (res.body as { storage: Storage }).storage;
    };
    const location = (s: Storage, kind: string) => s.locations?.find(l => l.kind === kind);

    // a path below a regular file: every attachment write fails with ENOTDIR
    const blocker = path.join(scratch, 'not-a-directory');
    fs.writeFileSync(blocker, 'x');
    process.env.ATTACHMENTS_DIR = path.join(blocker, 'attachments');
    const broken = await storage();
    const att = location(broken, 'attachments');
    if (broken.status !== 'error' || broken.writable !== false) {
      wrong.push(`unwritable attachment directory reported as ${JSON.stringify({ status: broken.status, writable: broken.writable })}`);
    }
    if (!att || att.writable !== false || att.path !== process.env.ATTACHMENTS_DIR) {
      wrong.push(`attachment location ${JSON.stringify(att)} (expected the ATTACHMENTS_DIR path, not writable)`);
    }
    if (att && /ENOTDIR|not a directory/i.test(att.message)) wrong.push('the file system error reached the page');
    if (location(broken, 'images')?.writable !== true) wrong.push(`image directory reported as ${JSON.stringify(location(broken, 'images'))}`);

    // a directory that does not exist yet under a writable one: writable, and the check creates nothing
    const fresh = path.join(scratch, 'fresh', 'attachments');
    process.env.ATTACHMENTS_DIR = fresh;
    const ok = await storage();
    if (ok.status !== 'ok' || location(ok, 'attachments')?.writable !== true) {
      wrong.push(`a creatable attachment directory reported as ${JSON.stringify(ok)}`);
    }
    if (fs.existsSync(path.join(scratch, 'fresh'))) wrong.push('the health check created the attachment directory');

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'unwritable ATTACHMENTS_DIR reported as an error with its path; a missing but creatable one as writable, untouched',
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    if (savedDir === undefined) delete process.env.ATTACHMENTS_DIR; else process.env.ATTACHMENTS_DIR = savedDir;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Package 1 finding B01-43, TD-623: the queue buttons showed even with an empty queue because the page knew only the
 * failed-event count. The health answer now carries `stuckCount` (outbox events in processing for more than five
 * minutes), counted with the same condition the reset uses, so the page offers the reset only when it resets something.
 * On v9.0.360 `outbox.stuckCount` was missing.
 */
async function runStuckOutboxCountTest(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_system_health_stuck_outbox_count_td_623';
  if (!shouldRun(id, 'td623', 'b01-43', 'health', 'outbox', 'package1')) return [];
  const name = 'v9.0.361: the health page counts stuck outbox events with the condition the reset uses (TD-623)';
  const tStart = Date.now();
  const eventId = `TD623-${Date.now().toString(36)}`;
  const { pool } = await import('../../db/drizzle.js');
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];
    const stuck = async () => {
      const res = await request(app).get('/api/system/health').set('Cookie', admin.cookie);
      return (res.body as { outbox?: { stuckCount?: unknown; status?: string } }).outbox;
    };

    const before = await stuck();
    if (typeof before?.stuckCount !== 'number') throw new Error(`outbox.stuckCount is ${JSON.stringify(before?.stuckCount)} (expected a number)`);
    await pool.query(
      `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, status, occurred_at)
       VALUES ($1, 'td623.test', 'test', 'td623', 'processing', now() - interval '10 minutes')`, [eventId]);
    const during = await stuck();
    if (during?.stuckCount !== before.stuckCount + 1) wrong.push(`stuck count ${JSON.stringify(during?.stuckCount)} after one stuck event (before ${before.stuckCount})`);
    if (during?.status === 'ok') wrong.push('a stuck event left the queue status ok');

    const reset = await request(app).post('/api/system/reconciliation-fix').set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken).send({ action: 'clear_stuck_outbox' });
    if (reset.status !== 200 || Number((reset.body as { resetCount?: number }).resetCount) < 1) {
      wrong.push(`reset answered ${reset.status} ${JSON.stringify(reset.body).slice(0, 160)}`);
    }
    const after = await stuck();
    if (after?.stuckCount !== before.stuckCount) wrong.push(`stuck count ${JSON.stringify(after?.stuckCount)} after the reset (expected ${before.stuckCount})`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'one event stuck for ten minutes counted, reset by the action, and the count back to its value before',
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    await pool.query(`DELETE FROM outbox_events WHERE event_id = $1`, [eventId]);
  }
}

/**
 * Package 1 finding B01-42, TD-622 (decision t8): the server texts of the health page and the setup wizard. v9.0.361
 * answered «پایگاه‌داده PostgreSQL متصل و آماده است», «…در حالت Processing با موفقیت بازنشانی شدند» with Latin digits,
 * integrity checks naming «Schema», «Outbox / DLQ», «Replay» and «SLA», accepted a setup without a company name (which
 * then printed «سامانه جامع ERP پاپیتال» on invoices) and refused a concurrent setup with
 * «Another setup is in progress. Please wait.».
 */
async function runServerWordingTest(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const id = 'reg_setup_health_server_wording_td_622';
  if (!shouldRun(id, 'td622', 'b01-42', 'health', 'setup', 'package1')) return [];
  const name = 'v9.0.362: health, integrity check, queue reset and setup messages are Persian with Persian digits; setup needs a company name (TD-622)';
  const tStart = Date.now();
  const { pool } = await import('../../db/drizzle.js');
  const eventId = `td622-${Date.now()}`;
  const lockClient = await pool.connect();
  let locked = false;
  try {
    const { getTestApp, getAdminSession } = await import('../fixtures/httpTestHelper.js');
    const app = await getTestApp();
    const admin = await getAdminSession();
    const wrong: string[] = [];
    const latin = (text: unknown) => /[A-Za-z0-9]/.test(String(text ?? ''));

    const health = await request(app).get('/api/system/health').set('Cookie', admin.cookie);
    const dbMessage = (health.body as { database?: { message?: string } }).database?.message;
    if (health.status !== 200 || !dbMessage || latin(dbMessage)) wrong.push(`database message ${JSON.stringify(dbMessage)}`);

    const check = await request(app).get('/api/system/reconciliation-check').set('Cookie', admin.cookie);
    const checks = ((check.body as { checks?: Array<Record<string, string>> }).checks) || [];
    if (check.status !== 200 || checks.length === 0) wrong.push(`integrity check answered ${check.status}`);
    for (const c of checks) {
      for (const field of ['category', 'title', 'details'] as const) {
        if (latin(c[field])) wrong.push(`integrity check ${c.id} ${field}: ${JSON.stringify(c[field])}`);
      }
    }

    await pool.query(
      `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, status, occurred_at)
       VALUES ($1, 'td622.test', 'test', 'td622', 'processing', now() - interval '10 minutes')`, [eventId]);
    const reset = await request(app).post('/api/system/reconciliation-fix').set('Cookie', admin.cookie)
      .set('x-csrf-token', admin.csrfToken).send({ action: 'clear_stuck_outbox' });
    const resetMessage = String((reset.body as { message?: string }).message ?? '');
    if (reset.status !== 200 || latin(resetMessage) || !/[۰-۹]/.test(resetMessage)) wrong.push(`queue reset message ${JSON.stringify(resetMessage)}`);
    const reconciliation: { requeueResultMessage?: (n: number) => string } = await import('../../services/system/systemReconciliation.service.js');
    if (typeof reconciliation.requeueResultMessage !== 'function') wrong.push('no shared message for the replay of failed events');
    for (const n of [0, 3]) {
      const text = reconciliation.requeueResultMessage?.(n);
      if (text !== undefined && latin(text)) wrong.push(`replay message for ${n}: ${JSON.stringify(text)}`);
    }

    const token = (process.env.ERP_SETUP_TOKEN || 'papital_erp_setup_token_2026').trim();
    const setupBody = { username: 'td622_owner', password: 'abcd12345678', fullName: 'مدیر آزمون' };
    const noCompany = await request(app).post('/api/setup').set('x-setup-token', token).send(setupBody);
    const noCompanyText = JSON.stringify(noCompany.body);
    const { SETUP_COMPANY_NAME_REQUIRED_MESSAGE } = await import('../../lib/auth/setupRules.js');
    if (noCompany.status !== 400 || !noCompanyText.includes(SETUP_COMPANY_NAME_REQUIRED_MESSAGE)) {
      wrong.push(`setup without a company name answered ${noCompany.status} ${noCompanyText.slice(0, 160)}`);
    }

    await lockClient.query('SELECT pg_advisory_lock(79234)');
    locked = true;
    const busy = await request(app).post('/api/setup').set('x-setup-token', token).send({ ...setupBody, companyName: 'کارگاه آزمون' });
    const busyBody = busy.body as { message?: string; code?: string; error?: { message?: string; code?: string } };
    const busyMessage = busyBody.message ?? busyBody.error?.message;
    if (busy.status !== 409 || !busyMessage || latin(busyMessage)) wrong.push(`concurrent setup answered ${busy.status} ${JSON.stringify(busy.body).slice(0, 160)}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: `database «${dbMessage}», ${checks.length} integrity checks without Latin text, reset «${resetMessage}», setup without company 400, concurrent setup 409 «${busyMessage}»`,
    })];
  } catch (err) {
    return [makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    })];
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock(79234)').catch(() => undefined);
    lockClient.release();
    await pool.query(`DELETE FROM outbox_events WHERE event_id = $1`, [eventId]);
  }
}
