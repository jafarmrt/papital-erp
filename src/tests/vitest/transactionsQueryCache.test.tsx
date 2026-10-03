import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import TransactionsPage from '../../pages/TransactionsPage';
import InventoryAuditPage from '../../pages/InventoryAuditPage';
import { SearchProvider } from '../../SearchContext';
import { invalidateAfterStockAdjustment } from '../../hooks/inventoryAudit/useInventoryAuditSave';
import type { User } from '../../types';
import { formatPersianPrice } from '../../utils';

// صفحه کاردکس با React Query: فهرست تراکنش‌ها و کاردکس تفصیلی کالا سیگنال لغو می‌گیرند، پاسخ دیررس فیلتر قدیمی
// جای نتیجه فیلتر تازه را نمی‌گیرد، تغییر فیلتر روی صفحه ۲ درخواست اضافه برای صفحه ۲ فیلتر تازه نمی‌فرستد،
// خروجی اکسل در جریان دوباره فرستاده نمی‌شود و مودال کاردکس (مشترک با انبارگردانی) با ابطال کاردکس تازه می‌شود
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
const writeFile = vi.fn();
vi.mock('xlsx', () => ({
  utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => undefined },
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

const keeper: User = { id: 2, username: 'keeper', full_name: 'انباردار تست', role: 'admin' };
const LIST_ALL = '/transactions?page=1&limit=50';
const LIST_IN = '/transactions?page=1&limit=50&type=in';
const LIST_ALL_P2 = '/transactions?page=2&limit=50';
const LIST_IN_P2 = '/transactions?page=2&limit=50&type=in';
const EXPORT_URL = '/transactions?export=true';
const KARDEX_URL = '/inventory/item-kardex/7';

const tx = (id: number, name: string, type: 'in' | 'out' = 'in') => ({
  id, item_id: 7, type, quantity: 3, date: '2026-10-01', document_type: 'receipt', document_ref: `RC-${id}`,
  user: 'انباردار', item_name: name, item_code: 'R-7', item_unit: 'متر', item_type: 'raw_material',
});
const kardex = {
  item: { id: 7, code: 'R-7', name: 'سیم نقره', unit: 'متر', category: 'سیم', type: 'raw_material', currentStock: 10, weightedAverageCost: 1000 },
  summary: { totalIn: 10, totalOut: 0, netBalance: 10, transactionCount: 1, valuation: 10000 },
  entries: [{
    transactionId: 1, date: '2026-10-01', type: 'in', documentType: 'receipt', documentRef: 'RC-KX-1', location: 'WH1',
    quantity: 10, unitPrice: 1000, totalAmount: 10000, runningBalance: 10, runningLocationStock: 10, runningGlobalStock: 10,
    runningWac: 1000, runningTotalValue: 10000, notes: '', createdBy: 'انباردار',
  }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderKardexPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <SearchProvider>
        <TransactionsPage />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

const callsTo = (url: string) => fetchJson.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === 'GET').length;
const signalOf = (url: string): AbortSignal | undefined => fetchJson.mock.calls.find(([u]) => u === url)?.[1]?.signal;
const typeSelect = () => screen.getByDisplayValue('همه انواع تراکنش');

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  writeFile.mockReset();
});

describe('TransactionsPage (Kardex) — React Query', () => {
  it('passes an abort signal to the list request and aborts it on unmount', async () => {
    fetchJson.mockImplementation(() => new Promise(() => undefined));
    const { unmount } = renderKardexPage(newClient());
    await waitFor(() => expect(callsTo(LIST_ALL)).toBe(1));
    const signal = signalOf(LIST_ALL);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('cancels the old filter request and never lets its late response overwrite the newer filter', async () => {
    const stale = deferred<unknown>();
    fetchJson.mockImplementation((url: string) => {
      if (url === LIST_ALL) return stale.promise;
      if (url === LIST_IN) return Promise.resolve({ data: [tx(2, 'نتیجه فیلتر ورود')], total: 1, totalPages: 1, page: 1 });
      return Promise.resolve([]);
    });
    renderKardexPage(newClient());
    await waitFor(() => expect(callsTo(LIST_ALL)).toBe(1));

    fireEvent.change(typeSelect(), { target: { value: 'in' } });
    expect(await screen.findByText('نتیجه فیلتر ورود')).toBeTruthy();
    expect(signalOf(LIST_ALL)?.aborted).toBe(true);

    // پاسخ دیررس فیلتر قبلی
    await act(async () => { stale.resolve({ data: [tx(1, 'نتیجه کهنه همه انواع')], total: 1, totalPages: 1, page: 1 }); });
    expect(screen.queryByText('نتیجه کهنه همه انواع')).toBeNull();
    expect(screen.getByText('نتیجه فیلتر ورود')).toBeTruthy();
  });

  it('changing a filter on page 2 requests page 1 of the new filter only (no extra page-2 request)', async () => {
    fetchJson.mockImplementation((url: string) => {
      if (url === LIST_ALL) return Promise.resolve({ data: [tx(1, 'صفحه اول')], total: 120, totalPages: 3, page: 1 });
      if (url === LIST_ALL_P2) return Promise.resolve({ data: [tx(51, 'صفحه دوم')], total: 120, totalPages: 3, page: 2 });
      if (url === LIST_IN || url === LIST_IN_P2) return Promise.resolve({ data: [tx(2, 'ورودی‌ها')], total: 1, totalPages: 1, page: 1 });
      return Promise.resolve([]);
    });
    renderKardexPage(newClient());
    await screen.findByText('صفحه اول');
    fireEvent.click(screen.getByTitle('صفحه بعدی'));
    await screen.findByText('صفحه دوم');

    fireEvent.change(typeSelect(), { target: { value: 'in' } });
    await screen.findByText('ورودی‌ها');

    expect(callsTo(LIST_IN)).toBe(1);
    expect(callsTo(LIST_IN_P2)).toBe(0);
  });

  it('runs the Excel export once while it is pending and keeps its URL', async () => {
    const exportRes = deferred<unknown>();
    fetchJson.mockImplementation((url: string) => {
      if (url === EXPORT_URL) return exportRes.promise;
      if (url === LIST_ALL) return Promise.resolve({ data: [tx(1, 'سیم نقره')], total: 1, totalPages: 1, page: 1 });
      return Promise.resolve([]);
    });
    renderKardexPage(newClient());
    await screen.findByText('سیم نقره');
    const button = screen.getByRole('button', { name: /خروجی اکسل/ }) as HTMLButtonElement;

    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    fireEvent.click(button);
    expect(callsTo(EXPORT_URL)).toBe(1);

    await act(async () => { exportRes.resolve({ data: [tx(1, 'سیم نقره')] }); });
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    expect(writeFile.mock.calls[0][1]).toBe('Transactions.xlsx');
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('loads the item Kardex modal with an abort signal, cancels it on close and reloads on reopen', async () => {
    let kardexCalls = 0;
    fetchJson.mockImplementation((url: string) => {
      if (url === LIST_ALL) return Promise.resolve({ data: [tx(1, 'سیم نقره')], total: 1, totalPages: 1, page: 1 });
      if (url === KARDEX_URL) {
        kardexCalls += 1;
        return kardexCalls === 1 ? new Promise(() => undefined) : Promise.resolve(kardex);
      }
      return Promise.resolve([]);
    });
    renderKardexPage(newClient());
    await screen.findByText('سیم نقره');

    fireEvent.click(screen.getByRole('button', { name: /کاردکس/ }));
    await waitFor(() => expect(callsTo(KARDEX_URL)).toBe(1));
    expect(screen.getByText('در حال محاسبه و بازخوانی زنجیره کاردکس...')).toBeTruthy();
    const signal = signalOf(KARDEX_URL);
    expect(signal).toBeInstanceOf(AbortSignal);

    fireEvent.click(screen.getByRole('button', { name: 'بستن' }));
    expect(signal?.aborted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /کاردکس/ }));
    expect(await screen.findByText('RC-KX-1')).toBeTruthy();
    expect(screen.getByText('کاملاً منطبق')).toBeTruthy();
    expect(callsTo(KARDEX_URL)).toBe(2);
  });
});

describe('RunningKardexModal on the stock-count page', () => {
  it('opens from the integrity tab, loads with a signal and is refreshed by a stock adjustment', async () => {
    fetchJson.mockImplementation((url: string) => {
      if (url === '/inventory/integrity-audit') {
        return Promise.resolve({ report: { summary: { discrepancyItems: 0 }, items: [{
          itemId: 7, itemCode: 'R-7', itemName: 'سیم نقره', category: 'سیم', unit: 'متر', currentStock: 10,
          warehouseStocksSum: 10, ledgerStock: 10, variance: 0, isSynchronized: true, transactionCount: 1, storedWac: 1000, recalculatedWac: 1000,
        }] } });
      }
      if (url === '/documents/next-ref?type=audit') return Promise.resolve({ nextRef: 'AUD-2001' });
      if (url === KARDEX_URL) return Promise.resolve(kardex);
      return Promise.resolve([]);
    });
    const client = newClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <InventoryAuditPage user={keeper} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /بررسی سلامت و تطبیق موجودی/ }));
    fireEvent.click(await screen.findByTitle('مشاهده کاردکس تفصیلی کالا'));
    expect(await screen.findByText('RC-KX-1')).toBeTruthy();
    expect(signalOf(KARDEX_URL)).toBeInstanceOf(AbortSignal);
    const before = callsTo(KARDEX_URL);

    // هر تغییر موجودی در صفحه انبارگردانی (بازسازی، انتقال، ثبت شمارش) کاردکس کالای باز را هم تازه می‌کند
    await act(async () => { await invalidateAfterStockAdjustment(client); });
    await waitFor(() => expect(callsTo(KARDEX_URL)).toBeGreaterThan(before));

    unmount();
  });
});

describe('RunningKardexModal running WAC column', () => {
  // ستون «میانگین بهای خرید» باید میانگین موزون هر ردیف را از runningWac پاسخ سرور نشان دهد (پیش‌تر همیشه «-»)
  it('shows each row running WAC sent by the server', async () => {
    const wacKardex = { ...kardex, entries: [{ ...kardex.entries[0], runningWac: 1234 }] };
    fetchJson.mockImplementation((url: string) => {
      if (url === LIST_ALL) return Promise.resolve({ data: [tx(1, 'سیم نقره')], total: 1, totalPages: 1, page: 1 });
      if (url === KARDEX_URL) return Promise.resolve(wacKardex);
      return Promise.resolve([]);
    });
    renderKardexPage(newClient());
    await screen.findByText('سیم نقره');
    fireEvent.click(screen.getByRole('button', { name: /کاردکس/ }));
    expect(await screen.findByText('RC-KX-1')).toBeTruthy();
    expect(screen.getByText(formatPersianPrice(1234))).toBeTruthy();
  });
});
