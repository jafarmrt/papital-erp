/**
 * Package 15 PR a (WooCommerce tab, `src/hooks/useSettings.ts` + `WooCommerceTab`).
 * TD-723 (B15-21): «آزمایش اتصال» for a non-admin sent the masked keys «********» as credentials, so it always failed.
 * TD-724 (B15-22): the bulk stock sync showed only the server's green message while items failed.
 * TD-730 (B15-28, WooCommerce half): a 403 / 500 on the order lists was swallowed and the tables said «no orders yet».
 * TD-710 (B15-08): the WooCommerce webhook secret was shown in a text field.
 * TD-733 (B15-31): the order log's buyer column was titled «نام خریدار / مبالغ» but shows no amount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { toast } from 'react-hot-toast';
import { ApiError, fetchJson } from '../../api';
import { useSettings } from '../../hooks/useSettings';
import { WooCommerceTab } from '../../components/settings/WooCommerceTab';
import { SYSTEM_ADMIN_SETTING_KEYS } from '../../lib/settings/settingKeyAccess';
import { MASKED_SECRET_VALUE, resolveWcTestCredentials, wcTestConnectionBody } from '../../lib/woocommerce/wcConnectionTest';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

/** GET /settings for a non-admin: the WooCommerce keys come back masked */
const maskedSettings = [
  { key: 'wc_store_url', value: 'https://shop.example.org' },
  { key: 'wc_consumer_key', value: MASKED_SECRET_VALUE },
  { key: 'wc_consumer_secret', value: MASKED_SECRET_VALUE },
  { key: 'wc_webhook_secret', value: MASKED_SECRET_VALUE },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

type Handler = (url: string, opts?: RequestInit) => unknown;
function mockServer(extra: Handler = () => undefined) {
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
    const r = extra(url, opts);
    if (r !== undefined) return r instanceof Error ? Promise.reject(r) : r;
    if ((opts?.method || 'GET') !== 'GET') { posts.push({ url, body: opts?.body ? JSON.parse(String(opts.body)) : null }); return { success: true }; }
    if (url === '/settings') return maskedSettings;
    return [];
  });
  return posts;
}

const stored = { url: 'https://shop.example.org', consumerKey: 'ck_live', consumerSecret: 'cs_live' };

describe('TD-723 WooCommerce connection test uses the stored keys instead of the mask', () => {
  it('the tab of a non-admin sends no masked key to /woocommerce/test-connection', async () => {
    const posts = mockServer();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcConsumerSecret).toBe(MASKED_SECRET_VALUE));
    await act(async () => { await result.current.handleTestWcConnection(); });
    const call = posts.find(p => p.url === '/woocommerce/test-connection');
    expect(call?.body).toEqual({ url: 'https://shop.example.org' });
  });

  it('saving the shop warehouse as a non-admin sends only that key, never the masked keys (fixed since v9.0.131, TD-668)', async () => {
    const posts = mockServer();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcConsumerKey).toBe(MASKED_SECRET_VALUE));
    act(() => { result.current.setWcShopWarehouse('WH2'); });
    await act(async () => { await result.current.handleSaveSettings(); });
    const sent = (posts.find(p => p.url === '/settings')?.body as { settings: Array<{ key: string; value: string }> }).settings;
    expect(sent).toContainEqual({ key: 'wc_shop_warehouse', value: 'WH2' });
    expect(sent.filter(item => SYSTEM_ADMIN_SETTING_KEYS.includes(item.key) || item.value === MASKED_SECRET_VALUE)).toEqual([]);
  });

  it('the body keeps keys the admin typed and drops empty or masked ones', () => {
    expect(wcTestConnectionBody({ url: ' https://a.example/ ', consumerKey: ' ck_1 ', consumerSecret: 'cs_1' }))
      .toEqual({ url: 'https://a.example/', consumerKey: 'ck_1', consumerSecret: 'cs_1' });
    expect(wcTestConnectionBody({ url: '', consumerKey: MASKED_SECRET_VALUE, consumerSecret: '  ' })).toEqual({});
  });

  it('the server takes a missing or masked key from the stored settings at the stored address', () => {
    const viaMask = resolveWcTestCredentials({ url: 'https://shop.example.org/', consumerKey: MASKED_SECRET_VALUE, consumerSecret: MASKED_SECRET_VALUE }, stored);
    expect(viaMask).toEqual({ ok: true, usesStoredKeys: true, credentials: { url: 'https://shop.example.org/', consumerKey: 'ck_live', consumerSecret: 'cs_live' } });
    const empty = resolveWcTestCredentials({}, stored);
    expect(empty).toEqual({ ok: true, usesStoredKeys: true, credentials: stored });
    const typed = resolveWcTestCredentials({ url: 'https://other.example', consumerKey: 'ck_new', consumerSecret: 'cs_new' }, stored);
    expect(typed).toEqual({ ok: true, usesStoredKeys: false, credentials: { url: 'https://other.example', consumerKey: 'ck_new', consumerSecret: 'cs_new' } });
  });

  it('stored keys never go to another address, and missing settings are refused with a Persian message', () => {
    const other = resolveWcTestCredentials({ url: 'https://attacker.example', consumerKey: 'ck_new' }, stored);
    expect(other.ok).toBe(false);
    if (!other.ok) {
      expect(other.code).toBe('WC_TEST_STORED_KEYS_OTHER_URL');
      expect(other.message).toContain('نشانی فروشگاه ذخیره‌شده');
    }
    const noStoredUrl = resolveWcTestCredentials({ url: 'https://attacker.example' }, { ...stored, url: '' });
    expect(noStoredUrl.ok ? '' : noStoredUrl.code).toBe('WC_TEST_STORED_KEYS_OTHER_URL');
    const incomplete = resolveWcTestCredentials({}, { url: 'https://shop.example.org', consumerKey: '', consumerSecret: '' });
    expect(incomplete.ok ? '' : incomplete.code).toBe('WC_TEST_SETTINGS_INCOMPLETE');
  });
});

describe('TD-724 bulk stock sync reports failed items', () => {
  const failedBody = {
    success: true, totalItems: 5, syncedCount: 0, failedCount: 4,
    errors: ['خطا در SKU (A1): 401', 'خطا در SKU (A2): 401', 'خطا در SKU (A3): 401', 'خطا در SKU (A4): 401'],
    message: 'همگام‌سازی دسته‌ای موجودی کل کالاها انجام شد. 0 کالا در ووکامرس به‌روزرسانی شدند.',
  };

  it('a response with failed items is an error toast with the counts and the first errors, never the green message', async () => {
    mockServer((url) => (url === '/woocommerce/sync-all-stocks' ? failedBody : undefined));
    const { result } = renderHook(() => useSettings(), { wrapper });
    await act(async () => { await result.current.handleSyncAllStocks(); });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const message = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(message).toContain('همگام‌سازی موجودی ۴ کالا شکست خورد');
    expect(message).toContain('موجودی ۰ کالا به‌روز شد');
    expect(message).toContain('۱ کالا با این کد در فروشگاه یافت نشد');
    expect(message).toContain('خطا در SKU (A3): 401');
    expect(message).not.toContain('خطا در SKU (A4)');
    expect(message).toContain('و ۱ خطای دیگر');
  });

  it('a clean run is a success toast with the Persian count', async () => {
    mockServer((url) => (url === '/woocommerce/sync-all-stocks' ? { success: true, totalItems: 2, syncedCount: 2, failedCount: 0, errors: [] } : undefined));
    const { result } = renderHook(() => useSettings(), { wrapper });
    await act(async () => { await result.current.handleSyncAllStocks(); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('موجودی ۲ کالا در فروشگاه به‌روز شد.');
  });
});

const noop = () => {};
function renderTab(state: ReturnType<typeof useSettings>) {
  const props = { ...state, warehouses: [], handleSaveSettings: noop, handleTestWcConnection: noop, handleSyncManualOrder: noop, loadSyncedWcOrders: noop, handleSyncAllStocks: noop };
  return render(<WooCommerceTab {...(props as unknown as React.ComponentProps<typeof WooCommerceTab>)} />);
}

describe('TD-730 WooCommerce order lists show a load error instead of «no orders yet»', () => {
  it('a 403 on the order log and a 500 on the invoices are kept and shown with the server message', async () => {
    const forbidden = 'دسترسی غیرمجاز';
    const serverFailure = 'خطای داخلی کارساز';
    mockServer((url) => {
      if (url === '/woocommerce/order-logs') return new ApiError(forbidden, 'AUTHORIZATION_ERROR', 403);
      if (url === '/woocommerce/synced-orders') return new ApiError(serverFailure, 'INTERNAL_ERROR', 500);
      return undefined;
    });
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcOrderLogsError).toBe(forbidden));
    await waitFor(() => expect(result.current.syncedWcOrdersError).toBe(serverFailure));
    renderTab(result.current);
    expect(screen.getByRole('alert').textContent).toBe(`این فهرست خوانده نشد: ${forbidden}`);
    expect(screen.queryByText('هنوز هیچ سفارشی از ووکامرس پردازش نشده است.')).toBeNull();
  });

  it('an empty list that loaded still says no orders, and a processed order note is not styled as an error', async () => {
    mockServer((url) => (url === '/woocommerce/order-logs'
      ? [{ id: 1, wcOrderId: '77', status: 'processed', buyerName: 'خریدار', erpDocumentId: 9, errorMessage: 'طرف حساب تازه «علی (۰۹۳۵)» ساخته شد' }]
      : undefined));
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcOrderLogs).toHaveLength(1));
    expect(result.current.wcOrderLogsError).toBe('');
    renderTab(result.current);
    expect(screen.getByText('طرف حساب تازه «علی (۰۹۳۵)» ساخته شد').className).not.toContain('text-rose-600');
  });
});

describe('TD-733 the WooCommerce order log headers name what the rows show', () => {
  it('the buyer column is not titled with amounts it does not show', async () => {
    mockServer((url) => (url === '/woocommerce/order-logs'
      ? [{ id: 1, wcOrderId: '77', status: 'processed', buyerName: 'خریدار', erpDocumentId: 9, errorMessage: '' }]
      : undefined));
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcOrderLogs).toHaveLength(1));
    renderTab(result.current);
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent);
    expect(headers).toContain('نام خریدار');
    expect(headers.some(h => String(h).includes('مبالغ'))).toBe(false);
  });
});

describe('TD-710 the WooCommerce webhook secret is a password field', () => {
  it('the secret field never shows the key as text', async () => {
    mockServer();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcWebhookSecret).toBe(MASKED_SECRET_VALUE));
    renderTab(result.current);
    const secretField = screen.getByPlaceholderText(/کد محرمانه‌ای که در ووکامرس/) as HTMLInputElement;
    expect(secretField.type).toBe('password');
  });

  // v9.0.398 (TD-734): the order webhook refuses every order while no secret is set, so the tab never calls it optional
  it('the secret field and its help say orders are processed only with the secret', async () => {
    mockServer();
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcWebhookSecret).toBe(MASKED_SECRET_VALUE));
    renderTab(result.current);
    const secretField = screen.getByPlaceholderText(/کد محرمانه‌ای که در ووکامرس/) as HTMLInputElement;
    expect(secretField.placeholder).not.toMatch(/اختیاری/);
    expect(screen.getByText(/سفارش‌ها فقط با این کلید پردازش می‌شوند/)).toBeTruthy();
  });
});
