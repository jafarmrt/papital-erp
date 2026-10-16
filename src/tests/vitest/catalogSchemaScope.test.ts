import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { unqualifiedRegclassLookups, unscopedCatalogReads } from '../setup/catalogSchemaScope';

// TD-1266: a catalog read in the code restricts its own schema. The 10.0 closing run failed the TD-653 and TD-786 tests
// locally: they looked up an index and a constraint by name alone and also counted the stale `test_*` schemas of the test
// database.

/** Whole-database reads on purpose, each with its reason */
const WHOLE_DATABASE_READS: Record<string, string> = {
  // compares every sequence of a scratch database restored from a backup, which holds one schema
  'src/tests/recovery/deploySafetyChecks.ts': 'pg_sequences',
};

const ROOTS = ['src', 'scripts'];
const SKIP = new Set(['src/tests/vitest/catalogSchemaScope.test.ts', 'src/tests/vitest/migrationSchemaQualified.test.ts']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'changelogs') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('catalog schema scope scanner', () => {
  it('flags a catalog read by name alone', () => {
    const src = [
      "await q(`SELECT indexname FROM pg_indexes WHERE tablename = 'items' AND indexname = 'uq_a'`);",
      "await q('SELECT conname FROM pg_constraint WHERE conname = ANY($1)', [names]);",
      'await orm.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${t}`);',
      "await q(`SELECT c.relname FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid`);",
    ].join('\n');
    expect(unscopedCatalogReads('x.ts', src).map(r => r.catalog)).toEqual(['pg_indexes', 'pg_constraint', 'information_schema.columns', 'pg_class']);
  });

  it('accepts a read restricted to the current schema or to one table', () => {
    const src = [
      "await q(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_a'`);",
      "await q('SELECT conname FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND conname = $1');",
      "await q(`SELECT convalidated FROM pg_constraint WHERE conname = 'c' AND conrelid = to_regclass('items')`);",
      'await orm.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ${t}`);',
      "const note = 'pg_constraint is a catalog';",
    ].join('\n');
    expect(unscopedCatalogReads('x.ts', src)).toEqual([]);
  });

  it('no production, test or tool code reads a catalog without its schema', () => {
    const problems: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(process.cwd(), root))) {
        const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
        if (SKIP.has(rel)) continue;
        const allowed = WHOLE_DATABASE_READS[rel];
        for (const read of unscopedCatalogReads(rel, fs.readFileSync(file, 'utf8'))) {
          if (allowed && read.catalog === allowed) continue;
          problems.push(`${rel}:${read.line} ${read.catalog}: ${read.text}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
  it('flags a to_regclass lookup by a bare name and accepts one that names the current schema (OT-B-09)', () => {
    const src = [
      'await db.execute(sql`SELECT to_regclass(${INDEX}) IS NOT NULL AS present`);',
      "await q(`SELECT 1 FROM pg_constraint WHERE conname = 'c' AND conrelid = to_regclass('items')`);",
      "await db.execute(sql`SELECT to_regclass(format('%I.%I', current_schema(), ${INDEX}::text)) IS NOT NULL AS present`);",
      "await q(`SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass(format('%I.%I', current_schema(), 'items'))`);",
    ].join('\n');
    expect(unqualifiedRegclassLookups('x.ts', src).map(r => r.line)).toEqual([1, 2]);
  });

  it('no service looks a relation up with to_regclass by a bare name (OT-B-09)', () => {
    const problems: string[] = [];
    for (const file of sourceFiles(path.join(process.cwd(), 'src', 'services'))) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
      for (const read of unqualifiedRegclassLookups(rel, fs.readFileSync(file, 'utf8'))) problems.push(`${rel}:${read.line} ${read.text}`);
    }
    expect(problems).toEqual([]);
  });
});
