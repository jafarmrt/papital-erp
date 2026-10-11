import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  getAuthToken: () => null,
  isAbortError: () => false,
}));
const viewer = vi.hoisted(() => ({ current: null as { id: number; isAdmin: boolean } | null }));
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/AuthContext')>()),
  useViewerIdentity: () => viewer.current,
}));

import { JournalVouchersTab } from '../../components/accounting/JournalVouchersTab';

afterEach(() => { cleanup(); fetchJson.mockReset(); viewer.current = null; });

const MAKER_NAME = 'مریم احمدی';
const REFERENCE_TEXT = 'ارجاع: چک (CHQ-1)';
const APPROVE_LABEL = 'تایید سند';
const WAITING_LABEL = 'در انتظار تأیید دیگری';

function renderTab() {
  fetchJson.mockImplementation((url: string) => {
    if (!String(url).startsWith('/accounting/vouchers?')) return Promise.resolve({ instance: null });
    return Promise.resolve({
      data: [{
        id: 1, voucherNumber: 101, date: '2026-10-01', voucherType: 'general', status: 'draft', totalDebit: 1000, totalCredit: 1000,
        description: 'manual draft', items: [], attachments: [], referenceModule: 'cheque', referenceNumber: 'CHQ-1',
        createdById: 7, createdByUsername: 'maryam', createdByName: MAKER_NAME,
      }],
      total: 1, page: 1, limit: 20, statusCounts: { draft: 1, approved: 0, permanent: 0 },
    });
  });
  const noop = () => undefined;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <JournalVouchersTab onRefresh={noop} onOpenNewVoucher={noop} onEditVoucher={noop} onDeleteVoucher={() => Promise.resolve()}
        onPrintVoucher={noop} onApproveVoucher={() => Promise.resolve()} />
    </QueryClientProvider>,
  );
}

// Fresh-eyes work-map B-05 / B-07 / B-12: the voucher list showed the module code («cheque»), the username, and the
// approve button to the maker of a manual draft, which the server then refused (VOUCHER_MAKER_CANNOT_APPROVE).
describe('voucher list row as its viewer sees it (TD-1129, TD-1230, TD-1231)', () => {
  it('names the reference module in Persian and the maker by full name', async () => {
    viewer.current = { id: 8, isAdmin: false };
    renderTab();
    await screen.findByText('manual draft');
    expect(screen.getByText(REFERENCE_TEXT)).toBeTruthy();
    expect(screen.getByText(MAKER_NAME)).toBeTruthy();
    expect(screen.queryByText('maryam')).toBeNull();
  });

  it('hides the approve button from the maker and shows it to another user and to the system admin', async () => {
    viewer.current = { id: 7, isAdmin: false };
    renderTab();
    await screen.findByText('manual draft');
    expect(screen.queryByText(APPROVE_LABEL)).toBeNull();
    expect(screen.getByText(WAITING_LABEL)).toBeTruthy();
    cleanup();
    viewer.current = { id: 7, isAdmin: true };
    renderTab();
    await screen.findByText('manual draft');
    expect(screen.getByText(APPROVE_LABEL)).toBeTruthy();
    cleanup();
    viewer.current = { id: 8, isAdmin: false };
    renderTab();
    await screen.findByText('manual draft');
    expect(screen.getByText(APPROVE_LABEL)).toBeTruthy();
  });
});
