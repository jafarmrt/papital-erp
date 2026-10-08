/**
 * Package 15 PR a (WooCommerce tab, `src/hooks/useSettings.ts` + `WooCommerceTab`).
 * TD-723 (B15-21): «آزمایش اتصال» for a non-admin sent the masked keys «********» as credentials, so it always failed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { useSettings } from '../../hooks/useSettings';
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
