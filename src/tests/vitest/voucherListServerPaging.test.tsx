import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  getAuthToken: () => null,
  isAbortError: () => false,
}));

import { JournalVouchersTab } from '../../components/accounting/JournalVouchersTab';
import { useVoucherPageQuery } from '../../hooks/accounting/useVoucherQueries';

afterEach(() => { cleanup(); fetchJson.mockReset(); });

const voucher = (id: number, status: 'draft' | 'approved' | 'permanent' = 'draft') => ({
  id, voucherNumber: 1000 + id, date: '2026-10-01', voucherType: 'general', status,
  totalDebit: 1000, totalCredit: 1000, description: `سند آزمون ${id}`, items: [], attachments: [],
});
const counts = { draft: 30, approved: 10, permanent: 5 };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client()}>{children}</QueryClientProvider>;
}
const paramsOf = (call: unknown[]) => Object.fromEntries(new URL(String(call[0]), 'http://x').searchParams);
const listCalls = () => fetchJson.mock.calls.filter(c => String(c[0]).startsWith('/accounting/vouchers?'));

/** پاسخ سرور: ۴۵ سند، صفحه‌های ۲۰تایی؛ شناسه‌های صفحه n از (n − 1) × ۲۰ + ۱ */
function serveVoucherPages() {
  fetchJson.mockImplementation((url: string) => {
    if (!String(url).startsWith('/accounting/vouchers?')) return Promise.resolve({ instance: null });
    const page = Number(new URL(url, 'http://x').searchParams.get('page'));
    const size = page === 3 ? 5 : 20;
    const data = Array.from({ length: size }, (_, i) => voucher((page - 1) * 20 + i + 1));
    return Promise.resolve({ data, total: 45, page, limit: 20, statusCounts: counts });
  });
}

// v9.0.109 (TD-565, B03-23): the voucher list read only the newest 20 vouchers (no page or limit, the type filter sent as
// `type`), and its counters, search and filters worked on those 20 in the browser.
describe('voucher list is paged and filtered on the server (TD-565)', () => {
  it('asks for one page with status, voucherType, search and ISO dates and returns the server total and counts', async () => {
    fetchJson.mockResolvedValue({ data: [voucher(21)], total: 45, page: 2, limit: 20, statusCounts: counts });
    const filters = { status: 'draft', voucherType: 'sales', search: ' 12 ', startDate: '2026-03-21', endDate: '' };
    const { result } = renderHook(() => useVoucherPageQuery(filters, 2, 20), { wrapper });
    await waitFor(() => expect(result.current.data?.total).toBe(45));
    expect(String(fetchJson.mock.calls[0][0]).startsWith('/accounting/vouchers?')).toBe(true);
    expect(paramsOf(fetchJson.mock.calls[0])).toEqual({
      status: 'draft', voucherType: 'sales', search: '12', startDate: '2026-03-21', page: '2', limit: '20',
    });
    expect(result.current.data?.statusCounts).toEqual(counts);
  });

  it('the tab shows the server counters and total, pages through the server and searches there', async () => {
    serveVoucherPages();
    const noop = () => undefined;
    render(
      <QueryClientProvider client={client()}>
        <JournalVouchersTab onRefresh={noop} onOpenNewVoucher={noop} onEditVoucher={noop} onDeleteVoucher={() => Promise.resolve()} onPrintVoucher={noop} />
      </QueryClientProvider>,
    );
    await screen.findByText('سند آزمون 1');
    expect(screen.getByText('همه اسناد حسابداری').parentElement!.textContent).toContain('۴۵');
    expect(screen.getByText('پیش‌نویس‌ها (یادداشت اولیه)').parentElement!.textContent).toContain('۳۰');
    expect(screen.getByText('دائم و قطعی (قفل دفاتر)').parentElement!.textContent).toContain('۵');
    expect(screen.getByTestId('voucher-list-range').textContent).toContain('۱ تا ۲۰ از ۴۵ سند');

    fireEvent.click(screen.getByTitle('صفحه بعد'));
    await screen.findByText('سند آزمون 21');
    expect(paramsOf(listCalls().at(-1)!)).toMatchObject({ page: '2', limit: '20' });

    fireEvent.change(screen.getByPlaceholderText('جستجو در شماره سند، شرح یا عطف...'), { target: { value: '12' } });
    await waitFor(() => expect(paramsOf(listCalls().at(-1)!)).toEqual({ search: '12', page: '1', limit: '20' }));

    fireEvent.change(screen.getByLabelText('نوع سند'), { target: { value: 'opening' } });
    await waitFor(() => expect(paramsOf(listCalls().at(-1)!)).toMatchObject({ voucherType: 'opening', page: '1' }));
  });

  it('batch approval keeps the drafts selected on earlier pages', async () => {
    serveVoucherPages();
    const onBatchApproveVouchers = vi.fn(() => Promise.resolve());
    const noop = () => undefined;
    render(
      <QueryClientProvider client={client()}>
        <JournalVouchersTab onRefresh={noop} onOpenNewVoucher={noop} onEditVoucher={noop} onDeleteVoucher={() => Promise.resolve()}
          onPrintVoucher={noop} onBatchApproveVouchers={onBatchApproveVouchers} />
      </QueryClientProvider>,
    );
    const rowCheckbox = (description: string) => within(screen.getByText(description).closest('tr')!).getByRole('checkbox');
    await screen.findByText('سند آزمون 3');
    fireEvent.click(rowCheckbox('سند آزمون 3'));
    fireEvent.click(screen.getByTitle('صفحه بعد'));
    await screen.findByText('سند آزمون 22');
    fireEvent.click(rowCheckbox('سند آزمون 22'));
    fireEvent.click(screen.getByText(/تایید حسابداری/));
    await waitFor(() => expect(onBatchApproveVouchers).toHaveBeenCalledTimes(1));
    expect([...(onBatchApproveVouchers.mock.calls[0] as unknown as [number[]])[0]].sort((a, b) => a - b)).toEqual([3, 22]);
  });
});
