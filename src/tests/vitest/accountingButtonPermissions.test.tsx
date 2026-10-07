import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { fetchJson, toastFn, perms } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t, perms: { keys: [] as string[], admin: false } };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/AuthContext')>()),
  useHasPermission: (key: string) => perms.admin || perms.keys.includes(key),
  useIsSystemAdmin: () => perms.admin,
}));

import AccountingPage from '../../pages/AccountingPage';
import { FiscalYearClosingTab } from '../../components/accounting/FiscalYearClosingTab';
import { ChartOfAccountsSettingsTab } from '../../components/settings/ChartOfAccountsSettingsTab';

// v9.0.207 (TD-567, B03-25): each accounting button asks the key of its own API. Before, the manager, CFO and accountant saw
// «execute the year closing» (accounting.fiscal_close) and «sync the default chart» (system admin) and got 403, and the treasurer
// opened the full voucher form from the dashboard and got 403 on save.

const accounts = [
  { id: 1, code: '1', name: 'دارایی‌ها', level: 'group', parentId: null, accountType: 'asset', nature: 'debit', isSystem: 1, balance: 0 },
  { id: 11, code: '11', name: 'دارایی‌های جاری', level: 'general', parentId: 1, accountType: 'asset', nature: 'debit', isSystem: 1, balance: 0 },
];
const tree = [{ ...accounts[0], children: [{ ...accounts[1], children: [] }] }];
const yearsInfo = {
  currentYear: 1405, years: [{ year: 1404, status: 'open', hasVouchers: true, closedAt: null, closedBy: null }], defaultYear: 1404, reopenableYear: null,
};
const preview = {
  year: 1404, closingDate: '', openingDateNewYear: '', totalRevenues: 0, totalCostOfSales: 0, totalExpenses: 0,
  totalTemporaryDebit: 0, totalTemporaryCredit: 0, netProfit: 0, isProfit: true, temporaryAccounts: [], permanentAccounts: [],
  summaryVouchersPreview: [], draftVouchers: [], draftVoucherCount: 0, yearEnded: true, earlierOpenYears: [],
};

function server() {
  fetchJson.mockImplementation(async (url: string) => {
    if (url === '/accounting/summary') return { stats: null };
    if (url === '/accounting/accounts') return accounts;
    if (url === '/accounting/accounts/tree') return tree;
    if (url === '/accounting/fiscal-closing/years') return yearsInfo;
    if (url.startsWith('/accounting/fiscal-closing/preview?')) return preview;
    return [];
  });
}

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};
const renderDashboard = (permissions: string[]) => wrap(
  <MemoryRouter initialEntries={['/accounting/dashboard']}>
    <Routes>
      <Route path="/accounting/:tab" element={<AccountingPage userPermissions={{ permissions, isAdmin: false }} />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { fetchJson.mockReset(); perms.keys = []; perms.admin = false; server(); });
afterEach(() => cleanup());

describe('accounting buttons ask their own API key (TD-567)', () => {
  it('the dashboard offers the voucher, treasury and cheque forms only to holders of their keys', async () => {
    renderDashboard(['accounting.view', 'accounting.treasury']);
    expect(await screen.findByText('دریافت / پرداخت نقد و بانک')).toBeTruthy();
    expect(screen.queryByText('ثبت سند دوبل جدید')).toBeNull();
    expect(screen.queryByText('ثبت چک جدید')).toBeNull();
    cleanup();

    renderDashboard(['accounting.view', 'accounting.vouchers', 'accounting.cheques']);
    expect(await screen.findByText('ثبت سند دوبل جدید')).toBeTruthy();
    expect(screen.getByText('ثبت چک جدید')).toBeTruthy();
    expect(screen.queryByText('دریافت / پرداخت نقد و بانک')).toBeNull();
  });

  it('the year closing is executed only by holders of accounting.fiscal_close; others see the preview and a note', async () => {
    perms.keys = ['accounting.vouchers'];
    wrap(<FiscalYearClosingTab />);
    expect(await screen.findByText('بستن سال مالی با دارنده مجوز «اجرای بستن سال مالی» است؛ شما پیش‌نمایش را می‌بینید.')).toBeTruthy();
    expect(screen.queryByText('اجرای قطعی بستن سال مالی ۱۴۰۴')).toBeNull();
    cleanup();

    perms.keys = ['accounting.vouchers', 'accounting.fiscal_close'];
    wrap(<FiscalYearClosingTab />);
    expect(await screen.findByText('اجرای قطعی بستن سال مالی ۱۴۰۴')).toBeTruthy();
  });

  it('syncing the default chart of accounts is offered only to the system admin', async () => {
    perms.keys = ['accounting.view', 'accounting.vouchers', 'settings.manage'];
    wrap(<ChartOfAccountsSettingsTab />);
    await screen.findByText('دارایی‌ها');
    expect(screen.queryByText('همگام‌سازی کدینگ پیش‌فرض')).toBeNull();
    cleanup();

    perms.admin = true;
    wrap(<ChartOfAccountsSettingsTab />);
    await waitFor(() => expect(screen.getByText('همگام‌سازی کدینگ پیش‌فرض')).toBeTruthy());
  });
});
