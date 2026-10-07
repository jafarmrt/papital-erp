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

/** GET /accounting/fiscal-closing/years on 1405/07/15: 1403 closed, 1404 open */
const yearsInfo = {
  currentYear: 1405,
  years: [
    { year: 1403, status: 'closed', hasVouchers: true, closedAt: '2025-04-01T08:00:00Z', closedBy: 'admin' },
    { year: 1404, status: 'open', hasVouchers: true, closedAt: null, closedBy: null },
  ],
  defaultYear: 1404,
  reopenableYear: 1403,
};

function server(options: { years?: unknown; yearEnded?: boolean } = {}) {
  fetchJson.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === '/accounting/fiscal-closing/years') return options.years ?? yearsInfo;
    const m = /^\/accounting\/fiscal-closing\/preview\?year=(\d+)/.exec(url);
    if (m) return preview(Number(m[1]), options.yearEnded ?? true);
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

// v9.0.145 (TD-543, B03-01, product-owner decisions t1/t2 option A): the tab opened on the current, unfinished year and closed it
// with one confirm; nothing reopened a closed year.
describe('fiscal closing lists ended years only and reopens the last closed year (TD-543)', () => {
  it('the year list comes from the server: ended years only, the current year is not offered, the default year is previewed', async () => {
    server();
    renderTab();
    await waitFor(() => expect(previewUrls()).toHaveLength(1));
    expect(previewUrls()[0]).toMatch(/^\/accounting\/fiscal-closing\/preview\?year=1404&/);
    const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map(o => o.textContent);
    expect(options).toEqual(['سال مالی ۱۴۰۳ (بسته)', 'سال مالی ۱۴۰۴']);
    expect((await executeButton('۱۴۰۴')).disabled).toBe(false);
  });

  it('a closed year and a year the server says has not ended cannot be executed', async () => {
    server({ yearEnded: false });
    renderTab();
    expect((await executeButton('۱۴۰۴')).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('سال مالی ۱۴۰۴ هنوز تمام نشده است');

    server();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1403' } });
    expect((await executeButton('۱۴۰۳')).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('سال مالی ۱۴۰۳ بسته است');
  });

  it('with no ended year the form says the current year closes after its end and previews nothing', async () => {
    server({ years: { currentYear: 1405, years: [], defaultYear: null, reopenableYear: null } });
    renderTab();
    expect((await screen.findByRole('status')).textContent).toContain('سال مالی ۱۴۰۵ پس از آخرین روزش بسته می‌شود');
    expect(previewUrls()).toHaveLength(0);
  });

  it('reopening: only for the reopen permission, the last closed year, a reason and a confirm', async () => {
    server();
    renderTab();
    await waitFor(() => expect(previewUrls()).toHaveLength(1));
    expect(screen.queryByText('بازگشایی سال مالی ۱۴۰۳', { selector: 'button' })).toBeNull();
    cleanup();

    perms.keys = ['accounting.fiscal_reopen'];
    server();
    renderTab();
    const button = await screen.findByText('بازگشایی سال مالی ۱۴۰۳', { selector: 'button' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('دلیل بازگشایی'), { target: { value: 'فروش جاافتاده ۱۴۰۳' } });
    confirmAction.mockResolvedValueOnce(false);
    fireEvent.click(button);
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(fetchJson.mock.calls.some(([u]) => u === '/accounting/fiscal-closing/reopen')).toBe(false);

    confirmAction.mockResolvedValueOnce(true);
    fireEvent.click(button);
    await waitFor(() => expect(fetchJson.mock.calls.some(([u]) => u === '/accounting/fiscal-closing/reopen')).toBe(true));
    const [, init] = fetchJson.mock.calls.find(([u]) => u === '/accounting/fiscal-closing/reopen')!;
    expect(JSON.parse((init as { body: string }).body)).toEqual({ year: 1403, reason: 'فروش جاافتاده ۱۴۰۳' });
    await waitFor(() => expect(toastFn.success).toHaveBeenCalledWith('سال مالی ۱۴۰۳ بازگشایی شد و ۴ سند بستن آن سال بی‌اثر شد.'));
  });
});
