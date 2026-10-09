import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// v10.0.32..v10.0.34: package 5 ledger part 2 (item list, pricing page, Excel import)
const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));

const ROOT = resolve(__dirname, '../..');
const source = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('OBS-R1-74 the item list sorts and counts on the server', () => {
  it('sends the sort column and direction and reads the low-stock count of the whole filter', async () => {
    fetchJson.mockResolvedValue({ data: [], total: 0, page: 1, totalPages: 1, stats: { lowStock: 7 } });
    const { useItemsQuery } = await import('../../hooks/queries/useItemQueries');
    const { result } = renderHook(() => useItemsQuery('product', 1, 50, 'لوتوس', { key: 'code', direction: 'desc' }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const url = String(fetchJson.mock.calls[0][0]);
    expect(url).toContain('sort=code');
    expect(url).toContain('direction=desc');
    expect(result.current.data?.stats.lowStock).toBe(7);
  });

  it('accepts only the listed sort columns', async () => {
    const { parseItemListSort } = await import('../../lib/items/itemListSort');
    expect(parseItemListSort('current_stock', 'desc')).toEqual({ key: 'current_stock', direction: 'desc' });
    expect(parseItemListSort('version', 'asc')).toBeNull();
  });

  it('the items page no longer sorts or counts the current page in the browser', () => {
    const page = source('pages/ItemsPage.tsx');
    expect(page).not.toContain('sortableItems.sort');
    expect(page).toContain('itemsResponse?.stats?.lowStock');
  });
});

describe('OBS-R1-78 Excel and price history requests are cancelled and failures are reported', () => {
  it('a failed import answer has a message', async () => {
    const { importFailureMessage } = await import('../../components/excel/importFailureMessage');
    expect(importFailureMessage({ success: false, message: 'ردیف ۳ نامعتبر است' })).toBe('ردیف ۳ نامعتبر است');
    expect(importFailureMessage({ success: false })).toBe('ورود داده‌های اکسل انجام نشد و چیزی ثبت نشد.');
    expect(importFailureMessage(null)).toBe('ورود داده‌های اکسل انجام نشد و چیزی ثبت نشد.');
  });

  it('the Excel import aborts its metadata requests, handles a read error and reports success false', () => {
    const hook = source('components/excel/useUnifiedExcelImport.ts');
    expect(hook).toContain("fetchJson('/categories', { signal })");
    expect(hook).toContain('reader.onerror');
    expect(hook).toContain('importFailureMessage(res)');
    expect(hook).toContain('metadataAbortRef.current?.abort()');
  });

  it('the pricing page aborts the previous price history and reads files with an error handler', () => {
    const page = source('pages/PricingPage.tsx');
    expect(page).toContain('{ signal: controller.signal }');
    expect(page).toContain('reader.onerror');
  });
});

describe('OBS-R1-79 the pricing page loads one server page and its Excel code on demand', () => {
  it('builds the page address with the filters', async () => {
    const { pricingPageUrl } = await import('../../lib/items/pricingPage');
    expect(pricingPageUrl({ type: 'product', search: ' لوتوس ', category: 'گردنبند', priceFilter: 'missing_price', page: 2, limit: 50 }))
      .toBe(`/items/pricing-page?type=product&search=${encodeURIComponent('لوتوس')}&category=${encodeURIComponent('گردنبند')}&priceFilter=missing_price&page=2&limit=50`);
    expect(pricingPageUrl({ type: 'raw_material', all: true })).toBe('/items/pricing-page?type=raw_material&all=true');
  });

  it('reads no whole item list, no whole price table and no settings, and imports xlsx lazily', () => {
    const page = source('pages/PricingPage.tsx');
    expect(page).not.toContain("import * as xlsx from 'xlsx'");
    expect(page).not.toContain("import UnifiedExcelModal from");
    expect(page).toContain("lazy(() => import('../components/UnifiedExcelModal'))");
    expect(page).toContain("import('xlsx')");
    expect(page).not.toContain('limit=0');
    expect(page).not.toContain("'/items/prices/all'");
    expect(page).not.toContain("fetchJson('/settings')");
  });
});
