import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import CreateInvoicePage from '../../pages/CreateInvoicePage';
import { invoiceFormFromDocument } from '../../lib/invoices/invoiceForm';
import type { User } from '../../types';

// TD-801 (B08-32): ویرایش پیش‌فاکتور آن را قطعی نمی‌کند و کد کالای ردیف‌های بارشده از کلید `code` سرور خوانده می‌شود
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
const doc5 = { id: 5, type: 'invoice', status: 'proforma', ref_number: 'PF-5', date: '2026-10-01 10:00:00', buyer_name: 'مشتری', currency: 'IRR', items: [line] };

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

describe('CreateInvoicePage — editing a proforma does not finalize it (TD-801)', () => {
  it('the final invoice option is closed while editing and says the proforma is finalized by its approval', async () => {
    server();
    await editProforma();
    const finalOption = screen.getByText(/فاکتور نهایی \(کسر قطعی از انبار\)/) as HTMLOptionElement;
    expect(finalOption.disabled).toBe(true);
    expect(finalOption.textContent).toContain('پیش‌فاکتور از گردش کار تأیید قطعی می‌شود');
  });

  it('a final status forced into the edit is refused with that reason, not a false stock shortage, and nothing is sent', async () => {
    server();
    await editProforma();
    fireEvent.change(screen.getByDisplayValue('پیش فاکتور (رزرو موقت)'), { target: { value: 'final' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات پیش‌فاکتور' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('پیش‌فاکتور در ویرایش قطعی نمی‌شود؛ آن را از گردش کار تأیید پیش‌فاکتور قطعی کنید.'));
    expect(vi.mocked(toast.error).mock.calls.some(([msg]) => String(msg).includes('کافی نیست'))).toBe(false);
    expect(puts()).toHaveLength(0);
  });

  it('the item code of a loaded line is shown', async () => {
    server();
    await editProforma();
    expect(screen.getByText('P-۳')).toBeTruthy();
  });
});

describe('invoiceFormFromDocument — the item code and name of a line (TD-801)', () => {
  it('reads `code` and `name` when the camelCase and snake_case keys are missing', () => {
    const form = invoiceFormFromDocument({ items: [{ item_id: 3, code: 'P-3', name: 'گردنبند نقره', quantity: 1 }] }, 'PF-1');
    expect(form.docItems?.[0].item.code).toBe('P-3');
    expect(form.docItems?.[0].item.name).toBe('گردنبند نقره');
  });
});
