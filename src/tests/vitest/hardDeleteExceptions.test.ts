// @vitest-environment node
/**
 * v10.1.65 (OBS-R2-15, decision ت۴۰ item 19): the physical deletes left in production code are the written exceptions of
 * scripts/ratchets/HARD_DELETES.md. The architecture ratchet counts them per file (metric hardDeletes) and only accepts
 * decreases; this test keeps the written list and the baseline equal, so a new file with a physical delete needs its
 * reason written down and a file that stopped deleting leaves the list.
 */
import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { countSource } from '../../../scripts/ratchets/architectureRatchet';

const baseline = JSON.parse(fs.readFileSync('scripts/ratchets/architecture-baseline.json', 'utf8')) as { hardDeletes?: Record<string, number> };
const listed = [...fs.readFileSync('scripts/ratchets/HARD_DELETES.md', 'utf8').matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1]).sort();

describe('hard_delete_exceptions_obs_r2_15', () => {
  it('counts a delete on a schema table and DELETE FROM text, never a Map delete or a comment', () => {
    const code = [
      "import { roles } from '../../db/schema.js';",
      'await tx.delete(roles).where(x);',
      'cache.delete(key);',
      '// tx.delete(roles) in a comment',
      "await pool.query('DELETE FROM roles WHERE id = $1', [id]);",
      'await tx.update(roles).set({ isDeleted: 1 });',
    ].join('\n');
    expect(countSource('src/services/x.ts', code).hardDeletes).toBe(2);
  });

  it('hard_delete_variable_table_and_truncate: a table held in a variable and TRUNCATE text count too, a CSS class does not', () => {
    const code = [
      'for (const entry of tables) await tx.delete(entry.table);',
      'await someDb.delete(table).returning({ id: x });',
      'seen.delete(id);',
      "await pool.query('TRUNCATE TABLE roles');",
      "await pool.query('truncate table roles');",
      'const css = "truncate max-w-[200px]";',
    ].join('\n');
    expect(countSource('src/services/x.ts', code).hardDeletes).toBe(4);
  });

  it('hard_delete_blind_spots_10_3: lower-case truncate in SQL text and a delete on another executor or table name count', () => {
    const code = [
      'await txExecutor.delete(workflowSteps);',
      'await this.db.delete(rows);',
      'await client.delete(entry.table);',
      'await writer.delete(targetTable);',
      "await pool.query('truncate roles restart identity');",
      'await tx.execute(sql`truncate ${roles}`);',
      "await tx.execute(sql.raw('truncate only roles'));",
      'listeners.delete(listener);',
      'pendingRef.current.delete(key);',
      'const css = "truncate font-medium";',
      'const label = `truncate ${name}`;',
    ].join('\n');
    expect(countSource('src/services/x.ts', code).hardDeletes).toBe(7);
  });

  it('every file with a physical delete has its written reason, and every written file still deletes', () => {
    expect(Object.keys(baseline.hardDeletes ?? {}).sort()).toEqual(listed);
  });
});
