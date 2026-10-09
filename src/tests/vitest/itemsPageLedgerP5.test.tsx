import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useItemChangeRefresh } from '../../hooks/queries/useItemQueries';

// Package 5 ledger (TD-987). OBS-R1-75: saving an item or an Excel import refreshes every item and price cache, not
// only the current item page (v10.0.26 refetched that page alone, so the pricing page and transfer designs stayed
// stale). OBS-R1-76: the never-shown import error window, progress overlay and prefix fixer are gone, and the import
// preview toast prints its count in Persian digits.
const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('item writes refresh every item cache (OBS-R1-75)', () => {
  it('invalidates items, prices and transfer designs', () => {
    const client = new QueryClient();
    client.setQueryData(['items', 'list', { page: 2 }], { data: [] });
    client.setQueryData(['prices', 'by-item', 5], []);
    client.setQueryData(['transfers', 'list'], { data: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useItemChangeRefresh(), { wrapper });
    act(() => result.current());
    for (const key of [['items', 'list', { page: 2 }], ['prices', 'by-item', 5], ['transfers', 'list']]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it('is what the items page calls after the item form and the Excel window', () => {
    const page = read('pages/ItemsPage.tsx');
    expect(page).not.toContain('onSuccess={loadItems}');
    expect(page.match(/onSuccess=\{refreshAfterItemChange\}/g)?.length).toBe(2);
  });
});

describe('item Excel import dead code (OBS-R1-76)', () => {
  it('has no unused import error window, progress overlay or prefix fixer', () => {
    const page = read('pages/ItemsPage.tsx');
    expect(page).not.toMatch(/importErrors|importProgress|ImportErrorsModal/);
    expect(existsSync(resolve(ROOT, 'components/items/ImportErrorsModal.tsx'))).toBe(false);
    expect(read('components/excel/useUnifiedExcelImport.ts')).not.toContain('handleFixRowPrefix');
  });

  it('prints the preview row count in Persian digits', () => {
    expect(read('components/excel/useUnifiedExcelImport.ts')).toContain('toast.success(`${formatPersianNumber(validated.length)} ردیف آماده بررسی');
  });
});
