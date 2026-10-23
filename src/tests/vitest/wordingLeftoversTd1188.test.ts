// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeOverDeliveries } from '../../services/projects/projectDeliveryCap';

// TD-1188: wording left after TD-1168 / TD-1180 (fresh-eyes guide test Rc17): «سیستم» and «سرور» in three screens
// and Latin digits in the over-delivery message. v10.3.6 (owner rule): «سرور» is the word now, and «کارساز» is retired
// («خودکارسازی» stays).
const RETIRED_WORDS = [/سیستم/, /(?<!خود)کارساز/];
const SCREENS = [
  'src/components/accounting/ChequesTab.tsx',
  'src/components/accounting/FiscalYearClosingTab.tsx',
  'src/hooks/useServerDraft.ts',
];

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('wording_leftovers_td_1188: the guide test wording leftovers are gone', () => {
  it.each(SCREENS)('%s has no retired word in its text', file => {
    const text = withoutComments(readFileSync(file, 'utf8'));
    for (const word of RETIRED_WORDS) expect(word.test(text), `${file}: ${word.source}`).toBe(false);
  });
  it('the over-delivery message prints Persian digits', () => {
    const text = describeOverDeliveries([
      { itemId: 7, itemName: 'گردنبند', unit: 'عدد', planned: 5, delivered: 4, requested: 3, excess: 2.5 },
    ]);
    expect(text).not.toMatch(/[0-9]/);
    expect(text).toContain('۲٫۵');
  });
});
