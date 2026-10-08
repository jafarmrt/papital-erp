import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { CONDITIONAL_CONSTRAINT_RULES, findMissingConditionalConstraints } from '../../services/system/conditionalConstraints.js';
import { TestCaseResult, makeTestCase } from '../types.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v9.0.433 (TD-903, B01-31 / B01-32, decision t6 «الف», rule of TD-060): the thirty references between business tables
 * that the Drizzle schema declares have database foreign keys (migration 0091), NO ACTION and validated on clean data; a
 * row pointing to a missing parent is refused, a referenced parent is never physically deleted, a key left NOT VALID
 * over a legacy orphan is listed and validated by hand after the fix, and the factory reset still wipes everything
 * (material allocations now go before the Kardex rows they reference). Red on v9.0.432, where none of the keys existed.
 */

export const BUSINESS_KEYS: ReadonlyArray<readonly [table: string, column: string, parent: string]> = [
  ['accounting_settings', 'account_id', 'accounts'], ['bank_accounts', 'account_id', 'accounts'],
  ['cheques', 'bank_account_id', 'bank_accounts'], ['cheques', 'voucher_id', 'journal_vouchers'],
  ['crm_activities', 'assigned_personnel_id', 'personnel'], ['crm_activities', 'customer_id', 'customers'],
  ['crm_activities', 'lead_id', 'crm_leads'], ['crm_leads', 'assigned_personnel_id', 'personnel'],
  ['crm_leads', 'customer_id', 'customers'], ['daily_work_logs', 'project_id', 'production_projects'],
  ['item_prices', 'item_id', 'items'], ['piecework_logs', 'payroll_id', 'piecework_payrolls'],
  ['piecework_logs', 'personnel_id', 'personnel'], ['piecework_logs', 'project_id', 'production_projects'],
  ['piecework_logs', 'task_id', 'piecework_tasks'], ['piecework_payrolls', 'personnel_id', 'personnel'],
  ['piecework_personnel_rates', 'personnel_id', 'personnel'], ['piecework_personnel_rates', 'task_id', 'piecework_tasks'],
  ['piecework_task_rate_history', 'task_id', 'piecework_tasks'], ['production_projects', 'customer_id', 'customers'],
  ['production_projects', 'item_id', 'items'], ['project_bom_allocations', 'item_id', 'items'],
  ['project_bom_allocations', 'project_id', 'production_projects'], ['project_bom_allocations', 'source_transaction_id', 'transactions'],
  ['transactions', 'document_id', 'documents'], ['treasury_transactions', 'bank_account_id', 'bank_accounts'],
  ['treasury_transactions', 'cheque_id', 'cheques'], ['treasury_transactions', 'document_id', 'documents'],
  ['treasury_transactions', 'payroll_id', 'piecework_payrolls'], ['treasury_transactions', 'voucher_id', 'journal_vouchers'],
];

type Row = Record<string, unknown>;

const errorCode = (err: unknown) => String((err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code ?? 'error');

async function scenario(): Promise<string> {
  const problems: string[] = [];
  const admin = await sandboxAdminClient();

  const res = await orm.execute(sql`SELECT cl.relname AS tbl, a.attname AS col, rcl.relname AS ref, c.confdeltype, c.convalidated
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class rcl ON rcl.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`);
  const byKey = new Map((res.rows as Row[]).map(r => [`${r.tbl}.${r.col}`, r]));
  for (const [table, column, parent] of BUSINESS_KEYS) {
    const fk = byKey.get(`${table}.${column}`);
    if (!fk) problems.push(`${table}.${column} has no foreign key`);
    else if (fk.ref !== parent || fk.confdeltype !== 'a' || fk.convalidated !== true) problems.push(`${table}.${column}: ${JSON.stringify(fk)}`);
    if (!CONDITIONAL_CONSTRAINT_RULES.some(r => r.name === `fk_${table}_${column}` && r.addedNotValid)) {
      problems.push(`fk_${table}_${column} is not registered for the health check`);
    }
  }

  let orphanInsert = '';
  try {
    await orm.execute(sql`INSERT INTO item_prices (item_id, title, price) VALUES (987903, 'TD-903 probe', 1000)`);
  } catch (err) { orphanInsert = errorCode(err); }
  if (orphanInsert !== '23503') problems.push(`a price for a missing item was ${orphanInsert ? `refused with ${orphanInsert}` : 'stored'}`);

  const itemId = Number(((await orm.execute(sql`INSERT INTO items (type, name, code, unit) VALUES ('product', 'TD-903 item', 'TD903-1', 'عدد') RETURNING id`)).rows[0] as Row).id);
  await orm.execute(sql`INSERT INTO item_prices (item_id, title, price) VALUES (${itemId}, 'TD-903 price', 1000)`);
  let parentDelete = '';
  try {
    await orm.execute(sql`DELETE FROM items WHERE id = ${itemId}`);
  } catch (err) { parentDelete = errorCode(err); }
  if (parentDelete !== '23503') problems.push(`an item with a price was ${parentDelete ? `refused with ${parentDelete}` : 'physically deleted'}`);
  assertNoProblems(problems);

  // a database whose legacy price row names a removed item: 0091 leaves the key NOT VALID and lists it
  await orm.execute(sql`ALTER TABLE item_prices DROP CONSTRAINT fk_item_prices_item_id`);
  await orm.execute(sql`INSERT INTO item_prices (item_id, title, price) VALUES (987903, 'TD-903 legacy', 1000)`);
  await orm.execute(sql`ALTER TABLE item_prices ADD CONSTRAINT fk_item_prices_item_id FOREIGN KEY (item_id) REFERENCES items(id) NOT VALID`);
  const listed = (await findMissingConditionalConstraints()).find(e => e.name === 'fk_item_prices_item_id');
  if (!listed || listed.state !== 'blocked' || listed.blockers !== 1 || listed.unvalidated !== true) problems.push(`the unvalidated key is listed as ${JSON.stringify(listed ?? null)}`);
  await orm.execute(sql`DELETE FROM item_prices WHERE title = 'TD-903 legacy'`);
  const built = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (!JSON.stringify(built.body?.built ?? []).includes('fk_item_prices_item_id')) problems.push(`the build after the fix answered ${JSON.stringify(built.body).slice(0, 200)}`);
  if ((await findMissingConditionalConstraints()).length !== 0) problems.push('constraints are still listed after the build');

  assertNoProblems(problems);
  return `${BUSINESS_KEYS.length} business keys are NO ACTION and validated, an orphan insert and a parent delete are refused, and a NOT VALID key over a legacy orphan was listed and validated after the fix`;
}

/** The factory reset over a material allocation that points to its Kardex row (own isolated schema, like TD-620) */
async function factoryResetCase(): Promise<TestCaseResult> {
  const id = 'reg_factory_reset_allocation_order_td_903';
  const name = 'v9.0.433: the factory reset wipes material allocations before the Kardex rows they reference (TD-903)';
  const tStart = Date.now();
  const fs = (await import('fs')).default;
  const os = (await import('os')).default;
  const path = (await import('path')).default;
  const { pool } = await import('../../db/drizzle.js');
  const savedPurge = process.env.ALLOW_DANGEROUS_DATA_PURGE;
  const savedAttachmentsDir = process.env.ATTACHMENTS_DIR;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-td903-'));
  let inner: { schema: string; teardown: () => Promise<void> } | null = null;
  try {
    const { setupTestSchema } = await import('../setup/testDb.js');
    const { FactoryResetService } = await import('../../services/system/factoryReset.service.js');
    inner = await setupTestSchema();
    process.env.ATTACHMENTS_DIR = path.join(tmpRoot, '.attachments');
    process.env.ALLOW_DANGEROUS_DATA_PURGE = 'true';
    const one = async (q: string, params: unknown[] = []) => (await pool.query(q, params)).rows[0] as Row;
    const itemId = Number((await one(`INSERT INTO items (type, name, code, unit) VALUES ('raw_material', 'TD-903 material', 'TD903-M', 'عدد') RETURNING id`)).id);
    const txId = Number((await one(`INSERT INTO transactions (item_id, type, quantity, date) VALUES ($1, 'out', 2, now()) RETURNING id`, [itemId])).id);
    const projectId = Number((await one(`INSERT INTO production_projects (project_code, title) VALUES ('TD903-P', 'TD-903 project') RETURNING id`)).id);
    await pool.query(`INSERT INTO project_bom_allocations (project_id, project_code, item_id, item_code, item_name, quantity, source_transaction_id)
      VALUES ($1, 'TD903-P', $2, 'TD903-M', 'TD-903 material', 2, $3)`, [projectId, itemId, txId]);

    await FactoryResetService.wipeAndReseed({ username: 'td903_admin', ip: '127.0.0.93' });
    const left = Number((await one(`SELECT (SELECT count(*) FROM project_bom_allocations) + (SELECT count(*) FROM transactions) AS n`)).n);
    if (left !== 0) throw new Error(`${left} allocation or Kardex row(s) left after the reset`);
    return makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: true, durationMs: Date.now() - tStart,
      details: 'a material allocation pointing to its Kardex row and the row itself were wiped by the reset' });
  } catch (err) {
    return makeTestCase({ id, name, layer: 'regression', executionType: 'real_database', passed: false, durationMs: Date.now() - tStart,
      error: err instanceof Error ? err.message : String(err) });
  } finally {
    if (savedPurge === undefined) delete process.env.ALLOW_DANGEROUS_DATA_PURGE; else process.env.ALLOW_DANGEROUS_DATA_PURGE = savedPurge;
    if (savedAttachmentsDir === undefined) delete process.env.ATTACHMENTS_DIR; else process.env.ATTACHMENTS_DIR = savedAttachmentsDir;
    if (inner) await inner.teardown();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    // in-memory caches must not keep the inner schema's data for the next tests (as in TD-620)
    const { invalidateRoleCache, invalidateSettingsCache } = await import('../../lib/memoryCache.js');
    const { invalidateUserAuthCache } = await import('../../middleware/auth.js');
    const { invalidateTimezoneCache } = await import('../../lib/businessClock.js');
    invalidateRoleCache();
    invalidateSettingsCache();
    invalidateUserAuthCache();
    invalidateTimezoneCache();
  }
}

export async function runBusinessForeignKeyTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_business_foreign_keys_td_903';
  if (shouldRun(id, 'TD-903', 'B01-31', 'B01-32')) {
    await runCase(results, id, 'v9.0.433: the business references declared in the schema have database foreign keys (TD-903)', () => inFiscalSandbox(scenario));
  }
  if (shouldRun('reg_factory_reset_allocation_order_td_903', 'TD-903', 'factory', 'reset')) results.push(await factoryResetCase());
  return results;
}
