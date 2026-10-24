import { describe, expect, expectTypeOf, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { LockedTreasuryBank, TreasuryBank, postTreasuryRow, reverseTreasuryRow } from '../../services/accounting/treasury/treasuryPosting';
import { sameTreasuryCurrency } from '../../lib/treasury/treasuryCurrency';

/**
 * 10.3 package 4 (10.2 backlog, review of #320): the shared treasury writers assumed their caller had locked the bank row.
 * The lock is now a type: `postTreasuryRow` and `reverseTreasuryRow` take only a `LockedTreasuryBank`, which only the lock
 * helpers of `treasuryPosting.ts` make, so a write without the bank lock does not compile (`npm run lint` checks the type
 * assertions below; Vitest checks that nothing else mints the type). Red on v10.3.18: the type did not exist.
 */
const ROOT = path.resolve(__dirname, '../../..');
const POSTING_FILE = 'src/services/accounting/treasury/treasuryPosting.ts';
// `x as LockedTreasuryBank`, `x as unknown as LockedTreasuryBank` and the angle-bracket cast `<LockedTreasuryBank>x`
const MINT = /\bas\s+(?:unknown\s+as\s+)?LockedTreasuryBank\b|<LockedTreasuryBank>\s*[\w(]/g;

function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' ? [] : productionFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('a treasury balance write takes a locked bank (10.3 package 4)', () => {
  it('the posting and the reversal accept a locked bank and refuse a plain row', () => {
    type PostBank = Parameters<typeof postTreasuryRow>[1];
    type ReverseBank = Parameters<typeof reverseTreasuryRow>[2];
    expectTypeOf<LockedTreasuryBank>().toExtend<PostBank>();
    expectTypeOf<LockedTreasuryBank>().toExtend<ReverseBank>();
    expectTypeOf<TreasuryBank>().not.toExtend<PostBank>();
    expectTypeOf<TreasuryBank>().not.toExtend<ReverseBank>();
    const plainRowIsRefused = (bank: TreasuryBank): PostBank => {
      // @ts-expect-error a bank row that was not read through a lock helper is not a locked bank
      const locked: PostBank = bank;
      return locked;
    };
    expect(typeof plainRowIsRefused).toBe('function');
  });

  it('only the treasury posting file turns a row into a locked bank', () => {
    const minted = productionFiles(path.join(ROOT, 'src')).flatMap(file => {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const text = fs.readFileSync(file, 'utf8');
      return [...text.matchAll(MINT)].map(m => `${rel}:${text.slice(0, m.index).split('\n').length}`);
    });
    expect(minted.length).toBeGreaterThan(0);
    expect(minted.filter(hit => !hit.startsWith(`${POSTING_FILE}:`))).toEqual([]);
  });

  it('the scan sees a cast elsewhere', () => {
    expect('const b = row as LockedTreasuryBank;'.match(MINT)).toHaveLength(1);
    expect('const b = row as unknown as LockedTreasuryBank;'.match(MINT)).toHaveLength(1);
    expect('const b = <LockedTreasuryBank>row;'.match(MINT)).toHaveLength(1);
    expect('async function f(): Promise<LockedTreasuryBank> {'.match(MINT)).toBeNull();
  });

  it('treasury currency codes compare whatever their case, an empty code being rial', () => {
    expect(sameTreasuryCurrency('irr', 'IRR')).toBe(true);
    expect(sameTreasuryCurrency(' usd ', 'USD')).toBe(true);
    expect(sameTreasuryCurrency(null, 'IRR')).toBe(true);
    expect(sameTreasuryCurrency('', 'irr')).toBe(true);
    expect(sameTreasuryCurrency('IRR', 'USD')).toBe(false);
    expect(sameTreasuryCurrency(undefined, 'EUR')).toBe(false);
  });
});
