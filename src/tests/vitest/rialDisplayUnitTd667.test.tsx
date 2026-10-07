import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const settings = vi.hoisted(() => ({ currency: 'IRR' }));
vi.mock('../../hooks/queries/useSettingsQueries', () => ({
  useSettingsQuery: () => ({ data: [{ key: 'currency', value: settings.currency }] })
}));

import { PieceworkStatsCards } from '../../components/piecework/PieceworkStatsCards';
import { normalizeRialDisplayUnit, rialDisplayOf } from '../../lib/rialDisplay';
import { formatCurrencyLabel } from '../../utils';

afterEach(cleanup);

describe('TD-667 the currency setting is the display unit of rial amounts (decision t1)', () => {
  it('25,000,000 rial shows as 2,500,000 toman with TOMAN and as rial with a legacy USD setting', () => {
    expect(rialDisplayOf('TOMAN').amount(25_000_000)).toBe('۲٬۵۰۰٬۰۰۰ تومان');
    expect(rialDisplayOf('IRR').amount(25_000_000)).toBe('۲۵٬۰۰۰٬۰۰۰ ریال');
    expect(rialDisplayOf('USD').amount(25_000_000)).toBe('۲۵٬۰۰۰٬۰۰۰ ریال');
    expect(rialDisplayOf('TOMAN').amount(125)).toBe('۱۲٫۵ تومان');
    expect(normalizeRialDisplayUnit('تومان')).toBe('TOMAN');
    expect(formatCurrencyLabel('TOMAN')).toBe('تومان');
  });

  it('a record with its own foreign currency keeps it; a rial record follows the display unit', () => {
    const toman = rialDisplayOf('TOMAN');
    expect(toman.money(12.5, 'USD')).toBe('۱۲٫۵ دلار');
    expect(toman.money(1_000_000, 'IRR')).toBe('۱۰۰٬۰۰۰ تومان');
    expect(toman.money(1_000_000, '')).toBe('۱۰۰٬۰۰۰ تومان');
  });

  it('a payroll card under the TOMAN setting shows toman values with the toman label', () => {
    settings.currency = 'TOMAN';
    render(<PieceworkStatsCards totalLoggedAmount={25_000_000} pendingLoggedAmount={0} payrollsCount={0} tasksCount={0} />);
    expect(screen.getByText('۲٬۵۰۰٬۰۰۰ تومان')).toBeTruthy();
    cleanup();
    settings.currency = 'USD';
    render(<PieceworkStatsCards totalLoggedAmount={25_000_000} pendingLoggedAmount={0} payrollsCount={0} tasksCount={0} />);
    expect(screen.getByText('۲۵٬۰۰۰٬۰۰۰ ریال')).toBeTruthy();
    settings.currency = 'IRR';
  });

  it('no component labels or formats an amount with the setting itself (ratchet at zero)', () => {
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'tests') walk(path);
        } else if (/\.tsx?$/.test(name)) {
          const text = readFileSync(path, 'utf8');
          const bad = /formatCurrencyLabel\(\s*appCurrency|formatPersianPrice\([^;\n]*,\s*appCurrency\s*\)|currency=\{appCurrency\}|\|\|\s*appCurrency/;
          if (bad.test(text)) offenders.push(relative(root, path));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
