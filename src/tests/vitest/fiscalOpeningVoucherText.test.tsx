import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { fetchJson, toastFn } = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { fetchJson: vi.fn(), toastFn: t };
});
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => ({ default: toastFn, toast: toastFn, Toaster: () => null }));
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: vi.fn() }));
// v9.0.214 (TD-567): the execute button shows only for holders of accounting.fiscal_close
vi.mock('../../contexts/AuthContext', () => ({ useHasPermission: (key: string) => key === 'accounting.fiscal_close' }));

import { FiscalYearClosingTab } from '../../components/accounting/FiscalYearClosingTab';

function renderTab(ui: ReactNode = <FiscalYearClosingTab />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const preview = {
  year: 1404, closingDate: '', openingDateNewYear: '', totalRevenues: 0, totalCostOfSales: 0, totalExpenses: 0,
  totalTemporaryDebit: 0, totalTemporaryCredit: 0, netProfit: 0, isProfit: true, temporaryAccounts: [], permanentAccounts: [],
  summaryVouchersPreview: [], draftVouchers: [], draftVoucherCount: 0, yearEnded: true, earlierOpenYears: [],
};

beforeEach(() => {
  fetchJson.mockReset();
  fetchJson.mockImplementation(async (url: string) => {
    if (url === '/accounting/fiscal-closing/years') {
      return { currentYear: 1405, years: [{ year: 1404, status: 'open', hasVouchers: true, closedAt: null, closedBy: null }], defaultYear: 1404, reopenableYear: null };
    }
    if (url.startsWith('/accounting/fiscal-closing/preview?')) return preview;
    return [];
  });
});
afterEach(() => { cleanup(); });

const ISSUED = 'به عنوان سند شماره ۱ سال جدید ثبت خواهد شد';
const NOT_ISSUED = 'سند افتتاحیه صادر نمی‌شود';

// v9.0.163 (TD-577, B03-35): with «صدور خودکار سند افتتاحیه» unticked, step 4 and the execution note still said the
// opening voucher would be issued, while closing zeroes the balance-sheet accounts and the new year starts without them.
describe('fiscal closing step 4 follows the opening-voucher checkbox (TD-577)', () => {
  it('ticked: step 4 says the opening voucher is issued; unticked: it says none is issued and the new year starts without opening balances', async () => {
    renderTab();
    const box = (await screen.findByText('صدور خودکار سند افتتاحیه')).closest('label')!;
    const input = box.querySelector('input') as HTMLInputElement;
    await waitFor(() => expect(document.body.textContent).toContain(ISSUED));
    expect(document.body.textContent).not.toContain(NOT_ISSUED);

    fireEvent.click(input);
    expect(input.checked).toBe(false);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain(ISSUED);
    expect(text).toContain(NOT_ISSUED);
    expect(text).toContain('سال مالی ۱۴۰۵ بی مانده ابتدای دوره آغاز می‌شود');
    expect(text).not.toContain('کلیه اسناد اختتامیه و افتتاحیه صادر شده');

    fireEvent.click(input);
    expect(document.body.textContent).toContain(ISSUED);
  });

  it('unticked: the confirm dialog lists no opening voucher and warns that none is issued', async () => {
    renderTab();
    const box = (await screen.findByText('صدور خودکار سند افتتاحیه')).closest('label')!;
    fireEvent.click(box.querySelector('input')!);
    fireEvent.click(await screen.findByText('اجرای قطعی بستن سال مالی ۱۴۰۴'));
    const dialog = screen.getByText('تایید اجرای عملیات بستن سال مالی ۱۴۰۴').closest('div.fixed') as HTMLElement;
    expect(dialog.textContent).not.toContain('صدور سند افتتاحیه سال ۱۴۰۵');
    expect(within(dialog).getByText(new RegExp(NOT_ISSUED))).toBeTruthy();
  });
});
