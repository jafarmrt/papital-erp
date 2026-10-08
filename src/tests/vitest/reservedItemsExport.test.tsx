import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as realXlsx from 'xlsx';
import type { ReservedItemsFullReport } from '../../lib/inventory/reservedItemsReport';

const fetchJson = vi.fn();
const writeFile = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('xlsx', async () => {
  const actual = await vi.importActual<typeof import('xlsx')>('xlsx');
  return { ...actual, writeFile: (...args: unknown[]) => writeFile(...args) };
});
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import ReservedItemsReportPage from '../../pages/ReservedItemsReportPage';
import InvoicesListPage from '../../pages/InvoicesListPage';
import { SearchProvider } from '../../SearchContext';

afterEach(() => {
  cleanup();
  fetchJson.mockReset();
  writeFile.mockReset();
  window.history.replaceState({}, '', '/');
});

// A name with «#» cut the old data-URL CSV short and «"» shifted its columns (P07 proof F3)
const trickyName = 'زنجیر #12 "ریز"';
const proforma = {
  id: 'proforma-1-7', sourceType: 'proforma' as const, sourceLabel: 'پیش‌فاکتور فروش', sourceId: 1, sourceRef: 'PF/1001',
  sourceTitle: 'پیش‌فاکتور PF/1001', buyerOrCustomer: '', itemId: 7, itemCode: 'P-7', itemName: trickyName,
  category: 'سنگ', unit: 'عدد', reservedQty: 2, unitCost: 1000, totalCost: 2000, date: '2026-10-01',
};
const project = { ...proforma, id: 'project-5-7', sourceType: 'project' as const, sourceLabel: 'کنترل پروژه', sourceId: 5, sourceRef: 'PRJ-5', sourceTitle: 'پروژه آزمایشی' };
const report = (cost: boolean): ReservedItemsFullReport => ({
  summaryMetrics: { totalReservedItemsCount: 1, totalReservedQty: 4, proformaReservationsCount: 1, projectReservationsCount: 1, ...(cost ? { totalReservedCost: 4000 } : {}) },
  itemSummaries: [{
    itemId: 7, itemCode: 'P-7', itemName: trickyName, category: 'سنگ', unit: 'عدد', currentStock: 10, proformaReservedQty: 2,
    projectReservedQty: 2, totalReservedQty: 4, availableStock: 6, reservations: [proforma, project],
    ...(cost ? { weightedAverageCost: 1000, totalReservedCost: 4000 } : {}),
  }],
  allReservationEntries: [proforma, project],
  access: { cost, buyer: false },
});

async function exportReport(cost: boolean, tab?: RegExp) {
  fetchJson.mockResolvedValueOnce(report(cost));
  render(<MemoryRouter><ReservedItemsReportPage /></MemoryRouter>);
  expect(await screen.findAllByText('P-7')).toBeTruthy();
  if (tab) fireEvent.click(screen.getByText(tab));
  fireEvent.click(screen.getByText('خروجی اکسل'));
  expect(writeFile).toHaveBeenCalledTimes(1);
  const [workbook, fileName] = writeFile.mock.calls[0] as [realXlsx.WorkBook, string];
  // written and read back the way Excel opens the file
  const reread = realXlsx.read(realXlsx.write(workbook, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  const sheet = reread.Sheets[reread.SheetNames[0]];
  const headers = (realXlsx.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []).map(String);
  return { fileName, rows: realXlsx.utils.sheet_to_json<Record<string, unknown>>(sheet), headers };
}

// v9.0.402 (TD-828، یافته B07-12، تصمیم ت۸): «خروجی اکسل» فایل xlsx واقعی با نام «اقلام-رزروشده-<تاریخ شمسی>.xlsx» است و
// نام کالا با «#» و «"» دست‌نخورده می‌ماند؛ ستون بها با برچسب ریال فقط برای خواننده بها؛ پیوند پیش‌فاکتور به فهرست اسناد
// جست‌وجوشده با شماره‌اش و پیوند پروژه به کنترل موجودی همان پروژه می‌رود و فهرست اسناد جست‌وجوی نشانی را می‌خواند.
// پیش‌تر CSV با `encodeURI` در نشانی داده، نام «reserved_items_report_<میلادی>.csv» و پیوندهای `/invoices?search=` و
// `/projects?projectId=` بود که هیچ‌کدام نشانی را نمی‌خواندند.
describe('reserved items report export and source links (TD-828)', () => {
  it('writes an xlsx file with a Persian name and the item rows intact', async () => {
    const { fileName, rows, headers } = await exportReport(true);
    expect(fileName).toMatch(/^اقلام-رزروشده-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(rows).toHaveLength(1);
    expect(rows[0]['نام کالا']).toBe(trickyName);
    expect(rows[0]['موجودی آزاد']).toBe(6);
    expect(headers).toContain('بهای تمام‌شده رزرو (ریال)');
  });

  it('writes each reservation of the ledger tab with its cost only for a cost reader', async () => {
    const withCost = await exportReport(true, /دفتر ریز پرونده‌های رزرو/);
    expect(withCost.rows.map(r => r['شماره منبع'])).toEqual(['PF/1001', 'PRJ-5']);
    expect(withCost.rows[0]['نام کالا']).toBe(trickyName);
    expect(withCost.headers).toEqual(expect.arrayContaining(['میانگین موزون بها (ریال)', 'بهای تمام‌شده (ریال)']));
    cleanup();
    writeFile.mockReset();
    const withoutCost = await exportReport(false, /دفتر ریز پرونده‌های رزرو/);
    expect(withoutCost.headers.some(h => h.includes('بها'))).toBe(false);
    expect(withoutCost.rows.map(r => r['شماره منبع'])).toEqual(['PF/1001', 'PRJ-5']);
  });

  it('links a proforma to the searched documents list and a project to its inventory control', async () => {
    fetchJson.mockResolvedValueOnce(report(true));
    render(<MemoryRouter><ReservedItemsReportPage /></MemoryRouter>);
    expect(await screen.findAllByText('P-7')).toBeTruthy();
    fireEvent.click(screen.getByText(/دفتر ریز پرونده‌های رزرو/));
    expect(screen.getByText('مشاهده پیش‌فاکتور').closest('a')?.getAttribute('href')).toBe('/invoices?search=PF%2F1001');
    expect(screen.getByText('مشاهده کنترل موجودی پروژه').closest('a')?.getAttribute('href')).toBe('/project-inventory?projectId=5');
  });

  it('opens the documents list searched by the number in its address', async () => {
    window.history.replaceState({}, '', '/invoices?search=PF%2F1001');
    fetchJson.mockImplementation((url: string) => Promise.resolve(url.startsWith('/documents?') ? { data: [], total: 0, page: 1, totalPages: 1 } : []));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SearchProvider><InvoicesListPage /></SearchProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      const listUrls = fetchJson.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/documents?'));
      expect(listUrls.some(u => new URLSearchParams(u.split('?')[1]).get('search') === 'PF/1001')).toBe(true);
    });
  });
});
