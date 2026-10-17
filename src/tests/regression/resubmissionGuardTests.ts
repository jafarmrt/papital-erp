import request from 'supertest';
import type { Express } from 'express';
import { TestCaseResult, makeTestCase } from '../types.js';
import { newTask, newWorker } from '../invariants/payrollScenarios.js';

/**
 * v10.1.64 (OBS-R2-14, decision ت۴۰ item 18): a work log and a new project are resubmission-safe. Two sends of the same
 * submission (a double click, or a resend after a lost answer, both with the browser's one Idempotency-Key) record one
 * work log and one project, and the second send gets the first answer. On v10.1.63 neither route took the key, so each
 * send wrote its own row.
 */
export async function runResubmissionGuardTests(shouldRun: (id: string, ...extra: string[]) => boolean): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_work_log_and_project_resubmission_obs_r2_14';
  if (!shouldRun(id, 'obs-r2-14', 'idempotency', 'resubmission', 'piecework', 'projects')) return results;

  const name = 'v10.1.64: the same work log or new project sent twice with one Idempotency-Key is recorded once and the second send gets the first answer (OBS-R2-14)';
  const tStart = Date.now();
  const { createHarness } = await import('../security/workflowTestHarness.js');
  const h = await createHarness();
  try {
    const { businessTodayIsoDate } = await import('../../lib/businessClock.js');
    const today = await businessTodayIsoDate();
    const app = h.app as Express;
    const send = (url: string, key: string, body: object) => request(app).post(url)
      .set('Cookie', h.admin.cookie).set('x-csrf-token', h.admin.csrfToken).set('Idempotency-Key', key).send(body);
    const wrong: string[] = [];

    const worker = await newWorker('OBS-R2-14 worker');
    const task = await newTask();
    const logBody = { personnelId: worker, taskId: task, date: today, quantity: 2 };
    const logKey = `obs-r2-14-log-${h.tag}`;
    const first = await send('/api/piecework/logs', logKey, logBody);
    const second = await send('/api/piecework/logs', logKey, logBody);
    const [logs] = await h.q('SELECT COUNT(*)::int AS n FROM piecework_logs WHERE personnel_id = $1 AND is_deleted = 0', [worker]);
    if (first.status !== 201) wrong.push(`the first work log answered ${first.status}, expected 201`);
    if (Number(logs?.n) !== 1) wrong.push(`two sends of one work log saved ${logs?.n} logs, expected 1`);
    if (second.headers['x-idempotency-hit'] !== 'true') wrong.push('the second work log send did not get the first answer');

    const title = `OBS-R2-14 project ${h.tag}`;
    const projectKey = `obs-r2-14-project-${h.tag}`;
    const [a, b] = await Promise.all([
      send('/api/projects', projectKey, { title, quantity: 1 }),
      new Promise<request.Response>(resolve => { setTimeout(() => { void send('/api/projects', projectKey, { title, quantity: 1 }).then(resolve); }, 20); }),
    ]);
    const [projects] = await h.q('SELECT COUNT(*)::int AS n FROM production_projects WHERE title = $1 AND is_deleted = 0', [title]);
    if (Number(projects?.n) !== 1) wrong.push(`two sends of one new project saved ${projects?.n} projects, expected 1 (answers ${a.status} / ${b.status})`);

    if (wrong.length > 0) throw new Error(wrong.join('; '));
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'one work log and one project for two sends with one key',
    }));
  } catch (err) {
    results.push(makeTestCase({
      id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err),
    }));
  } finally {
    await h.cleanup();
  }
  return results;
}
