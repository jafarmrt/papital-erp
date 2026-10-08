import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { unqualifiedMigrationLookups } from '../setup/migrationSchemaQualification';

// v9.0.394 (TD-590, B01-10): a migration never drops a schema object by an unqualified name with IF EXISTS. The name was
// looked up along the search path, and an isolated test schema (search path test schema, public) dropped the object of
// the same name in `public`; 0007 dropped public.idx_idemp_user_scope_key, after which every idempotent POST failed.

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

describe('repository migrations (TD-590)', () => {
  it('drop no schema object by an unqualified name', () => {
    const found = migrationFiles.flatMap(file =>
      unqualifiedMigrationLookups(fs.readFileSync(path.join(folder, file), 'utf8'))
        .filter(f => f.kind === 'drop')
        .map(f => `${file}:${f.line} ${f.text}`));
    expect(found).toEqual([]);
  });
});
