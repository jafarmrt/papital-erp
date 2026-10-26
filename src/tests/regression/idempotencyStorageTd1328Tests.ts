import request from 'supertest';
import type { Express } from 'express';
import { TestCaseResult, makeTestCase } from '../types.js';
import { newTask, newWorker } from '../invariants/payrollScenarios.js';
import { IDEMPOTENCY_REPLAY_BODY } from '../../middleware/idempotency.js';

/**
 * v10.2 package 11 part 4c (TD-1328): a resubmission key keeps only the fingerprint of its request body, never the body,
 * and no answer of a payslip or piecework route; a repeat of such a request still runs once and gets the replay answer.
 * A key recorded before with its full body is still compared on that body. Through the real Express routes; red on the
 * code before the fix, which kept every body and every answer for a day.
 */
export async function runIdempotencyStorageTd1328Tests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_idempotency_fingerprint_only_td_1328';
  if (!shouldRun(id, 'td1328', 'idempotency', 'resubmission', 'piecework', 'package11')) return results;

  const name = 'v10.2.33: a resubmission key keeps only its request fingerprint and no piecework answer; a repeat still runs once and a legacy key is compared on its stored body (TD-1328)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  const keys: string[] = [];
  try {
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const today = await businessTodayIsoDate();
    const app = h.app as Express;
    const send = (url: string, key: string, body: object) => {
      keys.push(key);
      return request(app).post(url).set('Cookie', h.admin.cookie).set('x-csrf-token', h.admin.csrfToken).set('Idempotency-Key', key).send(body);
    };
    const stored = async (key: string) => (await h.q('SELECT request_payload, response_body FROM idempotency_keys WHERE key = $1', [key]))[0];
    const wrong: string[] = [];

    // a work log: the key holds the fingerprint and the replay answer, the repeat records nothing more
    const worker = await newWorker('TD-1328 worker');
    const task = await newTask();
    const logBody = { personnelId: worker, taskId: task, date: today, quantity: 3 };
    const logKey = `td-1328-log-${h.tag}`;
    const first = await send('/api/piecework/logs', logKey, logBody);
    const second = await send('/api/piecework/logs', logKey, logBody);
    if (first.status !== 201) wrong.push(`the work log answered ${first.status}`);
    const [logs] = await h.q('SELECT COUNT(*)::int AS n FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0', [worker]);
    if (Number(logs?.n) !== 1) wrong.push(`two sends saved ${logs?.n} work logs`);
    if (second.status !== 201 || second.headers['x-idempotency-hit'] !== 'true' || second.body?.idempotentReplay !== true) {
      wrong.push(`the repeat answered ${second.status} ${JSON.stringify(second.body)}`);
    }
    const logRow = await stored(logKey);
    const fingerprint = (logRow?.request_payload as { requestFingerprint?: unknown } | null | undefined)?.requestFingerprint;
    if (typeof fingerprint !== 'string' || !fingerprint.startsWith('sha256:') || Object.keys(logRow?.request_payload ?? {}).length !== 1) {
      wrong.push(`the key kept the request ${JSON.stringify(logRow?.request_payload)}`);
    }
    const sorted = (o: unknown) => JSON.stringify(Object.entries((o ?? {}) as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)));
    if (sorted(logRow?.response_body) !== sorted(IDEMPOTENCY_REPLAY_BODY)) wrong.push(`the key kept the piecework answer ${JSON.stringify(logRow?.response_body)}`);
    const other = await send('/api/piecework/logs', logKey, { ...logBody, quantity: 4 });
    if (other.status !== 422 || other.body?.code !== 'IDEMPOTENCY_KEY_REUSED') wrong.push(`the key with another body answered ${other.status} ${other.body?.code}`);

    // a key recorded before this release with its full body is still compared on that body
    const legacyKey = `td-1328-legacy-${h.tag}`;
    keys.push(legacyKey);
    const legacyBody = { personnelId: worker, taskId: task, date: today, quantity: 5 };
    const [admin] = await h.q(`SELECT id FROM users WHERE username = 'pen_admin' AND is_deleted = 0`);
    await h.q(`INSERT INTO idempotency_keys (key, scope, status, request_method, request_path, request_payload, response_status, response_body, created_by_id, created_at, expires_at, completed_at)
      VALUES ($1, 'piecework', 'completed', 'POST', '/api/piecework/logs', $2::jsonb, 201, '{"legacy":true}'::jsonb, $3, now(), now() + interval '1 day', now())`,
    [legacyKey, JSON.stringify(legacyBody), admin.id]);
    const legacySame = await request(app).post('/api/piecework/logs').set('Cookie', h.admin.cookie).set('x-csrf-token', h.admin.csrfToken)
      .set('Idempotency-Key', legacyKey).send(legacyBody);
    if (legacySame.status !== 201 || legacySame.body?.legacy !== true) wrong.push(`the legacy key with its body answered ${legacySame.status} ${JSON.stringify(legacySame.body)}`);
    const legacyOther = await request(app).post('/api/piecework/logs').set('Cookie', h.admin.cookie).set('x-csrf-token', h.admin.csrfToken)
      .set('Idempotency-Key', legacyKey).send({ ...legacyBody, quantity: 6 });
    if (legacyOther.status !== 422) wrong.push(`the legacy key with another body answered ${legacyOther.status}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'fingerprint only, replay answer for piecework, one work log for two sends, legacy body compared',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    if (keys.length > 0) await h.q('DELETE FROM idempotency_keys WHERE key = ANY($1::text[])', [keys]).catch(() => undefined);
    await h.cleanup();
  }
  return results;
}

/**
 * v10.2 package 11 part 5a (#351 review I1): a key whose request is still running keeps it past its window. Before, the
 * daily purge deleted every key past `expires_at` whatever its state, and taking over a timed-out key (a retry after a
 * crash) kept the first run's window, so a long retry could lose its key while it ran and a resend then ran the payment a
 * second time. Now the purge keeps a `processing` key with a live lock and the takeover gives the key its whole lifetime
 * again. Red on v10.2.33: the running key is purged and the takeover keeps the old window.
 */
export async function runIdempotencyRunningKeyTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_idempotency_running_key_kept_351_i1';
  if (!shouldRun(id, 'td1328', 'idempotency', 'resubmission', 'purge', 'package11')) return results;

  const name = 'v10.2.34: the purge keeps a running key past its window and a takeover of a timed-out key gives it a new window, so a resend of a long run waits (#351 review I1)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const { IdempotencyService } = await import('../../services/idempotency.service.js');
  const h = await createHarness();
  const running = `td-1328-i1-running-${h.tag}`;
  const lapsed = `td-1328-i1-lapsed-${h.tag}`;
  const retried = `td-1328-i1-retried-${h.tag}`;
  const keys = [running, lapsed, retried];
  try {
    const [admin] = await h.q(`SELECT id FROM users WHERE username = 'pen_admin' AND is_deleted = 0`);
    const insert = (key: string, lockedUntil: string, expiresAt: string) => h.q(
      `INSERT INTO idempotency_keys (key, scope, status, request_method, request_path, created_by_id, locked_at, locked_until, created_at, expires_at)
       VALUES ($1, 'td1328_i1', 'processing', 'POST', '/api/payroll/td1328-i1', $2, now() - interval '25 hours', ${lockedUntil}, now() - interval '25 hours', ${expiresAt})`,
      [key, admin.id]);
    const wrong: string[] = [];

    // past its window: a run still holding its lock stays, a run whose lock lapsed goes
    await insert(running, `now() + interval '10 minutes'`, `now() - interval '1 minute'`);
    await insert(lapsed, `now() - interval '10 minutes'`, `now() - interval '1 minute'`);
    await IdempotencyService.cleanupExpired();
    const left = (await h.q('SELECT key FROM idempotency_keys WHERE key = ANY($1::text[])', [[running, lapsed]])).map((r) => String(r.key));
    if (!left.includes(running)) wrong.push('the purge deleted a key whose request is still running');
    if (left.includes(lapsed)) wrong.push('the purge kept a key past its window whose lock lapsed');

    // a crashed run near the end of its window: the retry takes the key with a new window, and a resend waits for it
    await insert(retried, `now() - interval '1 minute'`, `now() + interval '1 minute'`);
    const options = { scope: 'td1328_i1', userId: Number(admin.id), requestMethod: 'POST', requestPath: '/api/payroll/td1328-i1', ttlSeconds: 24 * 60 * 60 };
    const takeover = await IdempotencyService.acquireKey(retried, options);
    if (takeover.action !== 'PROCESS_NEW') wrong.push(`the retry of a timed-out key got ${takeover.action}`);
    const [row] = await h.q(`SELECT expires_at > now() + interval '23 hours' AS renewed FROM idempotency_keys WHERE key = $1`, [retried]);
    if (row?.renewed !== true) wrong.push('the retry kept the first run\'s window');
    const resend = await IdempotencyService.acquireKey(retried, options);
    if (resend.action !== 'IN_PROGRESS') wrong.push(`a resend during the retry got ${resend.action}`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'running key kept, lapsed key purged, takeover renews the window, resend waits',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h.q('DELETE FROM idempotency_keys WHERE key = ANY($1::text[])', [keys]).catch(() => undefined);
    await h.cleanup();
  }
  return results;
}
