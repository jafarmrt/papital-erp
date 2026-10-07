import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

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

// v9.0.229 (TD-572, B03-30): the party statement's print header wrote the form's currency and range over data loaded with
// other filters (12,500,000 rial printed as «12,500,000 دلار»), changing a filter did not reload, and «this month» / «this year»
// meant the last 30 / 365 days.

const party = { id: 7, name: 'سارا احمدی', partyType: 'customer', phone: '09121234567', city: 'اصفهان' };

/** the server's answer for the request: the balance is in the requested currency and the range is echoed back */
function ledgerFor(url: string) {
  const q = new URL(url, 'http://x').searchParams;
  const currency = q.get('currency') ?? 'IRR';
  const amount = currency === 'USD' ? 3_000 : 12_500_000;
  return {
    party, openingBalance: 0, openingBalanceType: 'بی‌حساب', totalDebit: amount, totalCredit: 0,
    finalBalance: amount, finalBalanceType: 'بدهکار', netStatusText: 'بدهکار', currency,
    startDate: q.get('startDate'), endDate: q.get('endDate'),
    items: [{ rowNumber: 1, voucherId: 3, voucherNumber: 31, date: '2026-09-28', description: 'فاکتور فروش', accountCode: '1201', accountName: 'دریافتنی تجاری', currency, debit: amount, credit: 0, runningBalance: amount, balanceType: 'بدهکار' }],
  };
}

const ledgerUrls = () => fetchJson.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('/accounting/reports/party-ledger'));
const lastLedgerQuery = () => new URL(ledgerUrls().at(-1) ?? '', 'http://x').searchParams;
const balanceText = () => screen.getByText('مانده خالص قطعی:').parentElement?.textContent ?? '';
const rangeText = () => screen.getByText(/بازه زمانی:/).textContent ?? '';

function renderView(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => (url.startsWith('/accounting/reports/parties') ? { data: [party] } : ledgerFor(url)));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T08:00:00Z')); // 1405/07/14 in Tehran
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('party statement print header and reload (TD-572)', () => {
  it('changing the currency reloads and the balance is labelled with the currency of the data shown', async () => {
    renderView(<PartyLedgerReportView initialPartyId={7} />);
    await screen.findByText('صورت‌حساب مالی طرف‌حساب');
    await waitFor(() => expect(balanceText()).toContain('۱۲,۵۰۰,۰۰۰ ریال'));
    expect(ledgerUrls()).toHaveLength(1);

    await act(async () => { fireEvent.change(screen.getByDisplayValue('همه ارزها'), { target: { value: 'USD' } }); });
    await waitFor(() => expect(ledgerUrls()).toHaveLength(2));
    expect(lastLedgerQuery().get('currency')).toBe('USD');
    await waitFor(() => expect(balanceText()).toContain('۳,۰۰۰ دلار'));
    expect(balanceText()).not.toContain('۱۲,۵۰۰,۰۰۰');
  });

  it('«this year» and «this month» start on the first day of the Jalali year and month, reload, and the header shows the loaded range', async () => {
    renderView(<PartyLedgerReportView initialPartyId={7} />);
    await screen.findByText('صورت‌حساب مالی طرف‌حساب');
    expect(rangeText()).toContain('ابتدای دوره الی امروز');

    await act(async () => { fireEvent.click(screen.getByText('سال جاری')); });
    await waitFor(() => expect(rangeText()).toContain('۱۴۰۵/۰۱/۰۱ الی ۱۴۰۵/۰۷/۱۴'));
    expect(lastLedgerQuery().get('startDate')).toBe('2026-03-21');
    expect(lastLedgerQuery().get('endDate')).toBe('2026-10-06');

    await act(async () => { fireEvent.click(screen.getByText('ماه جاری')); });
    await waitFor(() => expect(rangeText()).toContain('۱۴۰۵/۰۷/۰۱ الی ۱۴۰۵/۰۷/۱۴'));
    expect(lastLedgerQuery().get('startDate')).toBe('2026-09-23');
  });
});
