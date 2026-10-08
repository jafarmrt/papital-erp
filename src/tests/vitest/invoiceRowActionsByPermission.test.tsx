import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoicesListPage from '../../pages/InvoicesListPage';
import { SearchProvider } from '../../SearchContext';
import { INVOICE_ROW_ACTION_PERMISSIONS } from '../../lib/invoices/invoiceRowAccess';
import { READ_PERMISSIONS, WORKFLOW_WIDGET_PERMISSIONS } from '../../lib/recordReadPermissions';

// v9.0.340 (TD-795, finding B08-26): each row button of the documents list is shown only with the permission of the API it
// calls, and a refused notes edit shows the server's reason
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
  default: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
const granted = new Set<string>();
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/AuthContext')>()),
  useHasPermission: (key: string) => granted.has(key),
  useHasAnyPermission: (keys: readonly string[]) => keys.some(key => granted.has(key)),
}));

const invoice = {
  id: 1, type: 'invoice', status: 'final', ref_number: 'INV-1', date: '2026-10-01', currency: 'IRR', buyer_name: 'نگار کریمی',
  itemsCount: 1, totalQuantity: 1, totalAmount: 1_000_000, payableAmount: 1_000_000, paidAmount: 0, remainingAmount: 1_000_000,
  settlementStatus: 'unpaid', notes: 'ارسال با پیک',
};

function server(notesRefusal?: Error) {
  fetchJson.mockImplementation((url: string, init?: { method?: string }) => {
    if (url.startsWith('/documents?')) return Promise.resolve({ data: [invoice], total: 1, page: 1, totalPages: 1 });
    if (url === '/documents/1/notes' && init?.method === 'PUT') return notesRefusal ? Promise.reject(notesRefusal) : Promise.resolve({ success: true });
    if (url === '/documents/1') return Promise.resolve({ ...invoice, items: [] });
    if (url.startsWith('/workflow/instance/')) return Promise.resolve({ instance: null });
    return Promise.resolve([]);
  });
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SearchProvider>
        <InvoicesListPage />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

const rowOf = async () => (await screen.findByText('INV-۱')).closest('tr') as HTMLElement;
const menuLabels = async (row: HTMLElement) => {
  fireEvent.click(within(row).getByTitle('عملیات سند'));
  await screen.findByText('چاپ سند / فاکتور رسمی');
  return ['چاپ سند / فاکتور رسمی', 'چرخه تأییدات و گردش کار', 'ابطال / حذف سند'].filter(label => screen.queryByText(label));
};

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  granted.clear();
});

describe('documents list row actions by permission (TD-795)', () => {
  it('asks the keys of the routes each button calls', () => {
    expect(INVOICE_ROW_ACTION_PERMISSIONS.settle).toEqual(['accounting.treasury']);
    expect(INVOICE_ROW_ACTION_PERMISSIONS.editNotes).toEqual(['documents.edit']);
    expect(INVOICE_ROW_ACTION_PERMISSIONS.void).toEqual(['documents.delete']);
    expect(INVOICE_ROW_ACTION_PERMISSIONS.workflow).toBe(WORKFLOW_WIDGET_PERMISSIONS);
    expect(READ_PERMISSIONS.documentRecord).toContain('documents.view');
  });

  it('a plain document reader sees only details and print: no settlement, notes edit, workflow or void', async () => {
    granted.add('documents.view');
    server();
    renderPage();
    const row = await rowOf();
    expect(within(row).queryByText('تسویه سریع')).toBeNull();
    expect(within(row).queryByTitle('ویرایش توضیحات')).toBeNull();
    expect(await menuLabels(row)).toEqual(['چاپ سند / فاکتور رسمی']);

    fireEvent.click(within(row).getByTitle('مشاهده ریز اقلام و ارقام سند'));
    expect(await screen.findByText('وضعیت تسویه مالی:')).toBeTruthy();
    expect(screen.queryByText('تسویه سریع فاکتور')).toBeNull();
  });

  it('each key opens only its own button', async () => {
    for (const [key, settle, notes, menu] of [
      ['accounting.treasury', true, false, ['چاپ سند / فاکتور رسمی']],
      ['documents.edit', false, true, ['چاپ سند / فاکتور رسمی']],
      ['documents.delete', false, false, ['چاپ سند / فاکتور رسمی', 'ابطال / حذف سند']],
      ['workflow.approve', false, false, ['چاپ سند / فاکتور رسمی', 'چرخه تأییدات و گردش کار']],
    ] as const) {
      granted.clear();
      granted.add(key);
      server();
      renderPage();
      const row = await rowOf();
      expect(Boolean(within(row).queryByText('تسویه سریع')), `${key}: settlement`).toBe(settle);
      expect(Boolean(within(row).queryByTitle('ویرایش توضیحات')), `${key}: notes`).toBe(notes);
      expect(await menuLabels(row), `${key}: menu`).toEqual(menu);
      cleanup();
    }
  });

  it('a refused notes edit shows the server reason, not a generic message', async () => {
    granted.add('documents.edit');
    const reason = 'دسترسی غیرمجاز برای این عملیات';
    server(Object.assign(new Error(reason), { status: 403 }));
    renderPage();
    fireEvent.click(within(await rowOf()).getByTitle('ویرایش توضیحات'));
    fireEvent.click(screen.getByText('ثبت'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(reason));
  });
});
