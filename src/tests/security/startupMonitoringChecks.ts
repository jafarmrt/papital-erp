import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import request from 'supertest';
import winston from 'winston';
import { eq, inArray } from 'drizzle-orm';
import { TestCaseResult, makeTestCase } from '../types.js';
import { orm, pool } from '../../db/drizzle.js';
import { deadLetterEvents, integrationDeliveryJobs, outboxEvents, users } from '../../db/schema.js';
import { generateToken } from '../../middleware/auth.js';
import { logger } from '../../middleware/logger.js';
import { getTestApp, ensureAdminTestUser } from '../fixtures/httpTestHelper.js';
import * as appModule from '../../app.js';

/**
 * Package 1, PR «ج» (lane 4): startup gate, pool readiness, access log level, circular log values and the build
 * details of /health, exercised on the real Express app. Test names and failure messages are English.
 */

type ShouldRun = (id: string, ...extra: string[]) => boolean;

const randomTag = () => crypto.randomBytes(6).toString('hex');

/** Captures what reaches the logger's transports while `fn` runs */
async function captureLogs(fn: () => Promise<void>): Promise<Array<Record<string | symbol, unknown>>> {
  const seen: Array<Record<string | symbol, unknown>> = [];
  const sink = new Writable({ objectMode: true, write(info: Record<string | symbol, unknown>, _enc, done) { seen.push(info); done(); } });
  const capture = new winston.transports.Stream({ stream: sink });
  logger.add(capture);
  try {
    await fn();
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally {
    logger.remove(capture);
  }
  return seen;
}

async function adminToken(username?: string): Promise<string> {
  const admin = await ensureAdminTestUser(username);
  const [row] = await orm.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, admin.id));
  return generateToken({ id: admin.id, username: admin.username, role: 'admin', tokenVersion: row?.tokenVersion ?? 0 });
}

// ---------- TD-584 ----------
async function checkApiWaitsForStartup(): Promise<string[]> {
  const v: string[] = [];
  const gate = appModule as unknown as { beginStartup?: () => void; markStartupComplete: () => void };
  if (typeof gate.beginStartup !== 'function') return ['app.ts exports no beginStartup: the API cannot be closed while migrations run'];
  const app = await getTestApp();
  gate.beginStartup();
  try {
    const me = await request(app).get('/api/auth/me');
    if (me.status !== 503) v.push(`GET /api/auth/me during startup answered ${me.status} (expected 503)`);
    if (me.headers['retry-after'] !== '5') v.push(`no Retry-After: 5 on the startup answer (${String(me.headers['retry-after'])})`);
    if (me.body?.code !== 'SYSTEM_STARTING') v.push(`startup answer code ${String(me.body?.code)} (expected SYSTEM_STARTING)`);
    if (!String(me.body?.message ?? '').includes('در حال به‌روزرسانی')) v.push('the startup answer has no Persian waiting message');
    const login = await request(app).post('/api/login').send({ username: 'x', password: 'y' });
    if (login.status !== 503) v.push(`POST /api/login during startup answered ${login.status} (expected 503)`);
    const ready = await request(app).get('/health/ready');
    if (ready.status !== 503) v.push(`/health/ready during startup answered ${ready.status} (expected 503)`);
    const live = await request(app).get('/api/health/live');
    if (live.status !== 200) v.push(`/api/health/live during startup answered ${live.status} (expected 200)`);
    const startup = await request(app).get('/api/health/startup');
    if (startup.status !== 503) v.push(`/api/health/startup during startup answered ${startup.status} (expected 503)`);
    const webhook = await request(app).head('/api/woocommerce/webhook/order');
    if (webhook.status === 503) v.push('the WooCommerce webhook answered 503 during startup (it must always answer 200)');
  } finally {
    gate.markStartupComplete();
  }
  const readyAfter = await request(app).get('/health/ready');
  if (readyAfter.status !== 200) v.push(`/health/ready after startup answered ${readyAfter.status} (expected 200)`);
  const meAfter = await request(app).get('/api/auth/me');
  if (meAfter.status === 503) v.push('GET /api/auth/me still answered 503 after startup');
  return v;
}

// ---------- TD-596 ----------
async function checkPoolStatsLive(): Promise<string[]> {
  const v: string[] = [];
  const app = await getTestApp();
  const token = await adminToken();
  const held = await pool.connect();
  try {
    const ready = await request(app).get('/health/ready');
    const total = Number(ready.body?.pool?.total);
    if (!(total > 0)) v.push(`/health/ready reported pool.total ${String(ready.body?.pool?.total)} while a connection was held (expected > 0)`);
    const metrics = await request(app).get('/metrics').set('Authorization', `Bearer ${token}`);
    const line = String(metrics.text ?? '').split('\n').find(l => l.startsWith('db_pool_total_connections '));
    const value = Number(line?.split(' ')[1]);
    if (!(value > 0)) v.push(`/metrics reported "${line ?? 'no db_pool_total_connections'}" while a connection was held (expected > 0)`);
  } finally {
    held.release();
  }
  return v;
}

// ---------- OBS-R2-11 (v10.0.5) ----------
const QUEUE_GAUGES = ['erp_queue_metrics_up', 'erp_dead_letter_unresolved', 'erp_outbox_failed', 'erp_outbox_stuck',
  'erp_integration_deliveries_retrying', 'erp_integration_deliveries_failed'] as const;

async function scrapeQueueGauges(token: string): Promise<Record<string, number | undefined>> {
  const app = await getTestApp();
  const res = await request(app).get('/metrics').set('Authorization', `Bearer ${token}`);
  const lines = String(res.text ?? '').split('\n');
  const out: Record<string, number | undefined> = {};
  for (const name of QUEUE_GAUGES) {
    const line = lines.find(l => l.startsWith(`${name} `));
    out[name] = line === undefined ? undefined : Number(line.split(' ')[1]);
  }
  return out;
}

async function checkQueueGauges(): Promise<string[]> {
  const v: string[] = [];
  const token = await adminToken();
  const tag = `obs_r2_11_${randomTag()}`;
  const before = await scrapeQueueGauges(token);
  for (const name of QUEUE_GAUGES) {
    if (before[name] === undefined || Number.isNaN(before[name])) v.push(`/metrics has no ${name} gauge`);
  }
  if (v.length > 0) return v;
  try {
    await orm.insert(outboxEvents).values([
      { eventId: `${tag}_failed`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '1', status: 'failed', payload: {} },
      { eventId: `${tag}_stuck`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '1', status: 'processing', payload: {}, occurredAt: new Date(Date.now() - 3_600_000).toISOString() },
    ]);
    await orm.insert(deadLetterEvents).values({
      originalEventId: `${tag}_dlq`, eventType: 'InvoiceApproved', aggregateType: 'Document', aggregateId: '1', source: 'outbox',
      payload: {}, failureReason: 'monitoring test', status: 'quarantined',
    });
    await orm.insert(integrationDeliveryJobs).values([
      { kind: 'webhook', targetId: 1, eventId: `${tag}_retrying`, eventType: 'InvoiceApproved', event: {}, status: 'pending', attempts: 1 },
      { kind: 'webhook', targetId: 1, eventId: `${tag}_failed`, eventType: 'InvoiceApproved', event: {}, status: 'failed', attempts: 3 },
    ]);
    const after = await scrapeQueueGauges(token);
    if (after.erp_queue_metrics_up !== 1) v.push(`erp_queue_metrics_up is ${String(after.erp_queue_metrics_up)} after a good read (expected 1)`);
    for (const name of QUEUE_GAUGES.slice(1)) {
      const diff = Number(after[name]) - Number(before[name]);
      if (diff !== 1) v.push(`${name} went from ${String(before[name])} to ${String(after[name])} after one matching row was added (expected +1)`);
    }
  } finally {
    await orm.delete(integrationDeliveryJobs).where(inArray(integrationDeliveryJobs.eventId, [`${tag}_retrying`, `${tag}_failed`]));
    await orm.delete(deadLetterEvents).where(eq(deadLetterEvents.originalEventId, `${tag}_dlq`));
    await orm.delete(outboxEvents).where(inArray(outboxEvents.eventId, [`${tag}_failed`, `${tag}_stuck`]));
  }
  return v;
}

// ---------- TD-598 ----------
async function checkAccessLogAtProductionLevel(): Promise<string[]> {
  const app = await getTestApp();
  const probePath = `/api/zz-access-${randomTag()}`;
  const previousLevel = logger.level;
  logger.level = 'info'; // the production default and the LOG_LEVEL written by install.sh
  let seen: Array<Record<string | symbol, unknown>>;
  try {
    seen = await captureLogs(async () => { await request(app).get(probePath); });
  } finally {
    logger.level = previousLevel;
  }
  return seen.some(info => String(info.message ?? '').includes(probePath))
    ? []
    : [`at log level info no access line for GET ${probePath} reached the log`];
}

// ---------- TD-600 ----------
async function checkCircularLogValues(): Promise<string[]> {
  const v: string[] = [];
  const circular: Record<string, unknown> = { name: 'loop' };
  circular.self = circular;
  const err = new Error('error with a self cause') as Error & { cause?: unknown };
  err.cause = err;
  let seen: Array<Record<string | symbol, unknown>> = [];
  try {
    seen = await captureLogs(async () => {
      logger.error('p01 circular metadata', circular);
      logger.error({ message: 'p01 circular cause', error: err });
    });
  } catch (e: unknown) {
    return [`logging a circular value threw: ${e instanceof Error ? e.message : String(e)}`];
  }
  const text = seen.map(info => JSON.stringify(info)).join('\n');
  if (!text.includes('p01 circular metadata') || !text.includes('p01 circular cause')) v.push('the circular log entries did not reach the log');
  if (!text.includes('[Circular]')) v.push('the cycle was not marked [Circular]');
  return v;
}

// ---------- TD-601 ----------
async function checkHealthBuildInfoScoped(): Promise<string[]> {
  const v: string[] = [];
  const app = await getTestApp();
  const anonymous = await request(app).get('/health');
  if (anonymous.status !== 200) return [`/health answered ${anonymous.status}`];
  if (!anonymous.body?.version) v.push('/health lost its public version (verify-startup.sh reads it)');
  if (anonymous.body?.buildInfo !== undefined) v.push(`anonymous /health returned buildInfo ${JSON.stringify(anonymous.body.buildInfo)}`);
  const admin = await request(app).get('/health').set('Authorization', `Bearer ${await adminToken()}`);
  const info = admin.body?.buildInfo as { gitCommit?: string; buildTime?: string } | undefined;
  if (!info) v.push('the system admin got no buildInfo from /health');
  else if (info.gitCommit === 'v4-master' || info.buildTime === '2026-09-05T06:30:00.000Z') v.push(`buildInfo still carries the fixed defaults: ${JSON.stringify(info)}`);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p01-build-info-'));
  try {
    const run = spawnSync(process.execPath, ['scripts/write-build-info.mjs', outDir], { encoding: 'utf8', env: { ...process.env, GIT_COMMIT_SHA: '' } });
    if (run.status !== 0) return [...v, `write-build-info.mjs exited ${run.status}: ${`${run.stderr}${run.stdout}`.slice(-300)}`];
    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'build-info.json'), 'utf8')) as { gitCommit?: string; buildTime?: string };
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    if (written.gitCommit !== head) v.push(`build-info.json commit ${String(written.gitCommit)} (expected HEAD ${head})`);
    if (!(Math.abs(Date.now() - Date.parse(String(written.buildTime))) < 120_000)) v.push(`build-info.json time ${String(written.buildTime)} is not the build time`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  const build = String((JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts.build);
  if (!build.includes('scripts/write-build-info.mjs')) v.push('npm run build does not write build-info.json');
  return v;
}

const CASES: Array<[string, string, () => Promise<string[]>, string]> = [
  ['sec_td_584_api_waits_for_startup',
    'until migrations and seed finish every /api request except health answers 503 SYSTEM_STARTING with Retry-After, and readiness is 503 (TD-584)',
    checkApiWaitsForStartup, 'during startup /api 503 SYSTEM_STARTING and ready 503; live and the webhook open; all open afterwards'],
  ['sec_td_596_pool_stats_live',
    'readiness and the pool gauges read the real connection pool (TD-596)',
    checkPoolStatsLive, 'with a held connection /health/ready and /metrics report a pool total above 0'],
  ['sec_obs_r2_11_queue_gauges',
    'v10.0.5: /metrics exports the unresolved dead-letter events, failed and stuck outbox events and retrying and failed integration deliveries, and whether they were read (OBS-R2-11)',
    checkQueueGauges, 'each queue gauge rose by exactly one for one matching row; erp_queue_metrics_up was 1'],
  ['sec_td_598_access_log_at_production_level',
    'the HTTP access log is written at the production log level info (TD-598)',
    checkAccessLogAtProductionLevel, 'an access line reached the log at level info'],
  ['sec_td_600_logger_circular_values',
    'logging a circular object or an error whose cause points back does not throw; the cycle is marked [Circular] (TD-600)',
    checkCircularLogValues, 'both circular entries were logged with [Circular]'],
  ['sec_td_601_health_build_info_scoped',
    '/health returns build details only to the system admin or metrics token, filled at build time (TD-601)',
    checkHealthBuildInfoScoped, 'anonymous /health has only the version; the admin gets real build details; the build writes build-info.json'],
];

export async function runStartupMonitoringTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const [id, name, fn, info] of CASES) {
    if (!shouldRun(id, name)) continue;
    const start = Date.now();
    let violations: string[];
    try {
      violations = await fn();
    } catch (err: unknown) {
      violations = [err instanceof Error ? err.message : String(err)];
    }
    results.push(makeTestCase({
      id, name, layer: 'security', executionType: 'real_code', passed: violations.length === 0, durationMs: Date.now() - start,
      ...(violations.length === 0 ? { details: info } : { error: violations.join(' | ') }),
    }));
  }
  return results;
}
