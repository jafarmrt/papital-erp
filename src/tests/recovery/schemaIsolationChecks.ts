import { pool } from '../../db/drizzle.js';
import { setupTestSchema } from '../setup/testDb.js';

/**
 * v9.0.394 (TD-590, B01-10): building an isolated test schema never touches `public`. The migrations run there with the
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
