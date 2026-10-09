import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import { invoiceFormFromDocument } from '../../lib/invoices/invoiceForm';
import { DOCUMENT_VERSION_REQUIRED } from '../../lib/documents/documentVersion';
import type { User } from '../../types';

// TD-972 (OBS-R1-96): ویرایش پیش‌فاکتور نسخه سندی را که فرم از آن ساخته شده می‌فرستد
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

interface Init { method?: string; body?: string; signal?: AbortSignal }

const admin: User = { id: 1, username: 'admin', full_name: 'مدیر تست', role: 'admin' };
// ردیف سند همان کلیدهایی را دارد که GET /documents/:id می‌فرستد (documentQuery.service.ts): کد فقط با `code`
const line = {
  document_id: 5, item_id: 3, quantity: 1, unit_price: 1000, unitPrice: 1000, discount: 0, location: 'WH1',
  name: 'گردنبند نقره', item_name: 'گردنبند نقره', itemName: 'گردنبند نقره', code: 'P-3', unit: 'عدد',
};
const doc5 = { id: 5, version: 7, type: 'invoice', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01 10:00:00', buyer_name: 'مشتری', currency: 'IRR', items: [line] };

function server() {
  fetchJson.mockImplementation((url: string, init?: Init) => {
    const method = init?.method ?? 'GET';
    if (url === '/warehouses') return Promise.resolve([{ id: 1, name: 'انبار مرکزی', code: 'WH1', is_active: 1 }]);
    if (url.startsWith('/documents?status=proforma')) {
      return Promise.resolve({ data: [{ id: 5, type: 'invoice', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01 10:00:00', buyer_name: 'مشتری' }], total: 1, page: 1, limit: 20 });
    }
    if (url === '/documents/next-ref?type=invoice') return Promise.resolve({ nextRef: 'INV-1001' });
    if (url === '/documents/5' && method === 'GET') return Promise.resolve(doc5);
    if (url === '/documents/5' && method === 'PUT') return Promise.resolve({ success: true });
    return Promise.resolve([]);
  });
}

const puts = () => fetchJson.mock.calls.filter(([u, i]) => u === '/documents/5' && (i as Init | undefined)?.method === 'PUT');

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

async function editProforma() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CreateInvoicePage user={admin} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const row = (await screen.findByText('PF-5')).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByText('ویرایش'));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('پیش‌فاکتور شماره PF-5 جهت ویرایش بارگذاری شد.'));
}

describe('CreateInvoicePage — the proforma edit sends its version (TD-972)', () => {
  it('saving an edited proforma sends the version of the loaded document', async () => {
    server();
    await editProforma();
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات پیش‌فاکتور' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const sent = JSON.parse(String((puts()[0][1] as Init).body)) as { version?: number };
    expect(sent.version).toBe(7);
  });
});

describe('invoiceFormFromDocument — the version of the loaded document (TD-972)', () => {
  it('keeps a positive version and drops a missing one', () => {
    expect(invoiceFormFromDocument({ version: 3 }, 'PF-1').version).toBe(3);
    expect(invoiceFormFromDocument({}, 'PF-1').version).toBeNull();
  });

  it('the server message asks to reopen the document', () => {
    expect(DOCUMENT_VERSION_REQUIRED).toContain('دوباره باز کنید');
  });
});
