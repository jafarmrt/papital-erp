import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { unqualifiedMigrationLookups } from '../setup/migrationSchemaQualification';

// v9.0.394 (TD-590, B01-10): a migration never drops a schema object by an unqualified name with IF EXISTS. The name was
// looked up along the search path, and an isolated test schema (search path test schema, public) dropped the object of
// the same name in `public`; 0007 dropped public.idx_idemp_user_scope_key, after which every idempotent POST failed.
// v9.0.395 (TD-610, B01-30): an existence check on a catalog restricts its own schema. The catalogs hold every schema, so a
// constraint, index or trigger of the same name in `public` or in another test schema made the migration skip it.

const folder = path.join(process.cwd(), 'drizzle');
const migrationFiles = fs.readdirSync(folder).filter(f => f.endsWith('.sql')).sort();

describe('migration schema qualification scanner', () => {
  it('flags a DROP ... IF EXISTS of an unqualified name', () => {
    const sql = [
      'DROP INDEX IF EXISTS idx_a;',
      'DROP INDEX CONCURRENTLY IF EXISTS idx_b;',
      "EXECUTE 'DROP INDEX IF EXISTS uq_c';",
      'DROP TABLE IF EXISTS old_table;',
      'DROP FUNCTION IF EXISTS some_fn(text);',
      'drop sequence if exists some_seq;',
      'DROP MATERIALIZED VIEW IF EXISTS some_view;',
    ].join('\n');
    expect(unqualifiedMigrationLookups(sql).map(f => f.object)).toEqual(['idx_a', 'idx_b', 'uq_c', 'old_table', 'some_fn', 'some_seq', 'some_view']);
  });

  it('accepts a name in the current schema, a temporary object and a table-scoped drop', () => {
    const sql = [
      "EXECUTE format('DROP INDEX IF EXISTS %I.idx_a', current_schema());",
      'DROP FUNCTION IF EXISTS pg_temp.helper(jsonb);',
      'DROP TRIGGER IF EXISTS trg_x ON items;',
      'ALTER TABLE items DROP CONSTRAINT IF EXISTS chk_x;',
      '-- DROP INDEX IF EXISTS idx_in_a_comment;',
    ].join('\n');
    expect(unqualifiedMigrationLookups(sql)).toEqual([]);
  });
});

describe('migration schema qualification scanner (TD-610)', () => {
  it('flags a catalog existence check without its schema and a bare to_regclass check', () => {
    const sql = [
      "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_a') THEN",
      "IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_b') THEN",
      "IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_c') THEN",
      "IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='t' AND column_name='c') THEN",
      "IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'seq_d') THEN",
      "IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_e') THEN",
      "IF to_regclass('uq_f') IS NULL THEN",
    ].join('\n');
    expect(unqualifiedMigrationLookups(sql).map(f => `${f.kind} ${f.object}`)).toEqual([
      'catalog pg_constraint', 'catalog pg_indexes', 'catalog pg_trigger', 'catalog information_schema.columns',
      'catalog pg_class', 'catalog pg_proc', 'regclass uq_f',
    ]);
  });

  it('accepts a check on its own schema or on a table it names', () => {
    const sql = [
      "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_a' AND connamespace = current_schema()::regnamespace) THEN",
      "IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_b' AND conrelid = 'items'::regclass) THEN",
      "IF NOT EXISTS (\n  SELECT 1 FROM pg_constraint WHERE conname = rule.name AND conrelid = to_regclass(rule.tbl)\n) THEN",
      "IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_c' AND schemaname = current_schema()) THEN",
      "IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_d' AND tgrelid = 'users'::regclass) THEN",
      "IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='t' AND column_name='c' AND table_schema = current_schema()) THEN",
      "IF to_regclass(format('%I.%I', current_schema(), 'uq_e')) IS NULL THEN",
      "SELECT 1 FROM pg_constraint WHERE conname = 'fk_f' AND conrelid = to_regclass('accounts');",
    ].join('\n');
    expect(unqualifiedMigrationLookups(sql)).toEqual([]);
  });
});

describe('repository migrations (TD-590, TD-610)', () => {
  const found = (kinds: string[]) => migrationFiles.flatMap(file =>
    unqualifiedMigrationLookups(fs.readFileSync(path.join(folder, file), 'utf8'))
      .filter(f => kinds.includes(f.kind))
      .map(f => `${file}:${f.line} ${f.text}`));

  it('drop no schema object by an unqualified name', () => {
    expect(found(['drop'])).toEqual([]);
  });

  it('check the existence of an object only in their own schema', () => {
    expect(found(['catalog', 'regclass'])).toEqual([]);
  });
});
