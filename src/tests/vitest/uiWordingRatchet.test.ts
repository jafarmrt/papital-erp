// @vitest-environment node
/**
 * v10.0.39 (TD-1168): user-facing text never says the forbidden loanwords of the glossary. The ratchet in
 * scripts/ui-wording-ratchet.ts counts, per browser source file, the string literals, template parts and JSX texts that
 * hold one of them, against ui-wording-baseline.json; no file may gain one and the baseline may only shrink.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILE,
  compareWithBaseline,
  countFileSites,
  currentState,
  type Baseline,
} from '../../../scripts/ui-wording-ratchet';

// the forbidden words, built from code points so that this file holds none of them
const SYSTEM = String.fromCodePoint(0x633, 0x6cc, 0x633, 0x62a, 0x645);
const CATALOG = String.fromCodePoint(0x6a9, 0x627, 0x62a, 0x627, 0x644, 0x648, 0x6af);
const FILTER = String.fromCodePoint(0x641, 0x6cc, 0x644, 0x62a, 0x631);
const DOUBLE = String.fromCodePoint(0x62f, 0x648, 0x628, 0x644);
const HA = String.fromCodePoint(0x647, 0x627);
const YEH = String.fromCodePoint(0x6cc);
const ZWNJ = '‌';

describe('ui_wording_ratchet_td_1168', () => {
  it('counts string literals, template parts and JSX text, never comments', () => {
    const source = [
      `// ${SYSTEM} in a comment`,
      `/** ${CATALOG} in a doc comment */`,
      `const a = '${SYSTEM}';`,
      'const b = `x ${y} ' + `${FILTER}${HA}` + '`;',
      `const c = <span>${CATALOG}</span>;`,
    ].join('\n');
    expect(countFileSites(source, 'probe.tsx')).toBe(3);
  });

  it('matches the words with their suffixes but not a longer word that only starts with one', () => {
    expect(countFileSites(`const a = '${SYSTEM}${YEH}';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = '${FILTER}${ZWNJ}${HA}${YEH}';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = '${FILTER}${HA}:';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = 'x ${DOUBLE} y';`, 'a.ts')).toBe(1);
    expect(countFileSites(`const a = '${SYSTEM}${String.fromCodePoint(0x627, 0x62a, 0x6cc, 0x6a9)}';`, 'a.ts')).toBe(0);
  });

  it('fails when a file gains a site and reports a decrease separately', () => {
    const baseline: Baseline = { 'a.tsx': 1, 'b.tsx': 2 };
    expect(compareWithBaseline({ 'a.tsx': 2, 'b.tsx': 2 }, baseline).increased).toEqual(['a.tsx: 1 -> 2']);
    expect(compareWithBaseline({ 'a.tsx': 1, 'c.tsx': 1 }, baseline).increased).toEqual(['c.tsx: 0 -> 1']);
    expect(compareWithBaseline({ 'a.tsx': 1, 'b.tsx': 1 }, baseline).decreased).toEqual(['b.tsx: 2 -> 1']);
  });

  it('the source tree matches the committed baseline exactly', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), BASELINE_FILE), 'utf8')) as Baseline;
    const { increased, decreased } = compareWithBaseline(currentState(), baseline);
    expect(increased).toEqual([]);
    expect(decreased).toEqual([]);
  });

  it('the screens named by the user guide no longer show these words', () => {
    const state = currentState();
    for (const file of [
      'src/components/inventory/AuditConfirmSummaryModal.tsx',
      'src/components/InventoryRebuildModal.tsx',
      'src/components/inventory/Inventory3WayIntegrityTab.tsx',
      'src/pages/ReservedItemsReportPage.tsx',
      'src/components/procurement/ConfirmWarehouseDeliveryModal.tsx',
      'src/components/accounting/AccountingDashboard.tsx',
    ]) expect(state[file] ?? 0, file).toBe(0);
  });
});
