// @vitest-environment node
/**
 * Package 1 (B01-45, owner rule t9): everything a terminal shows is English. The ratchet in
 * scripts/terminal-english-ratchet.ts counts the places that still print Persian, per file, against
 * terminal-english-baseline.json; no file may gain one and the baseline may only shrink.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  compareWithBaseline,
  countFileSites,
  countShellSites,
  currentState,
  type Baseline,
} from '../../../scripts/terminal-english-ratchet';

// a Persian word, built from code points so that this file holds no Persian text of its own
const FA = String.fromCodePoint(0x633, 0x644, 0x627, 0x645);

describe('terminal_english_ratchet_td_625: Persian terminal output may only shrink (B01-45)', () => {
  it('counts shell lines that print Persian, not comments', () => {
    const script = [
      `# ${FA} comment`,
      `echo "${FA}"`,
      `log "ok" # ${FA} trailing comment`,
      `die "${FA} #1"`,
      'echo "$#"',
    ].join('\n');
    expect(countShellSites(script)).toBe(2);
    expect(countShellSites(`<#\n${FA}\n#>\nWrite-Host "${FA}"`)).toBe(1);
  });

  it('counts console, logger and stream output with Persian, not comments or user-facing values', () => {
    const source = `
      // ${FA} in a comment
      console.log('${FA}');
      logger.warn({ message: \`\${x} ${FA}\` });
      process.stderr.write('${FA}');
      console.log('english only');
      res.status(422).json({ error: '${FA}' });
      const label = '${FA}';
    `;
    expect(countFileSites('src/services/x.ts', source)).toBe(3);
  });

  it('counts errors and failure lists only where they reach a terminal', () => {
    const source = `throw new ValidationError('${FA}'); violations.push('${FA}'); fail('${FA}'); items.push('${FA}');`;
    expect(countFileSites('scripts/x.ts', source)).toBe(3);
    expect(countFileSites('src/data/changelogs/seriesGuard.ts', source)).toBe(3);
    // in a service an error message is the user's message (sent in the HTTP body)
    expect(countFileSites('src/services/x.ts', source)).toBe(0);
  });

  it('counts test names of Vitest and of the runner, not test data', () => {
    const vitest = `describe('${FA}', () => { it.only('${FA}', () => {}); it('english', () => { expect(x).toBe('${FA}'); }); });`;
    expect(countFileSites('src/tests/vitest/x.test.ts', vitest)).toBe(2);
    const runner = `
      results.push(makeTestCase({ id: 'reg_td_1_x', name: '${FA}', layer: 'regression' }));
      const CASES = [['sec_td_2_y', '${FA}', fn, 'info']];
      record('int_td_3_z', '${FA}', true);
      const customer = { id: 7, name: '${FA}' };
      await createItem({ code: 'P01', name: '${FA}' });
    `;
    expect(countFileSites('src/tests/suites/x.ts', runner)).toBe(3);
  });

  it('ignores the changelog data files', () => {
    expect(countFileSites('src/data/changelogs/9.ts', `export const x = [{ title: '${FA}' }]; console.log('${FA}');`)).toBe(0);
  });

  it('rejects a grown count or a new file, and reports a shrunk count as a stale baseline', () => {
    const baseline: Baseline = { 'scripts/a.ts': 2, 'scripts/b.ts': 1 };
    expect(compareWithBaseline({ 'scripts/a.ts': 2, 'scripts/b.ts': 1 }, baseline)).toEqual({ errors: [], stale: [] });
    const grown = compareWithBaseline({ 'scripts/a.ts': 3, 'scripts/b.ts': 1, 'scripts/c.ts': 1 }, baseline);
    expect(grown.errors).toHaveLength(2);
    expect(grown.errors[0]).toMatch(/^scripts\/a\.ts: Persian terminal output 2 -> 3/);
    expect(compareWithBaseline({ 'scripts/a.ts': 1 }, baseline).stale).toEqual([
      'scripts/a.ts: Persian terminal output 2 -> 1',
      'scripts/b.ts: Persian terminal output 1 -> 0',
    ]);
  });

  it('matches terminal-english-baseline.json exactly: nothing grew and the baseline is not stale', () => {
    const baseline = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), BASELINE_FILE), 'utf8')) as Baseline;
    const { errors, stale } = compareWithBaseline(currentState(), baseline);
    expect(errors).toEqual([]);
    expect(stale).toEqual([]);
  });
});
