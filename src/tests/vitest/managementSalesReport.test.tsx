import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { isoToJalaliDate, toStorageDate } from '../../utils/calendarDate';
import {
  comparisonRange, percentChange, periodBuckets, presetRange, rangeFileTag, type ReportRange,
} from '../../lib/reports/reportPeriods';
import { reportSheetAoa } from '../../lib/reports/reportExport';
import { buildReportWorkbook } from '../../lib/reports/reportWorkbook';
import {
  defaultSalesParams, salesFilterMeta, salesReportFileName, salesReportSheet, salesTopSheets, type SalesReport, type SalesTotals,
} from '../../lib/reports/salesReport';
import { canOpenPage } from '../../lib/permissions/pageAccess';
import { MANAGEMENT_REPORT_TABS, managementReportPath } from '../../lib/reports/managementReportTabs';

const fetchJson = vi.fn();
vi.mock('../../api', () => ({ fetchJson: (...args: unknown[]) => fetchJson(...args) }));
vi.mock('../../hooks/useAppCurrency', async () => {
  const { rialDisplayOf } = await vi.importActual<typeof import('../../lib/rialDisplay')>('../../lib/rialDisplay');
  return { useAppCurrency: () => 'IRR', useRialDisplay: () => rialDisplayOf('IRR') };
});
vi.mock('../../hooks/useCompanyName', () => ({ useCompanyName: () => 'کارگاه آزمون' }));
let viewerPermissions: string[] = [];
vi.mock('../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/AuthContext')>()),
  useViewerAccess: () => ({ permissions: viewerPermissions, isAdmin: false }),
}));
const downloadReportWorkbook = vi.fn();
vi.mock('../../lib/reports/reportWorkbook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reports/reportWorkbook')>()),
  downloadReportWorkbook: (...args: unknown[]) => downloadReportWorkbook(...args),
}));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import ManagementReportsPage from '../../pages/ManagementReportsPage';

afterEach(() => { cleanup(); fetchJson.mockReset(); downloadReportWorkbook.mockReset(); });

const iso = (jalali: string) => toStorageDate(jalali) as string;
const jalali = (range: ReportRange | null) => (range ? [isoToJalaliDate(range.from), isoToJalaliDate(range.to)] : null);
const TODAY = iso('1405/08/14');

// v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۵): دوره‌های شمسی، میان‌برهای بازه و بازه مقایسه گزارش‌های مدیریتی
describe('management report periods (D-03)', () => {
  it('builds the range shortcuts in the Jalali calendar, this period up to today', () => {
    expect(jalali(presetRange('this_month', TODAY))).toEqual(['1405/08/01', '1405/08/14']);
    expect(jalali(presetRange('last_month', TODAY))).toEqual(['1405/07/01', '1405/07/30']);
    expect(jalali(presetRange('this_quarter', TODAY))).toEqual(['1405/07/01', '1405/08/14']);
    expect(jalali(presetRange('last_quarter', TODAY))).toEqual(['1405/04/01', '1405/06/31']);
    expect(jalali(presetRange('this_year', TODAY))).toEqual(['1405/01/01', '1405/08/14']);
    expect(jalali(presetRange('last_year', TODAY))).toEqual(['1404/01/01', '1404/12/29']);
  });

  it('compares with the previous period or the same period last year', () => {
    const mehr = { from: iso('1405/07/01'), to: iso('1405/07/30') };
    expect(jalali(comparisonRange(mehr, 'previous'))).toEqual(['1405/06/01', '1405/06/31']);
    expect(jalali(comparisonRange(mehr, 'last_year'))).toEqual(['1404/07/01', '1404/07/30']);
    const monthToDate = { from: iso('1405/08/01'), to: iso('1405/08/14') };
    expect(jalali(comparisonRange(monthToDate, 'previous'))).toEqual(['1405/07/01', '1405/07/14']);
    const tenDays = { from: iso('1405/08/05'), to: iso('1405/08/14') };
    expect(jalali(comparisonRange(tenDays, 'previous'))).toEqual(['1405/07/25', '1405/08/04']);
    expect(comparisonRange(mehr, 'none')).toBeNull();
  });

  it('splits a range into Jalali months and seasons and refuses too many', () => {
    const range = { from: iso('1405/06/15'), to: iso('1405/08/14') };
    expect(periodBuckets(range, 'month')?.map(b => b.label)).toEqual(['شهریور ۱۴۰۵', 'مهر ۱۴۰۵', 'آبان ۱۴۰۵']);
    expect(periodBuckets(range, 'quarter')?.map(b => b.key)).toEqual(['1405/Q2', '1405/Q3']);
    expect(periodBuckets(range, 'quarter')?.map(b => b.label)).toEqual(['تابستان ۱۴۰۵', 'پاییز ۱۴۰۵']);
    expect(periodBuckets(range, 'month', 2)).toBeNull();
  });

  it('names the export file by the period it covers', () => {
    expect(salesReportFileName({ from: iso('1405/08/01'), to: iso('1405/08/30') })).toBe('گزارش-فروش-۱۴۰۵-۰۸.xlsx');
    expect(rangeFileTag({ from: iso('1405/07/01'), to: iso('1405/09/30') })).toBe('۱۴۰۵-پاییز');
    expect(rangeFileTag({ from: iso('1404/01/01'), to: iso('1404/12/29') })).toBe('۱۴۰۴');
    expect(rangeFileTag({ from: iso('1405/08/05'), to: iso('1405/08/14') })).toBe('۱۴۰۵-۰۸-۰۵-تا-۱۴۰۵-۰۸-۱۴');
  });

  it('gives the change percent to one decimal and none against zero', () => {
    expect(percentChange(110, 100)).toBe(10);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(1, 3)).toBe(-66.7);
    expect(percentChange(5, 0)).toBeNull();
  });
});

const totals = (over: Partial<SalesTotals> = {}): SalesTotals => ({
  invoiceCount: 2, returnCount: 1, quantity: '5', returnQuantity: '1', gross: '3700000', discount: '100000', net: '3600000',
  returnAmount: '900000', netAfterReturns: '2700000', cost: '1000000', grossProfit: '1700000', marginPercent: 63,
  vat: '360000', returnVat: '90000', serviceCharge: '0', ...over,
});

function sampleReport(over: Partial<SalesReport> = {}): SalesReport {
  return {
    range: { from: iso('1405/08/01'), to: iso('1405/08/30') },
    currency: 'all', groupBy: 'item', thenBy: null, period: 'month',
    rows: [{
      ...totals(), group: { key: '7', label: 'گردنبند ستاره', code: 'P-7', unit: 'عدد' }, then: null,
      previousNetAfterReturns: null, changePercent: null,
    }],
    total: 1, page: 1, limit: 50, totals: totals(), comparison: null,
    topItems: [{ key: '7', label: 'گردنبند ستاره', code: 'P-7', unit: 'عدد', quantity: '4', netAfterReturns: '2700000' }],
    topCustomers: [{ key: 'p3', label: 'مشتری نمونه', quantity: null, netAfterReturns: '2700000' }],
    ledger: null, ledgerUnavailable: 'no_access', costVisible: true, unconvertedDocuments: 0,
    ...over,
  };
}

describe('sales report export (D-03)', () => {
  it('writes the page columns, the totals row and the report settings', () => {
    const sheet = salesReportSheet(sampleReport(), salesFilterMeta({ partyId: 3, channel: 'online' }, { party: 'مشتری نمونه' }));
    expect(sheet.columns).toEqual(expect.arrayContaining(['کالا', 'مقدار', 'فروش خالص پس از برگشت (ریال)', 'سود ناخالص (ریال)']));
    expect(sheet.rows[0][0]).toBe('گردنبند ستاره (P-7)');
    expect(sheet.totals?.[0]).toBe('جمع');
    expect(sheet.meta).toEqual(expect.arrayContaining([['مشتری', 'مشتری نمونه'], ['کانال فروش', 'فروشگاه برخط'], ['ارز', 'همه ارزها به ریال']]));
    expect(sheet.meta[0][1]).toBe('۱۴۰۵/۰۸/۰۱ تا ۱۴۰۵/۰۸/۳۰');
  });

  it('leaves cost and profit out for a reader without the item cost key (decision t3)', () => {
    const sheet = salesReportSheet(sampleReport({ costVisible: false }));
    expect(sheet.columns.join('|')).not.toMatch(/بهای تمام‌شده|سود ناخالص/);
  });

  it('labels a single-currency view with its currency and shows no quantity without the item', () => {
    const report = sampleReport({
      currency: 'EUR', groupBy: 'customer',
      rows: [{ ...totals({ quantity: null, returnQuantity: null }), group: { key: 'p3', label: 'مشتری نمونه' }, then: null, previousNetAfterReturns: null, changePercent: null }],
      totals: totals({ quantity: null, returnQuantity: null }),
    });
    const sheet = salesReportSheet(report);
    expect(sheet.columns).not.toContain('مقدار');
    expect(sheet.columns.some(c => c.includes('یورو'))).toBe(true);
  });

  it('names an unlabelled pick by its id', () => {
    expect(salesFilterMeta({ itemId: 9, category: 'گردنبند' })).toEqual([['کالا', 'شناسه ۹'], ['دسته کالا', 'گردنبند']]);
  });

  it('builds a right-to-left workbook with unique sheet names', () => {
    const report = sampleReport();
    const sheets = [salesReportSheet(report), ...salesTopSheets(report), { ...salesReportSheet(report), name: 'گزارش فروش' }];
    const book = buildReportWorkbook(XLSX, sheets);
    expect(book.Workbook?.Views?.[0]?.RTL).toBe(true);
    expect(book.SheetNames).toEqual(['گزارش فروش', 'ده کالای پرفروش', 'ده مشتری بزرگ', 'گزارش فروش 2']);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['گزارش فروش'], { header: 1 });
    const aoa = reportSheetAoa(salesReportSheet(report));
    expect(rows[0]).toEqual(['گزارش فروش']);
    expect(rows.find(r => r[0] === 'جمع')?.length).toBe(aoa[aoa.length - 1].length);
  });
});

function renderPage(path = '/management-reports/sales') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/management-reports" element={<ManagementReportsPage />} />
          <Route path="/management-reports/:tab" element={<ManagementReportsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function routeFetch(report: SalesReport) {
  fetchJson.mockImplementation((url: string) => {
    if (String(url).startsWith('/reports/sales')) return Promise.resolve(report);
    if (String(url).startsWith('/categories')) return Promise.resolve([{ name: 'گردنبند', type: 'product' }]);
    return Promise.resolve({ success: true, data: [] });
  });
}

describe('management reports page (D-03)', () => {
  it('has a page-access row for every tab, opened by the key of its own API', () => {
    // v10.1.10 / v10.1.12: سن مطالبات و بدهی‌ها و مالیات بر ارزش افزوده با کلید گزارش‌های حسابداری (ت۲)
    const tabKeys: Record<string, string> = { sales: 'reports.sales', aging: 'accounting.reports', vat: 'accounting.reports' };
    for (const tab of MANAGEMENT_REPORT_TABS) {
      expect(canOpenPage(managementReportPath(tab.id), { permissions: [tabKeys[tab.id]] })).toBe(true);
      expect(canOpenPage(managementReportPath(tab.id), { permissions: ['reports.view'] })).toBe(false);
    }
  });

  it('shows the sales tab with the report of this month to a holder of reports.sales', async () => {
    viewerPermissions = ['reports.sales'];
    routeFetch(sampleReport({ costVisible: false }));
    renderPage('/management-reports');
    expect(await screen.findAllByText('گردنبند ستاره')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'فروش' }).getAttribute('aria-selected')).toBe('true');
    const url = String(fetchJson.mock.calls.find(([u]) => String(u).startsWith('/reports/sales'))?.[0]);
    expect(url).toContain('groupBy=item');
    expect(url).toContain('currency=all');
    expect(url).toContain(`from=${defaultSalesParams(url.match(/to=([\d-]+)/)?.[1] ?? '').from}`);
    expect(screen.queryByText('سود ناخالص')).toBeNull();
    expect(screen.getByTestId('report-print-header').textContent).toContain('کارگاه آزمون');
  });

  it('shows cost and profit and the ledger check when the server sends them', async () => {
    viewerPermissions = ['reports.sales'];
    routeFetch(sampleReport({
      ledgerUnavailable: null,
      ledger: { reportNet: '2700000', approved: '2000000', draft: '700000', ledgerTotal: '2700000', difference: '0', accounts: [{ code: '5001', name: 'فروش' }] },
    }));
    renderPage();
    expect(await screen.findAllByText('گردنبند ستاره')).toBeTruthy();
    expect(screen.getAllByText('سود ناخالص').length).toBeGreaterThan(0);
    expect(screen.getByText(/با مانده حساب‌های فروش در دفتر کل برابر است/)).toBeTruthy();
  });

  it('exports every row with the same conditions', async () => {
    viewerPermissions = ['reports.sales'];
    routeFetch(sampleReport());
    renderPage();
    await screen.findAllByText('گردنبند ستاره');
    fireEvent.click(screen.getByRole('button', { name: /خروجی اکسل/ }));
    await waitFor(() => expect(downloadReportWorkbook).toHaveBeenCalledTimes(1));
    const exportUrl = String(fetchJson.mock.calls.map(([u]) => String(u)).find(u => u.includes('export=true')));
    expect(exportUrl).not.toContain('page=');
    expect(exportUrl).not.toContain('limit=');
    const [sheets, fileName] = downloadReportWorkbook.mock.calls[0] as [Array<{ name: string }>, string];
    expect(sheets.map(s => s.name)).toEqual(['گزارش فروش', 'ده کالای پرفروش', 'ده مشتری بزرگ']);
    expect(fileName).toBe('گزارش-فروش-۱۴۰۵-۰۸.xlsx');
  });

  it('reloads from page one when a condition changes', async () => {
    viewerPermissions = ['reports.sales'];
    routeFetch(sampleReport({ total: 120 }));
    renderPage();
    await screen.findAllByText('گردنبند ستاره');
    fireEvent.click(screen.getByRole('button', { name: 'صفحه بعد' }));
    await waitFor(() => expect(fetchJson.mock.calls.some(([u]) => String(u).includes('page=2'))).toBe(true));
    fireEvent.change(screen.getByLabelText('تفکیک'), { target: { value: 'customer' } });
    await waitFor(() => expect(fetchJson.mock.calls.some(([u]) => String(u).includes('groupBy=customer&') && String(u).includes('page=1'))).toBe(true));
  });

  it('opens no tab without a report key', async () => {
    viewerPermissions = ['reports.view'];
    renderPage();
    expect(await screen.findByText('هیچ گزارشی از این صفحه برای شما باز نیست.')).toBeTruthy();
    expect(fetchJson.mock.calls.some(([u]) => String(u).startsWith('/reports/sales'))).toBe(false);
  });
});
