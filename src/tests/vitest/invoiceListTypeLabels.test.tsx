import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoicesListPage from '../../pages/InvoicesListPage';
import { SearchProvider } from '../../SearchContext';
import { detailsTypeLabelOf, workflowTypeLabelOf } from '../../lib/invoices/invoiceListDocuments';

// v9.0.295 (TD-800, finding B08-31): every document type has a Persian name in the details and workflow windows, and the
// «sales proforma» filter finds proformas saved as type invoice too
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  default: { success: vi.fn(), error: vi.fn() },
}));

const OTHER_TYPES = ['remittance', 'proforma', 'return', 'waste', 'production_receipt', 'audit', 'transfer'];
const remittance = { id: 4, type: 'remittance', status: 'final', ref_number: 'RM-4', date: '2026-10-03', currency: 'IRR', itemsCount: 1, totalAmount: 0 };

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SearchProvider>
        <InvoicesListPage />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

function listRequests(): URLSearchParams[] {
  return fetchJson.mock.calls
    .map(([url]) => String(url))
    .filter(url => url.startsWith('/documents?'))
    .map(url => new URLSearchParams(url.slice('/documents?'.length)));
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

describe('document type names in the documents list (TD-800)', () => {
  it('details and workflow labels are Persian for every type', () => {
    for (const type of OTHER_TYPES) {
      expect(detailsTypeLabelOf(type), type).toMatch(/^[^A-Za-z]+$/);
      expect(workflowTypeLabelOf(type), type).toMatch(/^[^A-Za-z]+$/);
    }
    expect(detailsTypeLabelOf('remittance')).toBe('حواله خروج / مصرف');
    expect(detailsTypeLabelOf('production_receipt')).toBe('رسید تولید و تحویل محصول');
    expect(workflowTypeLabelOf('proforma')).toBe('پیش‌فاکتور');
    expect(detailsTypeLabelOf('receipt')).toBe('رسید ورود (خرید کالا)');
    expect(workflowTypeLabelOf('receipt')).toBe('رسید ورود');
    expect(workflowTypeLabelOf(undefined)).toBeUndefined();
  });

  it('the details window of a remittance names its type in Persian', async () => {
    fetchJson.mockImplementation((url: string) => {
      if (url.startsWith('/documents?')) return Promise.resolve({ data: [remittance], total: 1, page: 1, totalPages: 1 });
      if (url === '/documents/4') return Promise.resolve({ ...remittance, items: [] });
      return Promise.resolve([]);
    });
    renderPage();
    const row = (await screen.findByText('RM-۴')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByTitle('مشاهده ریز اقلام و ارقام سند'));
    expect(await screen.findByText('جزئیات سند انبارداری')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('نوع سند:').nextElementSibling?.textContent).toBe('حواله خروج / مصرف'));
    expect(screen.queryByText('remittance')).toBeNull();
  });

  it('the sales proforma filter asks for proforma status over invoice and proforma types; production receipts can be filtered', async () => {
    fetchJson.mockImplementation((url: string) => Promise.resolve(url.startsWith('/documents?') ? { data: [], total: 0, page: 1, totalPages: 1 } : []));
    renderPage();
    const typeSelect = await screen.findByDisplayValue('همه انواع سند (خرید، فروش، انبار)') as HTMLSelectElement;
    expect(Array.from(typeSelect.options).map(o => o.value)).toContain('production_receipt');

    fireEvent.change(typeSelect, { target: { value: 'proforma' } });
    await waitFor(() => expect(listRequests().some(p => p.get('types') === 'invoice,proforma')).toBe(true));
    const proformaRequest = listRequests().find(p => p.get('types') === 'invoice,proforma') as URLSearchParams;
    expect(proformaRequest.get('status')).toBe('proforma');
    expect(proformaRequest.get('type')).toBeNull();

    fireEvent.change(typeSelect, { target: { value: 'production_receipt' } });
    await waitFor(() => expect(listRequests().some(p => p.get('type') === 'production_receipt')).toBe(true));
  });
});
