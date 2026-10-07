import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import ReorderAlertsPage from '../../pages/ReorderAlertsPage';
import { createRequisitionSchema } from '../../routes/procurement.schemas';
import { QUERY_KEYS } from '../../lib/queryKeys';
import type { User } from '../../types';

// صفحه نقطه سفارش با React Query: تغییر نقطه سفارش، درخواست خرید و سند خرید کش صفحات دیگر (کالاها، داشبورد،
// تدارکات، اسناد، ...) را باطل می‌کنند و بستن صفحه همه خواندنی‌های در جریان (فهرست هشدارها، طرف‌حساب‌ها) را لغو می‌کند
const fetchJson = vi.fn();
vi.mock('../../api', () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
  isAbortError: (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError',
}));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});

interface RequestInitLike { method?: string; body?: string; signal?: AbortSignal }

const keeper: User = { id: 2, username: 'keeper', full_name: 'انباردار تست', role: 'admin' };
const REORDER_URL = '/items/reorder-alerts';
const SUPPLIERS_URL = '/customers/options';
const wire = {
  id: 7, code: 'R-7', name: 'سیم نقره', type: 'raw_material', unit: 'متر', category: 'سیم',
  current_stock: 2, reorder_point: 10, weighted_average_cost: 1000, deficit: 8, deficit_value: 8000, is_zero_stock: false,
};
const necklace = {
  id: 9, code: 'P-9', name: 'گردنبند ماه', type: 'product', unit: 'عدد', category: 'گردنبند',
  current_stock: 0, reorder_point: 3, weighted_average_cost: 5000, deficit: 3, deficit_value: 15000, is_zero_stock: true,
};
const biStats = { monthlyTrends: [], fastMoving: [], slowMoving: [], deadStock: [] };

function baseResponse(url: string, init?: RequestInitLike): unknown {
  const method = init?.method ?? 'GET';
  if (url === REORDER_URL) return [wire, necklace];
  if (url === '/dashboard-bi-stats') return biStats;
  if (url === SUPPLIERS_URL) return { data: [{ id: 30, name: 'نقره‌سازان', partyType: 'supplier' }] };
  if (url === '/items/7' && method === 'PUT') return { success: true };
  if (url === '/api/procurement/requisitions' && method === 'POST') return { success: true, message: 'درخواست خرید PR-12 با موفقیت ثبت شد.' };
  if (url === '/documents' && method === 'POST') return { success: true, docId: 70 };
  return [];
}

function renderPage(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReorderAlertsPage user={keeper} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const callsTo = (url: string) => fetchJson.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === 'GET').length;
const bodyOf = (url: string, method: string) => {
  const call = fetchJson.mock.calls.find(([u, init]) => u === url && init?.method === method);
  return JSON.parse(String(call?.[1].body));
};

/** داده کش‌شده صفحات دیگر؛ پیش از ذخیره هیچ‌کدام باطل نیست */
function seed(client: QueryClient, keys: QueryKey[]) {
  keys.forEach(key => client.setQueryData(key, { data: [] }));
}
function expectInvalidated(client: QueryClient, keys: QueryKey[], value: boolean) {
  keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(value));
}

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe('ReorderAlertsPage — React Query cache', () => {
  it('changing a reorder point invalidates the Items page lists/details and dashboard stats, and re-reads the alert list', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => Promise.resolve(baseResponse(url, init)));
    const client = newClient();
    // کلیدهای صفحه کالاها (useItemsQuery)، فهرست کامل کالاها، جزئیات کالا و آمار داشبورد
    const otherPages = [
      QUERY_KEYS.items.list({ type: 'raw_material', page: 1, limit: 50, search: '' }),
      QUERY_KEYS.items.list({ type: 'all', all: true }),
      QUERY_KEYS.items.detail(7),
      QUERY_KEYS.dashboard.general(),
    ];
    seed(client, otherPages);

    renderPage(client);
    await screen.findByText('سیم نقره');
    expectInvalidated(client, otherPages, false);
    const listBefore = callsTo(REORDER_URL);

    fireEvent.click(screen.getAllByRole('button', { name: 'ویرایش نقطه' })[0]);
    const input = screen.getByDisplayValue('10');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره تغییرات' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('نقطه سفارش با موفقیت بروزرسانی شد.'));
    // همان PUT صفحه پیشین: کل قلم با نقطه سفارش تازه
    expect(bodyOf('/items/7', 'PUT')).toEqual({ ...wire, reorder_point: 12 });
    expectInvalidated(client, otherPages, true);
    await waitFor(() => expect(callsTo(REORDER_URL)).toBeGreaterThan(listBefore));
    expect(screen.queryByText('ویرایش نقطه سفارش کالا')).toBeNull();
  });

  it('a purchase requisition invalidates procurement and the workflow inbox; a final receipt invalidates stock, documents, Kardex and accounting', async () => {
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => Promise.resolve(baseResponse(url, init)));
    const client = newClient();
    const procurementKeys: QueryKey[] = [[...QUERY_KEYS.procurement.all, 'requisitions'], QUERY_KEYS.workflow.inbox({})];
    const stockKeys = [
      QUERY_KEYS.items.list({ type: 'raw_material', page: 1, limit: 50, search: '' }),
      QUERY_KEYS.documents.list({ page: 1, limit: 50 }),
      QUERY_KEYS.transactions.list({}),
      QUERY_KEYS.accounting.vouchers({}),
      QUERY_KEYS.dashboard.general(),
    ];
    seed(client, [...procurementKeys, ...stockKeys]);

    renderPage(client);
    await screen.findByText('سیم نقره');
    const listBefore = callsTo(REORDER_URL);

    fireEvent.click(screen.getByTitle('ثبت سفارش خرید برای این ماده اولیه'));
    fireEvent.click(await screen.findByRole('button', { name: /ثبت و ارسال درخواست خرید/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('درخواست خرید PR-12 با موفقیت ثبت شد.'));
    expect(bodyOf('/api/procurement/requisitions', 'POST')).toMatchObject({
      title: 'سفارش تامین ماده اولیه سیم نقره', priority: 'normal',
      items: [{ itemId: 7, itemCode: 'R-7', requestedQty: 8, unitPriceEstimate: 1000 }],
    });
    // v9.0.266 (TD-688): همان بدنه از قرارداد سرور می‌گذرد (پیش‌تر سرور ساختگی بدنه‌ای را تأیید می‌کرد که سرور واقعی با ۴۰۰ رد می‌کرد)
    expect(createRequisitionSchema.safeParse({ body: bodyOf('/api/procurement/requisitions', 'POST') }).error?.issues).toBeUndefined();
    expectInvalidated(client, procurementKeys, true);
    expectInvalidated(client, stockKeys, false);
    await waitFor(() => expect(callsTo(REORDER_URL)).toBeGreaterThan(listBefore));

    // صدور مستقیم رسید قطعی
    await screen.findByText('سیم نقره');
    fireEvent.click(screen.getByTitle('ثبت سفارش خرید برای این ماده اولیه'));
    fireEvent.click(await screen.findByText('صدور مستقیم سند انبار / خرید'));
    fireEvent.click(screen.getByText('-- انتخاب یا جستجوی طرف‌حساب --'));
    fireEvent.click(await screen.findByText(/نقره‌سازان/));
    fireEvent.change(screen.getByDisplayValue('پیش‌نویس سفارش خرید (عدم تغییر موجودی)'), { target: { value: 'final' } });
    fireEvent.click(screen.getByRole('button', { name: /ثبت سند خرید انبار/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('رسید قطعی ورود کالا به انبار با موفقیت صادر و موجودی افزایش یافت.'));
    expect(bodyOf('/documents', 'POST')).toMatchObject({
      // v8.0.110 (TD-387): قرارداد POST /documents — شماره خودکار، ورود کالا، تأمین‌کننده در buyer_name، فی در unit_price
      docType: 'receipt', status: 'final', refNumber: 'auto', inOut: 'in', buyer_name: 'نقره‌سازان',
      items: [{ itemId: 7, quantity: 8, unit_price: 1000 }],
    });
    expectInvalidated(client, stockKeys, true);
  });

  it('cancels in-flight reads (alert list refresh and the supplier list of the purchase modal) on unmount', async () => {
    const signals = new Map<string, AbortSignal | undefined>();
    let listCalls = 0;
    fetchJson.mockImplementation((url: string, init?: RequestInitLike) => {
      // اولین خواندن فهرست پاسخ می‌گیرد؛ خواندن دوباره (دکمه بروزرسانی) و طرف‌حساب‌ها معلق می‌مانند
      if ((url === REORDER_URL && ++listCalls > 1) || url === SUPPLIERS_URL) {
        signals.set(url, init?.signal);
        return new Promise(() => undefined);
      }
      return Promise.resolve(baseResponse(url, init));
    });

    const { unmount } = renderPage(newClient());
    await screen.findByText('سیم نقره');
    fireEvent.click(screen.getByTitle('ثبت سفارش خرید برای این ماده اولیه'));
    await waitFor(() => expect(signals.has(SUPPLIERS_URL)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'بروزرسانی' }));
    await waitFor(() => expect(signals.has(REORDER_URL)).toBe(true));

    unmount();

    [REORDER_URL, SUPPLIERS_URL].forEach(url => expect(signals.get(url)?.aborted, url).toBe(true));
  });
});
