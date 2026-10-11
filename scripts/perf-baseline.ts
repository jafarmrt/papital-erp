import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { pool } from '../src/db/drizzle.js';
import { APP_VERSION } from '../src/lib/version.js';
import { logger } from '../src/middleware/logger.js';
import { assertRealTestDatabase } from '../src/tests/testRunner.js';
import { setupTestSchema } from '../src/tests/setup/testDb.js';
import { bootstrapTestMasterData } from '../src/tests/setup/testBootstrap.js';
import { runBusinessYearSimulation } from '../src/tests/simulation/businessYearSimulator.js';
import { getAdminSession, getTestApp } from '../src/tests/fixtures/httpTestHelper.js';
import {
  PERF_ENDPOINTS, PerfMeasurement, StatementStat, evaluate, renderPerfReport, summarize,
} from './perf/perfBaseline.js';

/**
 * v10.0.262 (I-04): the performance baseline on realistic data (V10_MASTER_ROADMAP.md, I-04).
 *
 *   npm run perf:baseline -- [--steps=3000] [--users=8] [--activity-logs=300000] [--items=2000] [--customers=1000]
 *                            [--samples=20] [--seed=1]
 *                            [--report=dist/perf-baseline.md] [--enforce]
 *
 * Needs the CI test environment (a real DATABASE_URL, NODE_ENV=test). In an isolated schema it runs the one-year
 * simulator (thousands of documents, vouchers and Kardex rows), adds catalogue items, parties and audit rows in bulk
 * (the simulator works on a handful of items and parties, a workshop has thousands), then times the main page
 * APIs through the real Express app with an admin session and writes a Markdown report (and JSON beside it). When
 * pg_stat_statements is loaded it also lists the costliest statements. `--enforce` exits 1 when an API misses its target.
 * It never connects to anything but the test database and drops its schema at the end.
 */

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(a => a.startsWith(prefix))?.slice(prefix.length);
}

function intArg(name: string, fallback: number): number {
  const value = Number(argValue(name));
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const COUNTED_TABLES = [
  'documents', 'document_items', 'transactions', 'journal_vouchers', 'journal_voucher_items',
  'treasury_transactions', 'items', 'customers', 'activity_logs',
] as const;

/** Adds `rows` audit rows spread over the last year, in batches, so the audit log list is measured at its real size. */
async function addActivityLogs(rows: number): Promise<void> {
  const batch = 50_000;
  for (let done = 0; done < rows; done += batch) {
    const size = Math.min(batch, rows - done);
    await pool.query(
      `INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
       SELECT 'perf_user_' || (g % 20), 'کاربر آزمایش ' || (g % 20),
              (ARRAY['CREATE','UPDATE','DELETE','VIEW','LOGIN'])[1 + g % 5],
              (ARRAY['اسناد انبار','کالا','سند حسابداری','پروژه تولید','اشخاص'])[1 + g % 5],
              (g % 5000)::text, 'ردیف آزمایش کارایی ' || g, jsonb_build_object('perf', g), '127.0.0.1',
              now() - ((g % 365) || ' days')::interval - ((g % 86400) || ' seconds')::interval
       FROM generate_series($1::int, $2::int) AS g`,
      [done + 1, done + size],
    );
  }
}

/** Adds catalogue items without stock and customers, so the item and party lists are measured at a workshop's size. */
async function addCatalogue(itemCount: number, customerCount: number): Promise<void> {
  if (itemCount > 0) {
    await pool.query(
      `INSERT INTO items (type, name, code, unit, category)
       SELECT CASE WHEN g % 3 = 0 THEN 'product' ELSE 'raw_material' END, 'کالای آزمایش کارایی ' || g, 'PERF-' || g, 'عدد', 'سایر اقلام'
       FROM generate_series(1, $1::int) AS g`,
      [itemCount],
    );
  }
  if (customerCount > 0) {
    await pool.query(
      `INSERT INTO customers (name, party_type, phone)
       SELECT 'شخص آزمایش کارایی ' || g, CASE WHEN g % 4 = 0 THEN 'supplier' ELSE 'customer' END, '0912' || lpad(g::text, 7, '0')
       FROM generate_series(1, $1::int) AS g`,
      [customerCount],
    );
  }
}

async function tableRows(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    result[table] = Number(rows[0]?.n ?? 0);
  }
  return result;
}

/** Resets pg_stat_statements when it is loaded; false otherwise (the extension needs shared_preload_libraries). */
async function resetStatementStats(): Promise<boolean> {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA public');
    await pool.query('SELECT public.pg_stat_statements_reset()');
    return true;
  } catch {
    return false;
  }
}

async function topStatements(limit: number): Promise<StatementStat[]> {
  const { rows } = await pool.query(
    `SELECT query, calls::int AS calls, total_exec_time AS total, mean_exec_time AS mean, rows::int AS rows
     FROM public.pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
     ORDER BY total_exec_time DESC LIMIT $1`,
    [limit],
  );
  return rows.map(r => ({ query: String(r.query), calls: Number(r.calls), totalMs: Number(r.total), meanMs: Number(r.mean), rows: Number(r.rows) }));
}

async function measure(samples: number): Promise<PerfMeasurement[]> {
  const app = await getTestApp();
  const { cookie } = await getAdminSession();
  const measurements: PerfMeasurement[] = [];
  for (const endpoint of PERF_ENDPOINTS) {
    const failedStatuses: number[] = [];
    const times: number[] = [];
    for (let i = -2; i < samples; i++) {
      const started = process.hrtime.bigint();
      const res = await request(app).get(endpoint.path).set('Cookie', cookie);
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (i < 0) continue; // two warm-up requests fill the caches a running server already has
      if (res.status !== 200) failedStatuses.push(res.status);
      times.push(elapsedMs);
    }
    const summary = summarize(times);
    measurements.push({ endpoint, failedStatuses, summary });
    console.log(`  ${endpoint.path}: p50 ${summary.p50Ms} ms, p95 ${summary.p95Ms} ms${failedStatuses.length ? `, failed statuses ${[...new Set(failedStatuses)].join(',')}` : ''}`);
  }
  return measurements;
}

async function main(): Promise<void> {
  const steps = intArg('steps', 3000);
  const users = Math.max(1, intArg('users', 8));
  const activityLogRows = intArg('activity-logs', 300_000);
  const itemCount = intArg('items', 2000);
  const customerCount = intArg('customers', 1000);
  const samples = Math.max(1, intArg('samples', 20));
  const seed = intArg('seed', 1);
  const reportPath = argValue('report') ?? 'dist/perf-baseline.md';
  const enforce = process.argv.includes('--enforce');

  // the access log would print every timed request; warnings and errors still show
  logger.level = 'warn';
  await assertRealTestDatabase();
  const ctx = await setupTestSchema();
  try {
    await bootstrapTestMasterData();
    console.log(`Simulating ${steps} business steps (${users} concurrent users)...`);
    const sim = await runBusinessYearSimulation({ seed, steps, users, checkEvery: Math.max(steps, 1) });
    console.log(`  ${sim.counts.ok} operations succeeded, ${sim.counts.rejected} rejected, ${sim.counts.skipped} without action`);
    console.log(`Adding ${itemCount} items, ${customerCount} parties and ${activityLogRows} audit rows...`);
    await addCatalogue(itemCount, customerCount);
    await addActivityLogs(activityLogRows);
    await pool.query('ANALYZE');
    const rows = await tableRows();
    console.log(`Data volume: ${Object.entries(rows).map(([t, n]) => `${t}=${n}`).join(', ')}`);

    const statementsOn = await resetStatementStats();
    console.log(statementsOn ? 'pg_stat_statements is loaded; statement statistics reset.' : 'pg_stat_statements is not loaded; statement statistics skipped.');
    console.log(`Timing ${PERF_ENDPOINTS.length} endpoints, ${samples} requests each:`);
    const verdicts = evaluate(await measure(samples));
    const statements = statementsOn ? await topStatements(15) : null;

    const report = renderPerfReport({
      generatedAt: new Date().toISOString(), version: APP_VERSION, steps, activityLogRows,
      tableRows: rows, verdicts, topStatements: statements,
    });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, report, 'utf8');
    fs.writeFileSync(reportPath.replace(/\.md$/, '') + '.json', JSON.stringify({ tableRows: rows, verdicts, topStatements: statements }, null, 2), 'utf8');
    console.log(`Report written to ${reportPath}`);

    const breaches = verdicts.filter(v => !v.withinTarget);
    if (breaches.length > 0) {
      console.log(`${breaches.length} endpoints missed their target: ${breaches.map(b => b.endpoint.path).join(', ')}`);
      if (enforce) process.exitCode = 1;
    } else {
      console.log('All endpoints are within their targets.');
    }
  } finally {
    await ctx.teardown();
  }
}

main()
  .catch(err => {
    console.error(`Performance baseline failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end().finally(() => process.exit());
  });
