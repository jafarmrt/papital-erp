// @vitest-environment node
/**
 * v10.0.118 (TD-1183): admin screens print their counts in Persian digits and have no English placeholder. The user
 * guide test found «مجموع بخش‌ها: 14 سربرگ», «2 ستونی / 4 ستونی», «تعداد انبارهای فعال: 3», «100٪» and the
 * placeholders «e.g. user123» / «e.g. warehouse_assistant». Each of these places shows a bare number expression in JSX
 * text, so the check reads the source: the expression next to the word goes through a Persian number formatter.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('admin_screen_persian_digits_td_1183', () => {
  it('the counts of the settings panel, the trial balance and the stock integrity tab are formatted', () => {
    const bare: string[] = [];
    const checks: Array<[string, RegExp]> = [
      ['src/components/settings/SettingsNavigationSidebar.tsx', /\{totalMatchingTabs\}\s*سربرگ/],
      ['src/components/accounting/reports/TrialBalanceView.tsx', /\{(col|trialCols)\}\s*ستونی/],
      ['src/components/inventory/Inventory3WayIntegrityTab.tsx', /تعداد انبارهای فعال: \{integrityReport\?\.warehouses\?\.length \|\| 0\}/],
      ['src/components/inventory/Inventory3WayIntegrityTab.tsx', /\{integrityReport\?\.summary\?\.healthScorePercentage \?\? 100\}٪/],
    ];
    for (const [file, pattern] of checks) if (pattern.test(read(file))) bare.push(`${file}: ${pattern.source}`);
    expect(bare).toEqual([]);
  });

  it('the user and role forms have no English placeholder', () => {
    for (const file of ['src/components/users/UserFormModal.tsx', 'src/components/users/RoleFormModal.tsx']) {
      expect(read(file), file).not.toMatch(/placeholder="e\.g\./);
    }
  });
});
