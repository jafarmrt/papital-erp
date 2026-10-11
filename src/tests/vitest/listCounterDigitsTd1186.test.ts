// @vitest-environment node
/**
 * v10.0.132 (TD-1186): list counters print their counts in Persian digits. The user guide test found «نمایش 8 مورد» on
 * the parties list and «6 مورد انتخاب شده» in the shortcut settings window; the treasury table counted the same way.
 * Each place showed a bare number expression in JSX text, so the check reads the source.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('list_counter_persian_digits_td_1186', () => {
  it('the parties list, the shortcut window and the treasury table format their counts', () => {
    const bare: string[] = [];
    const checks: Array<[string, RegExp]> = [
      ['src/pages/CustomersPage.tsx', /\{customers\.length\}|\$\{totalItems\}/],
      ['src/components/dashboard/CustomizableShortcuts.tsx', /\{tempSelectedIds\.length\}/],
      ['src/components/accounting/treasury/TreasuryTransactionsTable.tsx', /\{pagedTransactions\.length\}|\{totalFilteredCount\}/],
    ];
    for (const [file, pattern] of checks) if (pattern.test(read(file))) bare.push(`${file}: ${pattern.source}`);
    expect(bare).toEqual([]);
  });
});
