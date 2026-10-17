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

  it('every file with a physical delete has its written reason, and every written file still deletes', () => {
    expect(Object.keys(baseline.hardDeletes ?? {}).sort()).toEqual(listed);
  });
});
