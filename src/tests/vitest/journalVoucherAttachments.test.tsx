import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JournalVouchersTab } from '../../components/accounting/JournalVouchersTab';
import type { JournalVoucher } from '../../types';

// TD-236: پیش‌نمایش پیوست‌های سند حسابداری فیلدهای قدیمی fileName/dataUrl/fileType را می‌خواند و تصویر و نامی نشان نمی‌داد.
// v9.0.115 (TD-565): برگه فهرست اسناد صفحه خود را از سرور می‌خواند
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args), getAuthToken: () => null, isAbortError: () => false }));

const voucher = {
  id: 41, voucherNumber: 1201, date: '1405/07/10', voucherType: 'manual', status: 'draft',
  totalDebit: 1000, totalCredit: 1000, description: 'خرید ملزومات', items: [],
  attachments: [
    { id: 'a1', name: 'factor.png', url: '/api/attachments/3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f', type: 'image/png', size: 10 },
    { id: 'a2', name: 'statement.pdf', url: '/api/attachments/3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e70', type: 'application/pdf', size: 20 },
  ],
} as unknown as JournalVoucher;

afterEach(cleanup);

describe('JournalVouchersTab — attachment thumbnails (TD-236)', () => {
  it('shows the image and the file name of attachments stored as name/url/type', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(String(url).startsWith('/accounting/vouchers?')
      ? { data: [voucher], total: 1, page: 1, limit: 20, statusCounts: { draft: 1, approved: 0, permanent: 0 } }
      : { instance: null }));
    const noop = () => undefined;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <JournalVouchersTab
          onRefresh={noop} onOpenNewVoucher={noop} onEditVoucher={noop}
          onDeleteVoucher={() => Promise.resolve()} onPrintVoucher={noop}
        />
      </QueryClientProvider>,
    );
    await screen.findByText('خرید ملزومات');
    const expand = screen.getAllByRole('button').find(b => b.querySelector('svg.lucide-chevron-right'));
    if (!expand) throw new Error('expand button not found');
    fireEvent.click(expand);
    expect(screen.getByAltText('factor.png').getAttribute('src')).toBe('/api/attachments/3f2b9c1e-8a4d-4f6b-9c2e-1a2b3c4d5e6f');
    expect(screen.getAllByText('statement.pdf').length).toBeGreaterThan(0);
  });
});
