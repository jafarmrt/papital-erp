// @vitest-environment node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { AMENDED_MIGRATIONS, previousMigrationHashes } from '../../db/migrationAmendments';
import { foldSquashedHistory, planMigrations, validateMigrationJournal, type MigrationJournalEntry, type SquashedMigrationHistory } from '../../db/migrationPlan';
import { V10_MIGRATION_HISTORY } from '../../db/v10MigrationHistory';

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

/**
 * v11 (phase 4.1): the 136 series-10 migrations live on as one baseline file. A database that ran them all has the
 * baseline (the Drizzle migrator skips it, its when being the newest folded one); a database that ran only some of them
 * is older than v11.2 and refused before the baseline could run on its existing tables.
 */
describe('migrations folded into a baseline (v11 phase 4.1)', () => {
  const history: SquashedMigrationHistory = {
    baselineTag: '0000_base',
    lastVersion: '11.2',
    migrations: [['0000_a', 100, ['ha']], ['0001_b', 200, ['hb', 'hb-old']], ['0002_c', 300, ['hc']]],
  };
  const journal: MigrationJournalEntry[] = [
    { idx: 0, tag: '0000_base', when: 300, hash: 'hbase' },
    { idx: 1, tag: '0001_next', when: 400, hash: 'hnext' },
  ];
  const oldRows = [{ hash: 'ha', createdAt: 100 }, { hash: 'hb', createdAt: 200 }, { hash: 'hc', createdAt: 300 }];

  it('runs the baseline and everything after it on an empty database', () => {
    expect(planMigrations(journal, [], new Map(), history)).toEqual({ pending: ['0000_base', '0001_next'], errors: [], warnings: [] });
  });

  it('counts a database that ran every folded migration as having the baseline', () => {
    expect(planMigrations(journal, oldRows, new Map(), history)).toEqual({ pending: ['0001_next'], errors: [], warnings: [] });
    const later = [...oldRows, { hash: 'hnext', createdAt: 400 }];
    expect(planMigrations(journal, later, new Map(), history)).toEqual({ pending: [], errors: [], warnings: [] });
  });

  it('accepts an earlier text of an amended folded migration and only warns about an unknown one', () => {
    const amended = [oldRows[0], { hash: 'hb-old', createdAt: 200 }, oldRows[2]];
    expect(planMigrations(journal, amended, new Map(), history).warnings).toEqual([]);
    const edited = [oldRows[0], { hash: 'other', createdAt: 200 }, oldRows[2]];
    const plan = planMigrations(journal, edited, new Map(), history);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join(' ')).toContain('0001_b');
  });

  it('refuses a database that ran only some of the folded migrations, naming the version to update to first', () => {
    const plan = planMigrations(journal, oldRows.slice(0, 2), new Map(), history);
    expect(plan.pending).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain('2 of the 3');
    expect(plan.errors[0]).toContain('0002_c');
    expect(plan.errors[0]).toContain('11.2');
  });

  it('tells the baseline row of a fresh install from the newest folded migration by its hash', () => {
    const fresh = [{ hash: 'hbase', createdAt: 300 }];
    expect(foldSquashedHistory(journal, fresh, history)).toEqual({ applied: fresh, errors: [], warnings: [] });
    expect(planMigrations(journal, fresh, new Map(), history)).toEqual({ pending: ['0001_next'], errors: [], warnings: [] });
  });

  it('keeps a fresh install on the baseline after the baseline text changes (an amendment or other line endings)', () => {
    const fresh = [{ hash: 'hbase-before', createdAt: 300 }, { hash: 'hnext', createdAt: 400 }];
    const amended = new Map([['0000_base', ['hbase-before']]]);
    expect(planMigrations(journal, fresh, amended, history)).toEqual({ pending: [], errors: [], warnings: [] });
    expect(planMigrations(journal, fresh.slice(0, 1), amended, history)).toEqual({ pending: ['0001_next'], errors: [], warnings: [] });
    const unlisted = planMigrations(journal, fresh, new Map(), history);
    expect(unlisted.errors).toEqual([]);
    expect(unlisted.warnings.join(' ')).toContain('0000_base');
    expect(planMigrations(journal, [oldRows[2]], new Map(), history).errors.join(' ')).toContain('1 of the 3');
  });
});

describe('repository baseline (v11 phase 4.1)', () => {
  const folder = path.join(process.cwd(), 'drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string; when: number }> };
  const folded = V10_MIGRATION_HISTORY.migrations;

  it('starts the journal with the baseline at the when of the newest folded migration', () => {
    expect(journal.entries[0].tag).toBe(V10_MIGRATION_HISTORY.baselineTag);
    expect(journal.entries[0].when).toBe(folded[folded.length - 1][1]);
  });

  it('keeps the 136 series-10 migrations in order with their released hashes', () => {
    expect(folded).toHaveLength(136);
    expect(folded[0][0]).toBe('0000_v3_baseline');
    expect(folded[135][0]).toBe('0135_event_privacy_settings_notice');
    folded.forEach(([tag, when, hashes], i) => {
      expect(tag.startsWith(`${String(i).padStart(4, '0')}_`)).toBe(true);
      if (i > 0) expect(when).toBeGreaterThan(folded[i - 1][1]);
      expect(hashes.length).toBeGreaterThan(0);
      for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('lets no later migration share a when with a folded one', () => {
    const foldedWhens = new Set(folded.map(([, when]) => when));
    expect(journal.entries.slice(1).filter(e => foldedWhens.has(e.when))).toEqual([]);
  });
});
