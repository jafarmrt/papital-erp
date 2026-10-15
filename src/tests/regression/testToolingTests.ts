import pg from 'pg';
import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, runCase } from './fiscalClosingTests.js';

/**
 * TD-1266 (10.0 closing test finding): the test bootstrap seeds its own isolated schema, but the seed lock is one key for
 * the whole database. When another process held it (another test run or simulator seeding its own schema), the bootstrap
 * only tried the lock, skipped the seed and still answered success, so the schema had no chart of accounts:
 * `simulate:year --seeds=1,2,3` stopped on its bank with BANK_LEDGER_ACCOUNT_INVALID. Red on v10.1.9: the bootstrap
 * returned at once with the lock held elsewhere.
 *
 * TD-1267 (I-04 follow-up): the activity log filter lists are read with a loose index scan; the lists stay exactly the
 * distinct non-empty values of the table.
 */
const SEED_LOCK_HOLD_MS = 600;

export async function runTestToolingTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const seedId = 'reg_test_bootstrap_waits_for_seed_lock_td_1266';
  if (shouldRun(seedId, 'td1266', 'seed', 'tooling', 'simulator')) {
    await runCase(results, seedId, 'v10.1.12: the test bootstrap waits for the seed lock held by another process instead of skipping the seed of its schema; the server boot still skips (TD-1266)',
      seedLockCase);
  }
  const filterId = 'reg_activity_log_filter_lists_td_1267';
  if (shouldRun(filterId, 'td1267', 'activity-log', 'performance', 'i04')) {
    await runCase(results, filterId, 'v10.1.12: the activity log filter lists are the distinct non-empty users, actions and sections of the log, read by index (TD-1267)',
      filterListsCase);
  }
  return results;
}

async function seedLockCase(): Promise<string> {
  const { runSeedWithLock } = await import('../../db/seed.js');
  const { bootstrapTestMasterData } = await import('../setup/testBootstrap.js');
  const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await holder.connect();
  const wrong: string[] = [];
  try {
    await holder.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEYS.SEED]);
    const skipped = await runSeedWithLock();
    if (!/skipped/i.test(skipped.message)) wrong.push(`the boot seed ran with the lock held elsewhere: ${skipped.message}`);

    const release = setTimeout(() => { void holder.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEYS.SEED]); }, SEED_LOCK_HOLD_MS);
    const started = Date.now();
    try {
      await bootstrapTestMasterData();
    } finally {
      clearTimeout(release);
    }
    const waited = Date.now() - started;
    if (waited < SEED_LOCK_HOLD_MS - 50) wrong.push(`the test bootstrap returned after ${waited} ms while the seed lock was held for ${SEED_LOCK_HOLD_MS} ms, so it skipped the seed`);
    const [accounts] = (await orm.execute(sql`SELECT count(*)::int AS n FROM accounts WHERE code = '10' AND is_deleted = 0`)).rows as Array<{ n: number }>;
    if (Number(accounts?.n) !== 1) wrong.push(`the schema holds ${accounts?.n} cash and bank general accounts, expected 1`);
    if (wrong.length > 0) throw new Error(wrong.join('; '));
    return `the boot seed skipped; the test bootstrap waited ${waited} ms for the lock and seeded its schema`;
  } finally {
    await holder.query('SELECT pg_advisory_unlock_all()').catch(() => undefined);
    await holder.end();
  }
}

async function filterListsCase(): Promise<string> {
  const { ActivityLogQueryService } = await import('../../services/system/activityLogQuery.service.js');
  const tag = `td1267-${Date.now()}`;
  await orm.execute(sql`INSERT INTO activity_logs (username, user_full_name, action, entity, description) VALUES
    (${`${tag}-a`}, '', ${`${tag}-ACT`}, ${`${tag}-sec1`}, 'td1267'),
    (${`${tag}-a`}, ${`${tag} Full A`}, ${`${tag}-ACT`}, ${`${tag}-sec2`}, 'td1267'),
    (${`${tag}-b`}, '', ${`${tag}-ACT2`}, ${`${tag}-sec2`}, 'td1267'),
    ('', '', '', '', 'td1267')`);
  const options = await ActivityLogQueryService.getFilterOptions();
  const distinct = async (column: string) => ((await orm.execute(sql.raw(`SELECT DISTINCT ${column} AS v FROM activity_logs WHERE ${column} <> '' ORDER BY 1`))).rows as Array<{ v: string }>).map(r => String(r.v));
  const wrong: string[] = [];
  const sorted = (list: string[]) => [...list].sort();
  if (JSON.stringify(sorted(options.actions)) !== JSON.stringify(sorted(await distinct('action')))) wrong.push(`actions ${JSON.stringify(options.actions)} differ from the table`);
  if (JSON.stringify(sorted(options.entities)) !== JSON.stringify(sorted(await distinct('entity')))) wrong.push(`sections ${JSON.stringify(options.entities)} differ from the table`);
  if (JSON.stringify(sorted(options.users.map(u => u.username))) !== JSON.stringify(sorted(await distinct('username')))) wrong.push('users differ from the table');
  const a = options.users.find(u => u.username === `${tag}-a`);
  const b = options.users.find(u => u.username === `${tag}-b`);
  if (a?.fullName !== `${tag} Full A`) wrong.push(`user a has full name ${JSON.stringify(a?.fullName)}, expected its non-empty one`);
  if (b?.fullName !== '') wrong.push(`user b has full name ${JSON.stringify(b?.fullName)}, expected empty`);
  if (options.actions.includes('') || options.entities.includes('') || options.users.some(u => u.username === '')) wrong.push('an empty value is listed');
  await orm.execute(sql`DELETE FROM activity_logs WHERE description = 'td1267'`);
  if (wrong.length > 0) throw new Error(wrong.join('; '));
  return `${options.users.length} users, ${options.actions.length} actions and ${options.entities.length} sections, as in the table`;
}
