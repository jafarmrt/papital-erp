// @vitest-environment node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { AMENDED_MIGRATIONS, previousMigrationHashes } from '../../db/migrationAmendments';
import { planMigrations, validateMigrationJournal, type MigrationJournalEntry } from '../../db/migrationPlan';

/**
 * v8.0.81 (TD-364): مهاجرت‌گر Drizzle مهاجرتی را که `when` آن از آخرین مهاجرت اجراشده کوچک‌تر است بی‌صدا رد
 * می‌کند. برنامه‌ریز مهاجرت این حالت را خطا می‌داند و دفتر مهاجرت مخزن باید همیشه از این قاعده پیروی کند.
 */
const entry = (idx: number, when: number, hash = `h${idx}`): MigrationJournalEntry => ({
  idx, tag: `${String(idx).padStart(4, '0')}_m${idx}`, when, hash,
});

describe('migration plan (TD-364)', () => {
  const journal = [entry(0, 1000), entry(1, 2000), entry(2, 3000)];

  it('applies everything on an empty database', () => {
    expect(planMigrations(journal, [])).toEqual({ pending: ['0000_m0', '0001_m1', '0002_m2'], errors: [], warnings: [] });
  });

  it('applies only migrations newer than the last applied one', () => {
    const plan = planMigrations(journal, [{ hash: 'h0', createdAt: 1000 }, { hash: 'h1', createdAt: 2000 }]);
    expect(plan).toEqual({ pending: ['0002_m2'], errors: [], warnings: [] });
  });

  it('refuses a migration older than the last applied one that never ran', () => {
    const late = [entry(0, 1000), entry(1, 2000), { ...entry(2, 1500) }];
    const plan = planMigrations(late, [{ hash: 'h0', createdAt: 1000 }, { hash: 'h1', createdAt: 2000 }]);
    expect(plan.errors.join(' ')).toContain('0002_m2');
    expect(plan.pending).toEqual([]);
  });

  it('refuses a database that ran migrations newer than this build', () => {
    const plan = planMigrations(journal, [{ hash: 'h0', createdAt: 1000 }, { hash: 'h1', createdAt: 2000 }, { hash: 'h2', createdAt: 3000 }, { hash: 'x', createdAt: 4000 }]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain('newer than this build');
  });

  it('only warns when an applied migration file changed afterwards', () => {
    const plan = planMigrations(journal, [{ hash: 'h0', createdAt: 1000 }, { hash: 'edited', createdAt: 2000 }]);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join(' ')).toContain('0001_m1');
    expect(plan.pending).toEqual(['0002_m2']);
  });

  it('does not warn about a migration amended on purpose after release (TD-368)', () => {
    const amended = new Map([['0001_m1', ['old-text']]]);
    expect(planMigrations(journal, [{ hash: 'h0', createdAt: 1000 }, { hash: 'old-text', createdAt: 2000 }], amended).warnings).toEqual([]);
    expect(planMigrations(journal, [{ hash: 'h0', createdAt: 1000 }, { hash: 'other', createdAt: 2000 }], amended).warnings).toHaveLength(1);
  });

  it('rejects a journal whose when is not strictly increasing or whose tags do not match', () => {
    expect(validateMigrationJournal([entry(0, 1000), entry(1, 1000)])).toHaveLength(1);
    expect(validateMigrationJournal([entry(0, 1000), { ...entry(1, 2000), tag: '0002_x' }])).toHaveLength(1);
  });
});

describe('repository migration journal (TD-364)', () => {
  const folder = path.join(process.cwd(), 'drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string; when: number }> };

  it('has strictly increasing when values and matching tags', () => {
    expect(validateMigrationJournal(journal.entries.map(e => ({ ...e, hash: '' })))).toEqual([]);
  });

  it('lists only existing migrations whose text really changed as amended (TD-368)', () => {
    for (const [tag, hashes] of previousMigrationHashes()) {
      expect(journal.entries.map(e => e.tag)).toContain(tag);
      const current = crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, `${tag}.sql`)).toString()).digest('hex');
      expect(hashes).not.toContain(current);
      expect(AMENDED_MIGRATIONS[tag].reason).not.toBe('');
    }
  });

  it('registers every SQL file and has a file for every entry', () => {
    const files = fs.readdirSync(folder).filter(f => f.endsWith('.sql')).map(f => f.replace(/\.sql$/, '')).sort();
    expect(journal.entries.map(e => e.tag).sort()).toEqual(files);
  });
});
