import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { fetchJson } from '../../api';
import { useSettings } from '../../hooks/useSettings';
import { WooCommerceTab } from '../../components/settings/WooCommerceTab';

// v10.0.226..v10.0.227: package 15 ledger (TD-997) browser side
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/settings/WcCatalogPanel', () => ({ WcCatalogPanel: () => null }));
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
    expect(result.current.wcStoreUrl).toBeDefined();
    const woo = vi.mocked(fetchJson).mock.calls.filter(([url]) => String(url).startsWith('/woocommerce/'));
    expect(woo).toEqual([]);
  });

  // 10.3 (ARCH review finding 3, part 13): through the shared cache, which cancels a read still on its way on close
  it('the tab reads them once when it opens, with a signal cancelled on close', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetchJson).mockImplementation(async (url: string, opts?: RequestInit) => {
      if (String(url).startsWith('/woocommerce/') && opts?.signal) {
        signals.push(opts.signal);
        return new Promise(() => undefined);
      }
      return [];
    });
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.wcStoreUrl).toBeDefined());
    const noop = vi.fn();
    const props = {
      ...result.current, warehouses: [],
      handleSaveSettings: noop, handleTestWcConnection: noop, handleSyncManualOrder: noop, handleSyncAllStocks: noop,
    };
    const view = render(<WooCommerceTab {...(props as unknown as React.ComponentProps<typeof WooCommerceTab>)} />, { wrapper });
    view.rerender(<WooCommerceTab {...(props as unknown as React.ComponentProps<typeof WooCommerceTab>)} />);
    await waitFor(() => expect(signals).toHaveLength(2));
    const reads = vi.mocked(fetchJson).mock.calls.map(([url]) => String(url)).filter(url => url.startsWith('/woocommerce/'));
    expect(reads.sort()).toEqual(['/woocommerce/order-logs', '/woocommerce/synced-orders']);
    view.unmount();
    await waitFor(() => expect(signals.every(signal => signal.aborted)).toBe(true));
  });
});

describe('OBS-R2-88 the simulator rule follows the events glossary', () => {
  it('has no retired automation or server words', () => {
    const engine = readFileSync(resolve(ROOT, 'services/events/eventActionEngineService.ts'), 'utf8');
    expect(engine).not.toContain('اتوماسیون');
    // v10.3.6 (owner rule): the external server is «سرور بیرونی», never «کارساز بیرونی»
    expect(engine).not.toContain('کارساز بیرونی');
  });
});
