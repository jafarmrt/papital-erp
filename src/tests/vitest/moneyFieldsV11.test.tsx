import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  fetchJson, newClient, ratesRow, resetServer, sentBody, server, thisYear, wrapperOf, writesTo, type FetchOpts,
} from './helpers/settingsServer';

/**
 * v11 (owner request 7 Aban 1405): every field that takes an amount is the shared number field, so it shows grouped
 * Persian digits while typing and refuses a misplaced «٬», and a rial amount shows its toman equivalent under the toman
 * display unit. The insurance wage cap and the tax brackets of the payroll rates settings were plain text boxes.
 */
const SHOWN = {
  wageCap: 'سقف ماهانه دستمزد مشمول بیمه (ریال)',
  bracketFrom: 'آغاز پله ۱',
  saveRates: /^ذخیره نرخ‌های سال/,
  groupedCap: '۱۵۰٬۰۰۰٬۰۰۰',
  capToman: 'معادل: ۱۵٬۰۰۰٬۰۰۰ تومان',
  misplaced: '۱۲٬۵',
  compactToman: 'معادل: ۲٬۵۰۰ تومان',
  employeeInsurance: 'درصد بیمه سهم کارگر',
} as const;

const displayUnit = vi.hoisted(() => ({ current: 'TOMAN' }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => displayUnit.current, useRialDisplay: () => rialDisplayOf(displayUnit.current) };
});
vi.mock('../../api', async () => {
  const { fetchJson: answer } = await import('./helpers/settingsServer');
  return { API_URL: '/api', fetchJson: (url: string, opts?: FetchOpts) => answer(url, opts), isAbortError: () => false };
});
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

const { RialDisplayProvider } = await import('../../contexts/RialDisplayContext');
const { PayrollStatutoryRatesTab } = await import('../../components/settings/PayrollStatutoryRatesTab');
const { FinancialAmountInput } = await import('../../components/common/FinancialAmountInput');

afterEach(() => {
  cleanup();
  fetchJson.mockClear();
  resetServer();
  displayUnit.current = 'TOMAN';
});

const SRC = join(process.cwd(), 'src');
const RATES = `/piecework/statutory-rates/${thisYear}`;

function productionSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'tests') productionSources(full, out);
    } else if (name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** each JSX element `<Tag …>` of a source with its text, up to the `>` that closes it outside any `{…}` */
function elementsOf(source: string, tag: string): Array<{ text: string; start: number; end: number }> {
  const found: Array<{ text: string; start: number; end: number }> = [];
  const opening = new RegExp(`<${tag}\\b`, 'g');
  for (let m = opening.exec(source); m; m = opening.exec(source)) {
    let depth = 0;
    let i = m.index;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    found.push({ text: source.slice(m.index, i + 1), start: m.index, end: i + 1 });
  }
  return found;
}

/**
 * Plain `<input>` boxes that take a decimal number. Each one left is not an amount (a count, a quantity that may be
 * typed as hours, a workflow setting) or is the shared field itself. The list only shrinks: a new amount field uses
 * `DecimalInput` or `FinancialAmountInput`.
 */
const PLAIN_DECIMAL_INPUTS: Record<string, number> = {
  'components/common/DecimalInput.tsx': 1,
  'components/common/FinancialAmountInput.tsx': 1,
  'components/inventory/AuditSheetCards.tsx': 1,
  'components/piecework/PieceworkLogModal.tsx': 2,
  'components/procurement/RequisitionDecimalInput.tsx': 1,
  'components/procurement/SplitOrderModal.tsx': 1,
  'components/workflow/WorkflowDesignerCanvas.tsx': 3,
};

describe('amount fields are the shared number fields (ratchet)', () => {
  it('no new plain text box takes a decimal number or names an amount; the list of the ones left only shrinks', () => {
    const counted: Record<string, number> = {};
    const named: string[] = [];
    for (const file of productionSources(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const input of elementsOf(source, 'input')) {
        if (/type="(checkbox|radio|file|hidden)"/.test(input.text)) continue;
        if (/inputMode=("decimal"|\{[^}]*decimal)|type="number"/.test(input.text)) {
          const key = relative(SRC, file).split('\\').join('/');
          counted[key] = (counted[key] ?? 0) + 1;
        }
        // a rial or toman amount named by the box itself (its accessible name or hint)
        if (/(aria-label|placeholder)=[^>]*(ریال|تومان)/.test(input.text)) named.push(relative(SRC, file));
      }
    }
    expect(counted).toEqual(PLAIN_DECIMAL_INPUTS);
    expect(named).toEqual([]);
  });

  it('a shared number field labelled in rial shows the toman equivalent under it', () => {
    const missing: string[] = [];
    for (const file of productionSources(SRC)) {
      const source = readFileSync(file, 'utf8');
      for (const field of elementsOf(source, 'DecimalInput')) {
        const before = source.slice(Math.max(0, field.start - 300), field.start);
        // the label above the field, not the field before it in the same row
        const lastLines = before.split('\n').slice(-4).join('\n');
        const previous = Math.max(lastLines.lastIndexOf('<DecimalInput'), lastLines.lastIndexOf('<RialEquivalent'));
        const label = previous < 0 ? lastLines : lastLines.slice(lastLines.indexOf('>', previous) + 1);
        const rialNamed = /ریال|RIAL_INPUT_UNIT|formatCurrencyLabel\('IRR'\)/.test(label + field.text);
        if (!rialNamed) continue;
        if (!/<RialEquivalent\b/.test(source.slice(field.end, field.end + 700))) {
          missing.push(`${relative(SRC, file)}:${source.slice(0, field.start).split('\n').length}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('the payroll rates settings take amounts in the shared rial field', () => {
  const renderRates = () => render(
    <RialDisplayProvider><PayrollStatutoryRatesTab /></RialDisplayProvider>,
    { wrapper: wrapperOf(newClient()) },
  );
  const cap = () => screen.getByLabelText(SHOWN.wageCap) as HTMLInputElement;
  const save = () => fireEvent.click(screen.getByText(SHOWN.saveRates));

  it('groups the insurance wage cap while typing, shows its toman equivalent and saves the plain number', async () => {
    server.rates = [ratesRow(thisYear, '7')];
    renderRates();
    await waitFor(() => expect(cap().matches(':disabled')).toBe(false));
    await waitFor(() => expect((screen.getByLabelText(SHOWN.employeeInsurance) as HTMLInputElement).value).not.toBe(''));
    fireEvent.change(cap(), { target: { value: '150000000' } });
    expect(cap().value).toBe(SHOWN.groupedCap);
    expect(screen.getByTestId('rial-equivalent').textContent).toBe(SHOWN.capToman);
    save();
    await waitFor(() => expect(writesTo(RATES, 'PUT')).toHaveLength(1));
    expect(sentBody(RATES, 'PUT', 0).insuranceWageCap).toBe('150000000');
  });

  it('a misplaced thousands separator in a tax bracket is an error and the rates are not saved', async () => {
    server.rates = [ratesRow(thisYear, '7')];
    renderRates();
    const from = () => screen.getByLabelText(SHOWN.bracketFrom) as HTMLInputElement;
    await waitFor(() => expect(from().matches(':disabled')).toBe(false));
    fireEvent.change(from(), { target: { value: SHOWN.misplaced } });
    expect(from().validity.valid).toBe(false);
    save();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(writesTo(RATES, 'PUT')).toHaveLength(0);
  });
});

describe('a compact or table amount field shows the toman equivalent of a rial amount', () => {
  const host = (node: ReactNode) => render(<RialDisplayProvider>{node}</RialDisplayProvider>);

  it('shows it under the toman display unit and not under rial, nor for a foreign currency', () => {
    host(<FinancialAmountInput variant="compact" value={25000} onChange={() => undefined} currency="IRR" />);
    expect(screen.getByTestId('rial-equivalent').textContent).toBe(SHOWN.compactToman);
    cleanup();
    host(<FinancialAmountInput variant="table" value={25000} onChange={() => undefined} currency="USD" />);
    expect(screen.queryByTestId('rial-equivalent')).toBeNull();
    cleanup();
    displayUnit.current = 'IRR';
    host(<FinancialAmountInput variant="table" value={25000} onChange={() => undefined} />);
    expect(screen.queryByTestId('rial-equivalent')).toBeNull();
  });

  it('a voucher row in another currency does not show a toman equivalent', () => {
    host(<FinancialAmountInput variant="table" value={25000} onChange={() => undefined} showTomanEquivalent={false} />);
    expect(screen.queryByTestId('rial-equivalent')).toBeNull();
  });
});
