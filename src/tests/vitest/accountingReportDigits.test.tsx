import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const { fetchJson, toastFn } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));

import { PartyLedgerReportView } from '../../components/accounting/reports/PartyLedgerReportView';
import { JournalBookView } from '../../components/accounting/reports/JournalBookView';
import { FinancialRatiosView } from '../../components/accounting/reports/FinancialRatiosView';
import type { FinancialRatiosReport } from '../../types';
import type { JournalBookReport } from '../../lib/accounting/journalBook';

// v9.0.272 (TD-580, B03-38): accounting reports showed Latin digits («#11», «2 سند»), raw currency codes («USD»,
// «ریال (IRR)») and took today from the browser's UTC day (`new Date().toISOString()` /
// `toLocaleDateString('fa-IR')`), so a statement printed at 01:00 Tehran carried yesterday's date.

const party = { id: 7, name: 'سارا احمدی', partyType: 'customer', phone: '09121234567', city: 'اصفهان' };
const ledger = {
  party, openingBalance: 0, openingBalanceType: 'بی‌حساب', totalDebit: 12_500_000, totalCredit: 0,
  finalBalance: 12_500_000, finalBalanceType: 'بدهکار', netStatusText: 'بدهکار', currency: 'IRR', startDate: null, endDate: null,
  items: [{ rowNumber: 1, voucherId: 3, voucherNumber: 31, date: '2026-09-28', description: 'فاکتور فروش', accountCode: '1201', accountName: 'دریافتنی تجاری', currency: 'IRR', debit: 12_500_000, credit: 0, runningBalance: 12_500_000, balanceType: 'بدهکار' }],
};

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => (url.startsWith('/accounting/reports/parties') ? { data: [party] } : ledger));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T21:30:00Z')); // 01:00 on 1405/07/15 in Tehran, still 2026-10-06 in UTC
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('accounting report digits, currency names and today (TD-580)', () => {
  it('the party statement prints and exports the business day, and offers currencies by name', async () => {
    renderWithClient(<PartyLedgerReportView initialPartyId={7} />);
    await screen.findByText('صورت‌حساب مالی طرف‌حساب');
    const issued = screen.getByText(/تاریخ صدور گزارش:/).textContent ?? '';
    expect(issued).toContain('۱۴۰۵/۰۷/۱۵');

    const options = Array.from(screen.getByDisplayValue('همه ارزها').querySelectorAll('option')).map(o => o.textContent);
    expect(options).toEqual(['همه ارزها', 'ریال', 'دلار', 'یورو', 'درهم', 'پوند']);

    let downloaded = '';
    let csv = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.getAttribute('download') ?? ''; });
    const OriginalBlob = globalThis.Blob;
    vi.stubGlobal('Blob', class extends OriginalBlob { constructor(parts: BlobPart[], opts?: BlobPropertyBag) { super(parts, opts); csv = String(parts[0]); } });
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    await act(async () => { fireEvent.click(screen.getByText(/خروجی اکسل/)); });
    await waitFor(() => expect(downloaded).not.toBe(''));
    vi.unstubAllGlobals();
    expect(downloaded).toBe('صورت_حساب_سارا_احمدی_1405-07-15.csv');
    expect(csv).toContain('تاریخ صدور گزارش: ۱۴۰۵/۰۷/۱۵');
  });

  it('the journal book shows the voucher number in Persian digits', () => {
    const report = {
      items: [{ rowNumber: 1, voucherId: 2, voucherNumber: 11, date: '2026-04-02', voucherType: 'sales', accountCode: '1201', accountName: 'دریافتنی تجاری', accountLevel: 'subsidiary', currency: 'IRR', description: 'فروش', debit: 5_000, credit: 0, runningBalance: 5_000 }],
      totalDebit: 5_000, totalCredit: 5_000, reportCurrency: 'IRR', vouchersCount: 1, isBalanced: true, total: 1, page: 1, limit: 200,
    } as unknown as JournalBookReport;
    const { container } = render(<JournalBookView journalLoading={false} journalBookData={report} onFetchJournalBook={() => {}} onPageChange={() => {}} />);
    const cells = Array.from(container.querySelectorAll('td')).map(td => td.textContent);
    expect(cells).toContain('۱۱');
    expect(cells.some(t => /#\d/.test(t ?? ''))).toBe(false);
  });

  it('the ratios name each currency and count vouchers in Persian digits', () => {
    const report = {
      currentRatio: 1, quickRatio: 1, cashRatio: 1, netWorkingCapital: 0, debtRatio: 0, debtToEquityRatio: 0, equityRatio: 1,
      grossProfitMargin: 0, netProfitMargin: 0, returnOnAssets: 0, returnOnEquity: 0, assetTurnover: 0, receivablesTurnover: 0,
      inventoryTurnover: 0, inventoryTurnoverDays: 0, healthScore: 80,
      currencyBreakdowns: [{ currency: 'USD', vouchersCount: 12, totalDebit: 3_000, totalCredit: 1_000, netBalance: 2_000 }],
    } as unknown as FinancialRatiosReport;
    const { container } = render(<FinancialRatiosView ratiosData={report} onFetchFinancialRatios={() => {}} />);
    const text = container.textContent ?? '';
    for (const name of ['ریال', 'دلار', 'یورو', 'درهم', 'پوند']) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\b(?:IRR|USD|EUR|AED|GBP)\b/);
    expect(text).toContain('۱۲ سند');
    expect(text).toContain('۲٬۰۰۰ دلار');
  });

  it('no accounting report takes today from the browser clock', () => {
    const root = join(__dirname, '..', '..');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : (/\.tsx?$/.test(n) ? [p] : []);
    });
    const files = [...walk(join(root, 'components/accounting')), join(root, 'pages/AccountingPage.tsx')]
      .filter(f => !/[/\\](?:treasury|reconciliation)[/\\]|ChequesTab\.tsx$|BankAndTreasuryTab\.tsx$/.test(f));
    const offenders = files.flatMap(f => readFileSync(f, 'utf8').split('\n')
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /new Date\(\)\.(?:toISOString|toLocaleDateString)\(/.test(l))
      .map(({ l, i }) => `${relative(root, f)}:${i + 1}: ${l.trim()}`));
    expect(offenders).toEqual([]);
  });
});
