import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { appQueryClient } from './helpers/queryWrapper';

/**
 * 10.3 package 6 (review of #382): the xlsx library loads when a file is made. When that load fails (offline, or an
 * app tab older than the last update), the user reads a Persian message, never the browser's English chunk error, and
 * an export button whose handler is fired and forgotten still says so.
 */
vi.mock('xlsx', () => {
  throw new Error('Failed to fetch dynamically imported module: /assets/vendor-excel.js');
});
const fetchJson = vi.fn(async (url: string): Promise<unknown> => {
  if (url.startsWith('/inventory/allocations')) {
    return { allocations: [], total: 0, page: 1, limit: 50, statusCounts: { all: 0, allocated: 0, consumed: 0, released: 0 } };
  }
  return [];
});
vi.mock('../../api', () => ({ fetchJson: (url: string) => fetchJson(url), isAbortError: () => false }));
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return { toast: t, default: t };
});
vi.mock('../../components/ConfirmDialogHost', () => ({ confirmAction: async () => true }));

import toast from 'react-hot-toast';
import { XLSX_LOAD_FAILED_MESSAGE, downloadSheet, loadXlsx } from '../../lib/excel/downloadSheet';
import { useBomAllocations } from '../../components/inventory/allocations/useBomAllocations';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('xlsx_load_failure_10_3', () => {
  it('a failed load of the xlsx library rejects with the Persian message', async () => {
    await expect(loadXlsx()).rejects.toThrow(XLSX_LOAD_FAILED_MESSAGE);
    await expect(downloadSheet([{ a: 1 }], 'sheet', 'file.xlsx')).rejects.toThrow(XLSX_LOAD_FAILED_MESSAGE);
  });

  it('the material allocations export tells the user instead of failing silently', async () => {
    const client = appQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBomAllocations(), { wrapper });
    await act(async () => { await result.current.exportExcel(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(XLSX_LOAD_FAILED_MESSAGE));
    expect(result.current.exporting).toBe(false);
  });
});
