import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { TestCaseResult } from '../types.js';
import { declaredForeignKeys, databaseForeignKeys } from './foreignKeyPolicyTests.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase } from './fiscalClosingTests.js';

/**
 * v9.0.435 (TD-614, B01-34): every foreign key column has an index that leads with it, so reading the rows of a parent
 * (a document's treasury rows, a payroll's payments, a cheque's vouchers) and the database's own check on deleting a
 * parent never scan the whole table. Red on v9.0.434: 41 foreign key columns had no such index (among them
 * `treasury_transactions.document_id / payroll_id / voucher_id / cheque_id`, `cheques.bank_account_id`,
 * `journal_vouchers.created_by_id`, `documents.crm_lead_id`).
 *
 * A usable index leads with the column and is either not partial or partial only on `<column> IS NOT NULL` (a partial
 * index on another condition, such as `is_deleted = 0`, does not serve a lookup without that condition). The columns are
 * the single-column foreign keys of the database and every reference Drizzle declares (a declared reference whose key
 * waits in PENDING_FOREIGN_KEYS still gets its index). There are no exceptions.
 */

/** Foreign key columns (`table.column`) without a usable leading index */
export async function foreignKeyColumnsWithoutIndex(): Promise<string[]> {
  const columns = new Set<string>([...declaredForeignKeys().map(d => d.key), ...(await databaseForeignKeys()).keys()]);
  const res = await orm.execute(sql`
    SELECT t.relname AS tbl, a.attname AS col, x.indpred IS NULL AS whole, pg_get_expr(x.indpred, x.indrelid) AS pred
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
    WHERE t.relnamespace = current_schema()::regnamespace AND x.indkey[0] <> 0`);
  const indexed = new Set<string>();
  for (const r of res.rows as Array<{ tbl: string; col: string; whole: boolean; pred: string | null }>) {
    if (r.whole || r.pred === `(${r.col} IS NOT NULL)`) indexed.add(`${r.tbl}.${r.col}`);
  }
  return [...columns].filter(c => !indexed.has(c)).sort();
}

async function scenario(): Promise<string> {
  const missing = await foreignKeyColumnsWithoutIndex();
  const problems = missing.length > 0 ? [`foreign key columns without an index that leads with them (add one in a migration and declare it in Drizzle): ${missing.join(', ')}`] : [];
  assertNoProblems(problems);
  return 'every foreign key column (database constraint or Drizzle reference) has an index that leads with it';
}

export async function runForeignKeyIndexTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_foreign_key_indexes_td_614';
  if (shouldRun(id, 'TD-614', 'B01-34')) {
    await runCase(results, id, 'v9.0.435: every foreign key column has an index that leads with it, so parent lookups and delete checks never scan the table (TD-614)',
      () => inFiscalSandbox(scenario));
  }
  return results;
}
