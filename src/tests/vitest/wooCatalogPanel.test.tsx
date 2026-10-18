/**
 * 10.2 package 6 (D-04 part A, OBS-R2-83): the item ↔ shop product links of the WooCommerce tab (`WcCatalogPanel`) and the
 * shared catalog helpers (`src/lib/woocommerce/wcCatalog.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { toast } from 'react-hot-toast';
import { fetchJson } from '../../api';
import { WcCatalogPanel } from '../../components/settings/WcCatalogPanel';
import { stockSyncOutcome } from '../../lib/woocommerce/stockSyncOutcome';
import { WC_UNMATCHED_REASON_LABELS, catalogCapNotice, catalogOrderNotice, catalogRefreshMessage, trackingEnabledNote, chunked, siteStockQuantity, type WcCatalogReport } from '../../lib/woocommerce/wcCatalog';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, fetchJson: vi.fn() };
});
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.mocked(fetchJson).mockReset(); vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const REFRESH_BUTTON = 'بازخوانی محصولات سایت';
const SHOP_DOWN = 'فروشگاه پاسخ نداد';

const report: WcCatalogReport = {
  refreshed: true,
  linkedCount: 12,
  lastRefresh: { at: '2026-10-18T05:00:00.000Z', status: 'ok', error: '', summary: {} },
  lastPush: { at: '2026-10-18T05:10:00.000Z', status: 'partial', error: '', summary: {} },
  unmatched: [{ productId: 40, variationId: 0, name: 'گردنبند سایت', sku: 'NK-9', reason: 'unknown_sku' }],
  unmatchedTotal: 3,
  itemsNotOnSite: [{ itemId: 7, code: 'PR-7', name: 'گوشواره بی محصول' }],
  itemsNotOnSiteTotal: 1,
  failing: [{ itemId: 8, code: 'PR-8', name: 'دستبند', error: 'محصول در سایت پیدا نشد' }],
  failingTotal: 1,
  catalogTruncated: false,
  catalogUnordered: false,
};

function serve(refreshAnswer: unknown = { success: true, message: 'پیام کارساز' }, catalog: WcCatalogReport = report) {
  vi.mocked(fetchJson).mockImplementation(async (url: string) => {
    if (url === '/woocommerce/catalog') return catalog;
    if (url === '/woocommerce/refresh-products') return refreshAnswer;
    return [];
  });
}

describe('D-04 the catalog helpers', () => {
  it('sends the shop a whole, non-negative stock', () => {
    expect(siteStockQuantity(4.9)).toBe(4);
    expect(siteStockQuantity(3)).toBe(3);
    expect(siteStockQuantity(-2)).toBe(0);
    expect(siteStockQuantity(Number.NaN)).toBe(0);
  });

  it('splits a push into requests of at most one hundred products', () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    expect(chunked(rows).map(c => c.length)).toEqual([100, 100, 50]);
    expect(chunked([])).toEqual([]);
  });

  it('says how many shop products were read and linked, in Persian digits', () => {
    expect(catalogRefreshMessage({ siteProductCount: 120, linkedCount: 100, unmatchedTotal: 0 }))
      .toBe('۱۲۰ محصول سایت خوانده شد و ۱۰۰ کالا به محصول سایت وصل است.');
    expect(catalogRefreshMessage({ siteProductCount: 5, linkedCount: 3, unmatchedTotal: 2 })).toContain('۲ محصول سایت به هیچ کالایی وصل نشد');
  });

  it('a push that turned on stock tracking on the site says how many products, never silently', () => {
    expect(trackingEnabledNote(3)).toBe(' ردیابی موجودی ۳ محصول در سایت روشن شد.');
    expect(trackingEnabledNote(0)).toBe('');
    expect(stockSyncOutcome({ totalItems: 4, syncedCount: 4, failedCount: 0, trackingEnabledCount: 2, errors: [] }).message)
      .toContain(trackingEnabledNote(2).trim());
    expect(stockSyncOutcome({ totalItems: 4, syncedCount: 4, failedCount: 0, errors: [] }).message).not.toContain('ردیابی');
  });

  it('review N-2: a refresh stopped at the product cap says so', () => {
    expect(catalogCapNotice()).toContain('۱۰٬۰۰۰');
    expect(catalogRefreshMessage({ siteProductCount: 10000, linkedCount: 9000, unmatchedTotal: 0, catalogTruncated: true }))
      .toContain(catalogCapNotice());
    expect(catalogRefreshMessage({ siteProductCount: 10, linkedCount: 9, unmatchedTotal: 0 })).not.toContain(catalogCapNotice());
  });
});

describe('D-04 the item ↔ shop product links panel', () => {
  it('review N-2: the panel keeps the cap notice while the last reading stopped at the cap', async () => {
    serve(undefined, { ...report, catalogTruncated: true });
    render(<WcCatalogPanel canManage={false} stockPushRunning={false} />, { wrapper });
    expect(await screen.findByText(catalogCapNotice())).toBeTruthy();
  });

  it('review M-C: a reading out of id order says its unread links were kept, in the toast and on the panel', async () => {
    expect(catalogRefreshMessage({ siteProductCount: 3, linkedCount: 2, unmatchedTotal: 0, catalogUnordered: true })).toContain(catalogOrderNotice());
    expect(catalogRefreshMessage({ siteProductCount: 3, linkedCount: 2, unmatchedTotal: 0 })).not.toContain(catalogOrderNotice());
    serve(undefined, { ...report, catalogUnordered: true });
    render(<WcCatalogPanel canManage={false} stockPushRunning={false} />, { wrapper });
    expect(await screen.findByText(catalogOrderNotice())).toBeTruthy();
  });

  it('review N-2: no cap notice for a full reading', async () => {
    serve();
    render(<WcCatalogPanel canManage={false} stockPushRunning={false} />, { wrapper });
    expect(await screen.findByText('۱۲')).toBeTruthy();
    expect(screen.queryByText(catalogCapNotice())).toBeNull();
  });

  it('a reader sees the links, the runs and the lists, and no refresh button', async () => {
    serve();
    render(<WcCatalogPanel canManage={false} stockPushRunning={false} />, { wrapper });
    expect(await screen.findByText('۱۲')).toBeTruthy();
    expect(screen.queryByRole('button', { name: REFRESH_BUTTON })).toBeNull();
    expect(screen.getByText('(با خطا در برخی کالاها)')).toBeTruthy();
    expect(screen.getByText(WC_UNMATCHED_REASON_LABELS.unknown_sku)).toBeTruthy();
    expect(screen.getByText('و ۲ مورد دیگر')).toBeTruthy();
    expect(screen.getByText('محصول در سایت پیدا نشد')).toBeTruthy();
    expect(screen.getByText('گوشواره بی محصول')).toBeTruthy();
  });

  it('a manager refreshes the shop products and is told the server result', async () => {
    serve();
    render(<WcCatalogPanel canManage stockPushRunning={false} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: REFRESH_BUTTON }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('پیام کارساز', { duration: 8000 }));
    const calls = vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/refresh-products');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('a failed refresh shows the server message as an error', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url === '/woocommerce/catalog') return report;
      throw new Error(SHOP_DOWN);
    });
    render(<WcCatalogPanel canManage stockPushRunning={false} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: REFRESH_BUTTON }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SHOP_DOWN, { duration: 12000 }));
  });

  it('reads the links again when the bulk stock push of the tab ends, and blocks a refresh while it runs', async () => {
    serve();
    const view = render(<WcCatalogPanel canManage stockPushRunning />, { wrapper });
    const button = await screen.findByRole('button', { name: REFRESH_BUTTON });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const reads = () => vi.mocked(fetchJson).mock.calls.filter(([url]) => url === '/woocommerce/catalog').length;
    const before = reads();
    view.rerender(<WcCatalogPanel canManage stockPushRunning={false} />);
    await waitFor(() => expect(reads()).toBe(before + 1));
  });
});
