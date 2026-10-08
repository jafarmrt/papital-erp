import fs from 'fs';
import path from 'path';
import { pool } from '../../db/drizzle.js';
import { setupTestSchema } from '../setup/testDb.js';

/**
 * v9.0.425 (TD-590, B01-10): building an isolated test schema never touches `public`. The migrations run there with the
 * search path `"<test schema>", public`; on v9.0.393 every DROP ... IF EXISTS of a name not yet in the test schema
 * dropped the object of the same name in `public` (0007 dropped public.idx_idemp_user_scope_key, after which every
 * idempotent POST of a development or staging database failed). The check puts an object of each dropped name in
 * `public`, builds a nested test schema and expects every one of them to survive.
 */
const PUBLIC_PROBE_TABLE = 'public.td590_probe';
const PUBLIC_PROBE_INDEXES = ['idx_idempotency_key', 'idx_idemp_user_scope_key', 'uq_documents_type_ref_number_active', 'idx_documents_project_id'];
const PUBLIC_PROBE_FUNCTIONS: Array<[signature: string, definition: string]> = [
  ['sync_item_current_stock()', 'RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$'],
  ['erp_backfill_item_warehouse_stocks(integer, text)', 'RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$'],
  ['_repair_jalali_to_gregorian(text)', 'RETURNS text LANGUAGE sql AS $$ SELECT $1 $$'],
];

async function exists(sql: string, param: string): Promise<boolean> {
  const r = await pool.query<{ ok: boolean }>(sql, [param]);
  return Boolean(r.rows[0]?.ok);
}

export async function checkTestSchemaKeepsPublic(): Promise<string[]> {
  const v: string[] = [];
  const cleanup = async () => {
    await pool.query(`DROP TABLE IF EXISTS ${PUBLIC_PROBE_TABLE}`);
    for (const [signature] of PUBLIC_PROBE_FUNCTIONS) await pool.query(`DROP FUNCTION IF EXISTS public.${signature}`);
  };
  await cleanup();
  try {
    await pool.query(`CREATE TABLE ${PUBLIC_PROBE_TABLE} (k text)`);
    for (const name of PUBLIC_PROBE_INDEXES) await pool.query(`CREATE INDEX ${name} ON ${PUBLIC_PROBE_TABLE} (k)`);
    for (const [signature, definition] of PUBLIC_PROBE_FUNCTIONS) await pool.query(`CREATE FUNCTION public.${signature} ${definition}`);

    const nested = await setupTestSchema();
    await nested.teardown();

    for (const name of PUBLIC_PROBE_INDEXES) {
      if (!(await exists('SELECT to_regclass($1) IS NOT NULL AS ok', `public.${name}`))) {
        v.push(`building an isolated test schema dropped the index public.${name}`);
      }
    }
    for (const [signature] of PUBLIC_PROBE_FUNCTIONS) {
      if (!(await exists('SELECT to_regprocedure($1) IS NOT NULL AS ok', `public.${signature}`))) {
        v.push(`building an isolated test schema dropped the function public.${signature}`);
      }
    }
  } finally {
    await cleanup();
  }
  return v;
}

/**
 * v9.0.426 (TD-610, B01-30): a test schema built beside a migrated one has every constraint, index and trigger the
 * migrations name. On v9.0.425 the catalog checks (`pg_constraint`, `pg_indexes`, `pg_trigger`, ... without a schema)
 * found the object in the suite's own schema and skipped it, and `to_regclass('<name>')` found it in `public`: the nested
 * schema lacked `chk_iws_current_stock_non_negative`, `uq_jv_voucher_number`, `uq_customers_name_active` and the `fk_*`
 * constraints of 0001 and 0005, among others. The check builds a nested schema while the suite's schema exists and an
 * index of each name a migration checks with `to_regclass` exists in `public`, then compares the two schemas.
 */
const REGCLASS_PROBE_TABLE = 'public.td610_probe';

/** Names a migration creates only when `to_regclass('<name>')` finds nothing */
function regclassCheckedNames(): string[] {
  const folder = path.join(process.cwd(), 'drizzle');
  const names = new Set<string>();
  for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql'))) {
    const text = fs.readFileSync(path.join(folder, file), 'utf8');
    for (const m of text.matchAll(/to_regclass\(\s*(?:format\('%I\.%I',\s*current_schema\(\),\s*)?'([a-z0-9_]+)'\s*\)?\s*\)\s+IS\s+NULL/gi)) names.add(m[1]);
  }
  return [...names].sort();
}

/** Words that occur in the migrations, so objects a test made in the suite's schema are left out of the comparison */
function migrationWords(): Set<string> {
  const folder = path.join(process.cwd(), 'drizzle');
  const words = new Set<string>();
  for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql'))) {
    for (const w of fs.readFileSync(path.join(folder, file), 'utf8').match(/[a-z_][a-z0-9_]*/gi) ?? []) words.add(w.toLowerCase());
  }
  return words;
}

async function namedObjects(schema: string): Promise<Set<string>> {
  const r = await pool.query<{ o: string }>(`
    SELECT 'constraint ' || conname AS o FROM pg_constraint WHERE connamespace = $1::text::regnamespace
    UNION SELECT 'index ' || indexname FROM pg_indexes WHERE schemaname::text = $1::text
    UNION SELECT 'trigger ' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relnamespace = $1::text::regnamespace AND NOT t.tgisinternal`, [schema]);
  return new Set(r.rows.map(row => row.o));
}

export async function checkNestedSchemaComplete(): Promise<string[]> {
  const v: string[] = [];
  const outer = (await pool.query<{ s: string }>('SELECT current_schema() AS s')).rows[0]?.s ?? 'public';
  const words = migrationWords();
  const expected = [...await namedObjects(outer)].filter(o => words.has(o.split(' ')[1]));
  if (expected.length < 100) v.push(`the suite's schema ${outer} holds only ${expected.length} objects named by the migrations; it is not migrated`);
  const probes = regclassCheckedNames();
  await pool.query(`DROP TABLE IF EXISTS ${REGCLASS_PROBE_TABLE}`);
  try {
    await pool.query(`CREATE TABLE ${REGCLASS_PROBE_TABLE} (k text)`);
    for (const name of probes) await pool.query(`CREATE INDEX ${name} ON ${REGCLASS_PROBE_TABLE} (k)`);
    const nested = await setupTestSchema();
    try {
      const inner = await namedObjects(nested.schema);
      for (const o of expected) if (!inner.has(o)) v.push(`the nested test schema lacks ${o}`);
      for (const name of probes) if (!inner.has(`index ${name}`)) v.push(`the nested test schema lacks index ${name} (found in public)`);
    } finally {
      await nested.teardown();
    }
  } finally {
    await pool.query(`DROP TABLE IF EXISTS ${REGCLASS_PROBE_TABLE}`);
  }
  return [...new Set(v)];
}
