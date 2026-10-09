import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { fetchJson } from '../../api';
import { useSettings } from '../../hooks/useSettings';
import { WooCommerceTab } from '../../components/settings/WooCommerceTab';

// v10.0.31..v10.0.32: package 15 ledger (TD-997) browser side
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); });

const ROOT = resolve(__dirname, '../..');

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('OBS-PR-17 the WooCommerce lists load only with the WooCommerce tab', () => {
  it('opening the settings reads no WooCommerce list', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => (url === '/settings' ? [] : []));
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(vi.mocked(fetchJson).mock.calls.some(([url]) => url === '/settings')).toBe(true));
    await new Promise(r => setTimeout(r, 20));
    expect(result.current.wcOrderLogs).toEqual([]);
    const woo = vi.mocked(fetchJson).mock.calls.filter(([url]) => String(url).startsWith('/woocommerce/'));
    expect(woo).toEqual([]);
  });

  it('the tab loads them once when it opens, with a signal it aborts on close', async () => {
    vi.mocked(fetchJson).mockImplementation(async () => []);
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcStoreUrl).toBeDefined());
    const load = vi.fn();
    const noop = vi.fn();
    const props = {
      ...result.current, warehouses: [], loadSyncedWcOrders: load,
      handleSaveSettings: noop, handleTestWcConnection: noop, handleSyncManualOrder: noop, handleSyncAllStocks: noop,
    };
    const view = render(<WooCommerceTab {...(props as unknown as React.ComponentProps<typeof WooCommerceTab>)} />);
    view.rerender(<WooCommerceTab {...(props as unknown as React.ComponentProps<typeof WooCommerceTab>)} />);
    expect(load).toHaveBeenCalledTimes(1);
    const signal = load.mock.calls[0][0] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe('OBS-R2-88 the simulator rule follows the events glossary', () => {
  it('has no «اتوماسیون» or «سرور بیرونی»', () => {
    const engine = readFileSync(resolve(ROOT, 'services/events/eventActionEngineService.ts'), 'utf8');
    expect(engine).not.toContain('اتوماسیون');
    expect(engine).not.toContain('سرور بیرونی');
  });
});
