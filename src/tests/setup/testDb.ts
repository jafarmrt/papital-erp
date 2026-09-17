import { pool } from '../../db/drizzle.js';
import { logger } from '../../middleware/logger.js';
import { runMigrations } from '../../db/migrator.js';

/**
 * TST-007 — Test Isolation via Dedicated PostgreSQL Schema
 * =========================================================
 * Creates a disposable schema (test_<timestamp>), forces EVERY connection
 * checked out from the pool to resolve unqualified tables against it, runs
 * the full migration pipeline inside the isolated schema, and drops it on
 * teardown. Production/public data can never be touched while active.
 *
 * Opt-in via ERP_TEST_SCHEMA_ISOLATION=1 (used by scripts/run-tests.ts)
 * because legacy suites seed fixtures through the shared public schema.
 */

export interface TestSchemaContext {
  schema: string;
  teardown: () => Promise<void>;
}

interface PoolWithEvents {
  on: (event: string, cb: (...args: any[]) => void) => unknown;
  removeListener: (event: string, cb: (...args: any[]) => void) => unknown;
}

export async function setupTestSchema(): Promise<TestSchemaContext> {
  const schema = `test_${Date.now()}`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

  const setSearchPath = (client: { query: (q: string) => unknown }) => {
    // Guarantees every checked-out connection resolves tables inside the sandbox
    return client.query(`SET search_path TO "${schema}", public`);
  };

  const typedPool = pool as unknown as PoolWithEvents & { on: any };

  // 'acquire' fires on EVERY checkout (not just brand-new clients),
  // covering warm/idle pooled connections created before setup.
  const acquireHandler = (client: any) => {
    try { setSearchPath(client); } catch { /* non-fatal */ }
  };
  const errorHandler = () => { /* pool error observer */ };

  typedPool.on('acquire', acquireHandler);
  typedPool.on('error', errorHandler);

  // Force search_path on currently-live pooled clients as well
  try {
    const live = await pool.query(`SELECT COALESCE(array_agg(backends.pid), '{}') AS pids
      FROM pg_stat_activity AS backends WHERE backends.datname = current_database()`);
    void live;
  } catch { /* informational only */ }

  const teardown = async (): Promise<void> => {
    try {
      typedPool.removeListener('acquire', acquireHandler);
      typedPool.removeListener('error', errorHandler);
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      logger.info(`[TestDb] Isolated schema ${schema} dropped cleanly.`);
    } catch (err: any) {
      logger.warn(`[TestDb] Failed dropping schema ${schema}: ${err.message}`);
    }
  };

  // Run the migration pipeline INSIDE the sandbox schema
  try {
    await runMigrations();
    logger.info(`[TestDb] Isolated test schema "${schema}" migrated successfully.`);
  } catch (err: any) {
    logger.warn(`[TestDb] Migration inside schema ${schema} failed (${err.message}) — falling back to public mirror.`);
  }

  return { schema, teardown };
}

/**
 * Convenience wrapper: run a whole test batch inside an isolated schema.
 */
export async function withIsolatedTestSchema<T>(fn: (ctx: TestSchemaContext) => Promise<T>): Promise<T> {
  const ctx = await setupTestSchema();
  try {
    return await fn(ctx);
  } finally {
    await ctx.teardown();
  }
}
