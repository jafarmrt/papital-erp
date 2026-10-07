import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fetchJson, toastFn, confirmAction, perms } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t, confirmAction: vi.fn(), perms: { keys: [] as string[] } };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: (...a: unknown[]) => confirmAction(...a) }));
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => perms.keys.includes(key) }));

import { FiscalYearClosingTab } from '../../components/accounting/FiscalYearClosingTab';

function renderTab(ui: ReactNode = <FiscalYearClosingTab />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const preview = (year: number, yearEnded: boolean) => ({
  year, closingDate: '', openingDateNewYear: '', totalRevenues: 0, totalCostOfSales: 0, totalExpenses: 0,
  totalTemporaryDebit: 0, totalTemporaryCredit: 0, netProfit: 0, isProfit: true, temporaryAccounts: [], permanentAccounts: [],
  summaryVouchersPreview: [], draftVouchers: [], draftVoucherCount: 0, yearEnded,
});

/** GET /accounting/fiscal-closing/years on 1405/07/15: 1402 and 1403 open with vouchers, 1404 open; the oldest open year comes first */
const yearsInfo = {
  currentYear: 1405,
  years: [
    { year: 1402, status: 'open', hasVouchers: true, closedAt: null, closedBy: null },
    { year: 1403, status: 'open', hasVouchers: true, closedAt: null, closedBy: null },
    { year: 1404, status: 'open', hasVouchers: true, closedAt: null, closedBy: null },
  ],
  defaultYear: 1402,
  reopenableYear: null,
};

function server(options: { years?: unknown; yearEnded?: boolean; earlierOpenYears?: number[] } = {}) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/accounting/fiscal-closing/years') return options.years ?? yearsInfo;
    const m = /^\/accounting\/fiscal-closing\/preview\?year=(\d+)/.exec(url);
    if (m) return { ...preview(Number(m[1]), options.yearEnded ?? true), earlierOpenYears: options.earlierOpenYears ?? [] };
    if (url === '/accounting/fiscal-closing/reopen' && init?.method === 'POST') {
      return { success: true, year: 1403, message: 'سال مالی ۱۴۰۳ بازگشایی شد و ۴ سند بستن آن سال بی‌اثر شد.', voidedVouchers: [] };
    }
    return [];
  });
}

const previewUrls = () => fetchJson.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('/accounting/fiscal-closing/preview?'));
const executeButton = (year: string) => screen.findByText(`اجرای قطعی بستن سال مالی ${year}`) as Promise<HTMLButtonElement>;

beforeEach(() => { fetchJson.mockReset(); toastFn.success.mockReset(); toastFn.error.mockReset(); confirmAction.mockReset(); perms.keys = []; });
afterEach(() => { cleanup(); });

// v9.0.151 (TD-544, B03-02, product-owner decision t1 option A): years were closed out of order; closing 1397 with 1396 open
// closed 1396's revenue too.
describe('fiscal years close in order (TD-544)', () => {
  it('the form starts on the oldest open year with vouchers the server names', async () => {
    server();
    renderTab();
    await waitFor(() => expect(previewUrls()).toHaveLength(1));
    expect(previewUrls()[0]).toMatch(/^\/accounting\/fiscal-closing\/preview\?year=1402&/);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('1402');
  });

  it('a year with earlier open years with vouchers cannot be executed and names them', async () => {
    server({ earlierOpenYears: [1402, 1403] });
    renderTab();
    await waitFor(() => expect(previewUrls()).toHaveLength(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1404' } });
    const run = await executeButton('۱۴۰۴');
    await waitFor(() => expect(run.disabled).toBe(true));
    expect(run.title).toBe('ابتدا سال ۱۴۰۲، ۱۴۰۳ را ببندید');
    expect(screen.getByRole('alert').textContent).toContain('پیش از سال مالی ۱۴۰۴، سال ۱۴۰۲، ۱۴۰۳ سند دارد و هنوز بسته نشده است');
  });
});
