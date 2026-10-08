import { is, sql, SQL } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { orm } from '../../db/drizzle.js';
import * as schema from '../../db/schema.js';
import { findMissingConditionalConstraints } from '../../services/system/conditionalConstraints.js';
import { TestCaseResult } from '../types.js';
import { declaredForeignKeys, databaseForeignKeys } from './foreignKeyPolicyTests.js';
import { type ShouldRun, assertNoProblems, inFiscalSandbox, runCase, sandboxAdminClient } from './fiscalClosingTests.js';

/**
 * v9.0.434 (TD-613, B01-33): the Drizzle schema says what the migrations built, so `drizzle-kit generate` or `push` would
 * neither drop nor rebuild anything. Red on v9.0.433: five foreign keys were SET NULL in the database and NO ACTION in
 * Drizzle, four stage progress columns were NOT NULL only in Drizzle, three webhook delivery indexes existed only in
 * Drizzle and twenty-two indexes (fourteen unique) only in the database.
 *
 * The check compares the current (migrated) schema with the Drizzle tables: every matched foreign key's ON DELETE, every
 * column's nullability, every index by table and name (uniqueness, partial or not, and the column list of an index on plain
 * columns; an index on SQL, such as an expression or a column with its operator class, is matched by name only), every
 * database index that backs no constraint, and every unique constraint. Tables that exist only in the database are listed
 * below with their reason. A unique index or NOT NULL that a migration builds only on clean data is part of the clean test
 * schema, so it is declared; a database where it was left out lists it in the health check (conditional_constraints_missing).
 */

/** Database tables that Drizzle does not declare, on purpose */
export const DATABASE_ONLY_TABLES: ReadonlyArray<{ table: string; reason: string }> = [
  { table: '_repair_0011_timestamps_backup', reason: 'migration 0011 keeps the timestamps it repaired; read only by hand' },
  { table: 'items_stocks_archive', reason: 'migration 0021 archived the dropped items.stocks values (TD-214); read only by hand' },
];

type Row = Record<string, unknown>;
const rows = async (q: SQL) => (await orm.execute(q)).rows as Row[];

function drizzleTables() {
  const out = new Map<string, ReturnType<typeof getTableConfig>>();
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) out.set(getTableConfig(value).name, getTableConfig(value));
  }
  return out;
}

/** Every difference between the Drizzle tables and the current schema */
export async function schemaDrift(): Promise<string[]> {
  const problems: string[] = [];
  const tables = drizzleTables();

  const dbTables = new Set((await rows(sql`SELECT table_name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`)).map(r => String(r.table_name)));
  const dbOnlyAllowed = new Set(DATABASE_ONLY_TABLES.map(t => t.table));
  for (const t of tables.keys()) if (!dbTables.has(t)) problems.push(`table ${t} is declared in Drizzle but missing in the database`);
  for (const t of dbTables) {
    if (!tables.has(t) && !dbOnlyAllowed.has(t) && !t.startsWith('__')) problems.push(`table ${t} exists only in the database`);
  }

  // foreign keys: ON DELETE of every reference that has a constraint
  const dbFks = await databaseForeignKeys();
  for (const d of declaredForeignKeys()) {
    const c = dbFks.get(d.key);
    if (c && c.onDelete !== d.onDelete) problems.push(`${d.key} is ON DELETE ${d.onDelete} in Drizzle but ${c.onDelete} in the database (${c.name})`);
  }

  // nullability
  const columns = await rows(sql`SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema()`);
  const nullable = new Map(columns.map(r => [`${r.table_name}.${r.column_name}`, r.is_nullable === 'YES']));
  for (const [t, cfg] of tables) {
    for (const c of cfg.columns) {
      const key = `${t}.${c.name}`;
      if (!nullable.has(key)) problems.push(`column ${key} is declared in Drizzle but missing in the database`);
      else if (c.notNull === nullable.get(key)) problems.push(`column ${key} is ${c.notNull ? 'NOT NULL' : 'nullable'} in Drizzle but ${c.notNull ? 'nullable' : 'NOT NULL'} in the database`);
    }
  }

  // indexes by table and name
  const dbIndexes = await rows(sql`
    SELECT t.relname AS tbl, i.relname AS name, x.indisunique AS uniq, x.indisprimary AS pk, x.indpred IS NOT NULL AS partial,
      x.indexprs IS NOT NULL AS expr, EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid) AS backs_constraint,
      (SELECT string_agg(a.attname, ',' ORDER BY k.n) FROM unnest(x.indkey) WITH ORDINALITY k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum) AS cols
    FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.relnamespace = current_schema()::regnamespace`);
  const dbIndex = new Map(dbIndexes.map(r => [`${r.tbl}.${r.name}`, r]));
  const declaredIndex = new Set<string>();
  for (const [t, cfg] of tables) {
    for (const index of cfg.indexes) {
      const c = index.config;
      const key = `${t}.${c.name}`;
      declaredIndex.add(key);
      const db = dbIndex.get(key);
      if (!db) { problems.push(`index ${key} is declared in Drizzle but missing in the database`); continue; }
      if (db.uniq !== c.unique) problems.push(`index ${key} is ${c.unique ? 'unique' : 'not unique'} in Drizzle but ${db.uniq ? 'unique' : 'not unique'} in the database`);
      if (db.partial !== Boolean(c.where)) problems.push(`index ${key} is ${c.where ? 'partial' : 'not partial'} in Drizzle but ${db.partial ? 'partial' : 'not partial'} in the database`);
      const plain = c.columns.every(col => col && !is(col, SQL) && 'name' in col);
      const cols = plain ? c.columns.map(col => (col as { name: string }).name).join(',') : null;
      if (cols !== null && !db.expr && db.cols !== cols) problems.push(`index ${key} is on (${cols}) in Drizzle but on (${String(db.cols)}) in the database`);
    }
  }
  for (const [key, db] of dbIndex) {
    const t = key.slice(0, key.indexOf('.'));
    if (!tables.has(t) || db.pk || db.backs_constraint) continue;
    if (!declaredIndex.has(key)) problems.push(`index ${key} exists only in the database`);
  }

  // unique constraints, matched by name (a Drizzle unique index of that name counts) or by column set
  const dbUnique = await rows(sql`
    SELECT t.relname AS tbl, c.conname AS name,
      (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)) AS cols
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'u' AND c.connamespace = current_schema()::regnamespace`);
  const declaredUnique = new Set<string>();
  for (const [t, cfg] of tables) {
    for (const c of cfg.columns) if (c.isUnique) declaredUnique.add(`${t}:${c.name}`);
    for (const u of cfg.uniqueConstraints) declaredUnique.add(`${t}:${u.columns.map(col => col.name).sort().join(',')}`);
  }
  const dbUniqueKeys = new Set(dbUnique.map(r => `${r.tbl}:${r.cols}`));
  for (const u of declaredUnique) {
    const [t, cols] = u.split(':');
    const asIndex = dbIndexes.some(r => r.tbl === t && r.uniq && !r.partial && !r.expr && String(r.cols).split(',').sort().join(',') === cols);
    if (!dbUniqueKeys.has(u) && !asIndex) problems.push(`unique (${cols}) on ${t} is declared in Drizzle but missing in the database`);
  }
  for (const r of dbUnique) {
    const t = String(r.tbl);
    if (!tables.has(t)) continue;
    if (!declaredUnique.has(`${t}:${r.cols}`) && !(declaredIndex.has(`${t}.${r.name}`) && dbIndex.get(`${t}.${r.name}`)?.uniq)) {
      problems.push(`unique constraint ${r.name} on ${t} (${r.cols}) exists only in the database`);
    }
  }
  return problems;
}

async function scenario(): Promise<string> {
  const problems: string[] = await schemaDrift();
  assertNoProblems(problems);

  // a database whose stage progress holds a NULL title: 0092 leaves the column nullable and the health check lists it
  const admin = await sandboxAdminClient();
  const name = 'nn_project_product_stage_progress_stage_title';
  await orm.execute(sql`ALTER TABLE project_product_stage_progress ALTER COLUMN stage_title DROP NOT NULL`);
  const [project] = await rows(sql`INSERT INTO production_projects (project_code, title) VALUES (${`TD613-${Date.now()}`}, 'TD-613') RETURNING id`);
  const [item] = await rows(sql`INSERT INTO items (type, name, code, unit) VALUES ('product', ${`TD613 item ${Date.now()}`}, ${`TD613-${Date.now()}`}, 'عدد') RETURNING id`);
  await orm.execute(sql`INSERT INTO project_product_stage_progress (project_id, item_id, stage_order, stage_title)
    VALUES (${Number(project.id)}, ${Number(item.id)}, 1, NULL)`);
  const listed = (await findMissingConditionalConstraints()).find(e => e.name === name);
  if (!listed || listed.state !== 'blocked' || listed.blockers !== 1 || listed.kind !== 'not_null') problems.push(`the nullable column is listed as ${JSON.stringify(listed ?? null)}`);
  const blocked = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (!JSON.stringify(blocked.body?.blocked ?? []).includes(name)) problems.push(`the build over the NULL row answered ${JSON.stringify(blocked.body).slice(0, 200)}`);
  await orm.execute(sql`UPDATE project_product_stage_progress SET stage_title = '' WHERE project_id = ${Number(project.id)}`);
  const built = await admin.post('/api/system/conditional-constraints/build', { apply: true });
  if (!JSON.stringify(built.body?.built ?? []).includes(name)) problems.push(`the build after the fix answered ${JSON.stringify(built.body).slice(0, 200)}`);
  const [col] = await rows(sql`SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'project_product_stage_progress' AND column_name = 'stage_title'`);
  if (col?.is_nullable !== 'NO') problems.push('stage_title is still nullable after the build');
  if ((await findMissingConditionalConstraints()).some(e => e.name === name)) problems.push('the column is still listed after the build');

  assertNoProblems(problems);
  return 'the Drizzle tables match the migrated schema (foreign key actions, nullability, indexes, unique constraints); a column left nullable over a NULL row was listed and made NOT NULL after the fix';
}

export async function runSchemaDriftTests(shouldRun: ShouldRun): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  const id = 'reg_schema_drift_td_613';
  if (shouldRun(id, 'TD-613', 'B01-33')) {
    await runCase(results, id, 'v9.0.434: the Drizzle schema matches the migrated database, so drizzle-kit would drop or rebuild nothing (TD-613)',
      () => inFiscalSandbox(scenario));
  }
  return results;
}
