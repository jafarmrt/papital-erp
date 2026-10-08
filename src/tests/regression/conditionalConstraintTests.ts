import { sql } from 'drizzle-orm';
import { orm, pool } from '../../db/drizzle.js';
import { ADVISORY_LOCK_KEYS } from '../../lib/advisoryLock.js';
import { FinancialHealthService } from '../../services/accounting/financialHealth.service.js';
import {
  CONDITIONAL_CONSTRAINTS_AUDIT_ENTITY, findMissingConditionalConstraints,
} from '../../services/system/conditionalConstraints.js';
import { TestCaseResult } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient, sandboxClientWith } from './fiscalClosingTests.js';

/**
 * v9.0.396 (TD-589, B01-09, decision t5 «الف»): the conditional constraints and unique indexes of migrations 0001, 0012
 * and 0015 that unclean data left out are listed by the financial health check with their cause, and the system admin
 * builds them by hand once the data is clean (preview by default, advisory lock, audit row). Data is never changed.
 * Red on v9.0.395, where nothing knew these names after the migration ran.
 */

const DUP_CODE = '958901';

async function present(name: string, kind: 'constraint' | 'index'): Promise<boolean> {
  const res = kind === 'constraint'
    ? await orm.execute(sql`SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = ${name} AND connamespace = current_schema()::regnamespace`)
    : await orm.execute(sql`SELECT COUNT(*)::int AS n FROM pg_indexes WHERE indexname = ${name} AND schemaname = current_schema()`);
  return Number((res.rows[0] as { n?: number } | undefined)?.n ?? 0) > 0;
}

async function healthTest() {
  const report = await FinancialHealthService.runHealthCheck();
  return report.tests.find(t => t.id === 'conditional_constraints_missing');
}

async function scenario(): Promise<string> {
  const problems: string[] = [];
  const admin = await sandboxAdminClient();

  const clean = await findMissingConditionalConstraints();
  if (clean.length > 0) problems.push(`a freshly migrated schema already lacks ${clean.map(e => e.name).join(', ')}`);

  // the state a v3-era database is left in: an FK and two unique indexes skipped, one of them over unclean data
  const schema = String((await orm.execute(sql`SELECT current_schema() AS s`)).rows[0]?.s);
  await orm.execute(sql`ALTER TABLE transactions DROP CONSTRAINT fk_transactions_item_id`);
  await orm.execute(sql`DROP INDEX ${sql.identifier(schema)}.uq_accounts_code_active`);
  await orm.execute(sql`DROP INDEX ${sql.identifier(schema)}.uq_documents_type_fy_ref_active`);
  await orm.execute(sql`CREATE UNIQUE INDEX uq_documents_type_ref_number_active ON documents (type, ref_number) WHERE is_deleted = 0 AND length(ref_number) > 0`);
  const dupIds = (await orm.execute(sql`INSERT INTO accounts (code, name, level, account_type, nature)
    VALUES (${DUP_CODE}, 'TD-589 probe one', 'subsidiary', 'expense', 'debit'), (${DUP_CODE}, 'TD-589 probe two', 'subsidiary', 'expense', 'debit')
    RETURNING id`)).rows.map(r => Number((r as { id: number }).id));

  const missing = await findMissingConditionalConstraints();
  const byName = new Map(missing.map(e => [e.name, e]));
  if (missing.length !== 3) problems.push(`expected 3 missing objects, found ${missing.map(e => `${e.name}:${e.state}`).join(', ')}`);
  if (byName.get('fk_transactions_item_id')?.state !== 'ready') problems.push('the FK over clean data is not listed as ready');
  if (byName.get('uq_documents_type_fy_ref_active')?.state !== 'ready') problems.push('the fiscal-year document index over clean data is not listed as ready');
  const acc = byName.get('uq_accounts_code_active');
  if (acc?.state !== 'blocked' || acc.blockers !== 1) problems.push(`the account code index is not listed as blocked by one duplicate group: ${JSON.stringify(acc)}`);

  const test = await healthTest();
  if (!test) problems.push('the financial health check has no conditional_constraints_missing test');
  else {
    if (test.status !== 'warning' || test.count !== 3) problems.push(`health test status ${test.status} count ${test.count} (expected warning, 3)`);
    const item = test.items?.find(i => i.code === 'uq_accounts_code_active');
    if (!item?.subtitle?.includes('۱')) problems.push(`the health item does not name the duplicate group: ${JSON.stringify(item)}`);
  }

  const outsider = await sandboxClientWith(['settings.manage']);
  const refused = await outsider.get('/api/system/conditional-constraints');
  if (refused.status !== 403) problems.push(`a settings manager read the list (${refused.status})`);

  const listed = await admin.get('/api/system/conditional-constraints');
  if (listed.status !== 200 || listed.body?.missing?.length !== 3) problems.push(`GET answered ${listed.status} ${JSON.stringify(listed.body).slice(0, 200)}`);

  const preview = await admin.post('/api/system/conditional-constraints/build', {});
  if (preview.status !== 200 || preview.body.applied !== false) problems.push(`the default build is not a preview: ${preview.status} ${JSON.stringify(preview.body).slice(0, 200)}`);
  if (await present('fk_transactions_item_id', 'constraint')) problems.push('the preview built the FK');
  if (JSON.stringify([...(preview.body.built ?? [])].sort()) !== JSON.stringify(['fk_transactions_item_id', 'uq_documents_type_fy_ref_active'])) {
    problems.push(`the preview plan is ${JSON.stringify(preview.body.built)}`);
  }

  const holder = await pool.connect();
  try {
    await holder.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEYS.CONDITIONAL_CONSTRAINTS]);
    const busy = await admin.post('/api/system/conditional-constraints/build', { apply: true });
    if (busy.status !== 409 || busy.body?.code !== 'CONDITIONAL_CONSTRAINTS_BUSY') problems.push(`a build during another build answered ${busy.status} ${busy.body?.code}`);
  } finally {
    await holder.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEYS.CONDITIONAL_CONSTRAINTS]);
    holder.release();
  }
  if (await present('fk_transactions_item_id', 'constraint')) problems.push('a refused build built the FK');

  const applied = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (applied.status !== 200 || applied.body.applied !== true) problems.push(`the build answered ${applied.status} ${JSON.stringify(applied.body).slice(0, 200)}`);
  if (!(await present('fk_transactions_item_id', 'constraint'))) problems.push('the build did not create the FK');
  if (!(await present('uq_documents_type_fy_ref_active', 'index'))) problems.push('the build did not create the fiscal-year document index');
  if (await present('uq_documents_type_ref_number_active', 'index')) problems.push('the legacy cross-year document index was kept after the swap');
  if (await present('uq_accounts_code_active', 'index')) problems.push('the account code index was built over duplicate codes');
  if (JSON.stringify(applied.body.blocked) !== JSON.stringify(['uq_accounts_code_active'])) problems.push(`blocked: ${JSON.stringify(applied.body.blocked)}`);
  const audit = await orm.execute(sql`SELECT details FROM activity_logs WHERE entity = ${CONDITIONAL_CONSTRAINTS_AUDIT_ENTITY}`);
  if (audit.rows.length !== 1) problems.push(`expected one audit row, found ${audit.rows.length}`);

  // the data is fixed by hand (here: the duplicate soft-deleted), then the index is built; nothing else changed
  await orm.execute(sql`UPDATE accounts SET is_deleted = 1 WHERE id = ${dupIds[1]}`);
  const second = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (JSON.stringify(second.body.built) !== JSON.stringify(['uq_accounts_code_active'])) problems.push(`the second build built ${JSON.stringify(second.body.built)}`);
  if ((await findMissingConditionalConstraints()).length !== 0) problems.push('constraints are still missing after the data was fixed and built');
  const rows = await orm.execute(sql`SELECT id, is_deleted FROM accounts WHERE code = ${DUP_CODE} ORDER BY id`);
  if (JSON.stringify(rows.rows.map(r => Number((r as { is_deleted: number }).is_deleted))) !== '[0,1]') problems.push(`the build changed account rows: ${JSON.stringify(rows.rows)}`);
  const after = await healthTest();
  if (after?.status !== 'healthy') problems.push(`the health test is ${after?.status} after the build`);

  assertNoProblems(problems);
  return 'skipped FK and indexes listed with their cause, preview built nothing, a concurrent build got 409, the build made only the clean ones and dropped the legacy index, and after the data was fixed the last one was built';
}

export async function runConditionalConstraintTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_conditional_constraints_td_589';
  if (shouldRun(id, 'TD-589', 'B01-09')) {
    await runCase(results, id, 'v9.0.396: skipped migration constraints are listed with their cause and built by the system admin once the data is clean (TD-589)',
      () => inFiscalSandbox(scenario));
  }
  return results;
}
