import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toStorageDate } from '../../utils/calendarDate';
import { getTodayIsoDate } from '../../utils';
import { reportSheetAoa } from '../../lib/reports/reportExport';
import { presetRange } from '../../lib/reports/reportPeriods';
import {
  vatCurrencyText, vatRateLabel, vatReportSearch, vatVoucherList,
  type VatAmounts, type VatDocumentRow, type VatReport,
} from '../../lib/reports/vatReport';
import { vatReportFileName, vatReportSheets } from '../../lib/reports/vatReportSheets';
import { canOpenPage } from '../../lib/permissions/pageAccess';
import { managementReportPath } from '../../lib/reports/managementReportTabs';

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
const SUMMER = { from: iso('1405/04/01'), to: iso('1405/06/31') };

function amounts(over: Partial<VatAmounts> = {}): VatAmounts {
  return {
    invoiceCount: 2, salesBase: '4100000', salesVat: '415000', returnCount: 1, returnBase: '900000', returnVat: '90000', netVat: '325000', ...over,
  };
}

function doc(over: Partial<VatDocumentRow> = {}): VatDocumentRow {
  return {
    id: 1, kind: 'sale', refNumber: '120', date: iso('1405/05/10'), party: 'خانم نمونه', currency: 'IRR', exchangeRate: null,
    netOwn: '500000', vatOwn: '55000', net: '500000', vat: '55000', percent: 10, expectedVatOwn: '50000', warning: 'rate_mismatch', ...over,
  };
}

function sampleReport(over: Partial<VatReport> = {}): VatReport {
  return {
    range: SUMMER,
    list: 'all',
    rates: [
      { ...amounts(), key: '10', percent: 10 },
      { ...amounts({ invoiceCount: 1, salesBase: '5000000', salesVat: '450000', returnCount: 0, returnBase: '0', returnVat: '0', netVat: '450000' }), key: '9', percent: 9 },
    ],
    totals: amounts({ invoiceCount: 3, salesBase: '9100000', salesVat: '865000', netVat: '775000' }),
    warnings: { unconverted: 1, rate_mismatch: 1, rate_missing: 0 },
    ledger: {
      account: { code: '3203', name: 'مالیات بر ارزش افزوده فروش' },
      opening: { total: '100000', draft: '0' },
      credit: { total: '1865000', draft: '1865000' },
      debit: { total: '90000', draft: '90000' },
      closing: { total: '1875000', draft: '1775000' },
      bySource: { document: { credit: '1865000', debit: '90000' }, treasury: { credit: '0', debit: '0' }, other: { credit: '0', debit: '0' } },
    },
    comparison: {
      documentsNet: '775000',
      ledgerNet: '1775000',
      difference: '1000000',
      rows: [{
        key: 'd7', kind: 'document_unconverted', document: { id: 7, kind: 'sale', refNumber: '125', date: iso('1405/05/12') },
        vouchers: [{ number: 41, status: 'draft', date: iso('1405/05/12') }], expected: '0', ledger: '1000000', difference: '1000000',
      }],
      rowCount: 1,
    },
    documents: [
      doc(),
      doc({ id: 7, refNumber: '125', currency: 'EUR', exchangeRate: null, netOwn: '20', vatOwn: '2', net: null, vat: null, expectedVatOwn: null, warning: 'unconverted' }),
      doc({ id: 8, kind: 'return', refNumber: '9', netOwn: '900000', vatOwn: '90000', net: '900000', vat: '90000', expectedVatOwn: null, warning: null }),
    ],
    total: 3,
    page: 1,
    limit: 50,
    ...over,
  };
}

// v10.1.14 (D-03، طرح گزارش‌های مدیریتی §۴): قرارداد «مالیات بر ارزش افزوده» و خروجی اکسل آن
describe('VAT report contract (D-03)', () => {
  it('labels percents, vouchers and currencies in Persian', () => {
    expect(vatRateLabel(10)).toBe('۱۰٪');
    expect(vatRateLabel(7.5)).toBe('۷٫۵٪');
    expect(vatRateLabel(null)).toBe('نامشخص');
    expect(vatVoucherList([{ number: 12, status: 'draft', date: '' }, { number: 15, status: 'approved', date: '' }])).toBe('۱۲ (پیش‌نویس)، ۱۵');
    expect(vatCurrencyText({ currency: 'EUR', exchangeRate: '500000' })).toContain('با نرخ ۵۰۰٬۰۰۰');
    expect(vatCurrencyText({ currency: 'EUR', exchangeRate: null })).toContain('بی نرخ');
    expect(vatReportSearch({ from: SUMMER.from, to: SUMMER.to, list: 'all', page: 1, limit: 50, export: false })).toBe(`from=${SUMMER.from}&to=${SUMMER.to}&list=all&page=1&limit=50`);
  });

  it('exports the percent summary, the ledger with the comparison, the differences and the documents', () => {
    const sheets = vatReportSheets(sampleReport());
    expect(sheets.map(s => s.name)).toEqual(['به تفکیک درصد', 'دفتر کل', 'تفاوت‌ها', 'فهرست سندها']);
    const [rates, ledger, differences, documents] = sheets;
    expect(rates.rows[0]).toEqual(['۱۰٪', 2, 4100000, 415000, 1, 900000, 90000, 325000]);
    expect(rates.totals).toEqual(['جمع', 3, 9100000, 865000, 1, 900000, 90000, 775000]);
    expect(reportSheetAoa(rates).flat()).toContain('هشدار: سند ارزی بی نرخ تبدیل؛ در جمع‌ها نیامده');
    expect(rates.meta).toContainEqual(['مالیات خرید', 'در برنامه ثبت نمی‌شود؛ این گزارش فقط مالیات فروش را دارد']);
    expect(ledger.rows).toContainEqual(['مانده پایان دوره (بستانکار)', 1875000, 1775000]);
    expect(ledger.rows).toContainEqual(['تفاوت (دفتر منهای سندها)', 1000000, null]);
    expect(differences.rows[0]).toEqual(['سند ارزی بی نرخ که در بخش ۱ نیامده', 'فاکتور فروش ۱۲۵', '۱۴۰۵/۰۵/۱۲', '۴۱ (پیش‌نویس)', 0, 1000000, 1000000]);
    expect(documents.rows[1]).toEqual(['فاکتور فروش', '۱۲۵', '۱۴۰۵/۰۵/۱۰', 'خانم نمونه', expect.stringContaining('بی نرخ'), null, '۱۰٪', null, 'سند ارزی بی نرخ تبدیل؛ در جمع‌ها نیامده']);
    expect(documents.rows[2][0]).toBe('برگشت از فروش');
  });

  it('leaves the ledger sheets out when the VAT account is not mapped, and names the file by the season', () => {
    expect(vatReportSheets(sampleReport({ ledger: null, comparison: null })).map(s => s.name)).toEqual(['به تفکیک درصد', 'فهرست سندها']);
    expect(vatReportFileName(sampleReport())).toBe('مالیات-بر-ارزش-افزوده-۱۴۰۵-تابستان.xlsx');
  });
});

function renderPage(path = '/management-reports/vat') {
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

function routeFetch(report: VatReport) {
  fetchJson.mockImplementation((url: string) => {
    if (String(url).startsWith('/reports/vat')) return Promise.resolve(report);
    return Promise.resolve({ success: true, data: [] });
  });
}

const vatUrls = () => fetchJson.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('/reports/vat'));

describe('VAT tab (D-03)', () => {
  it('opens only with accounting.reports', () => {
    expect(canOpenPage(managementReportPath('vat'), { permissions: ['accounting.reports'] })).toBe(true);
    expect(canOpenPage(managementReportPath('vat'), { permissions: ['reports.sales'] })).toBe(false);
  });

  it('shows this quarter by percent with the warnings, the ledger by source and the documents that make the difference', async () => {
    viewerPermissions = ['accounting.reports'];
    routeFetch(sampleReport());
    renderPage();
    const tenRow = await screen.findByTestId('vat-rate-10');
    expect(tenRow.textContent).toContain('۴۱۵٬۰۰۰');
    expect(screen.getByRole('tab', { name: 'مالیات بر ارزش افزوده' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('vat-warning-unconverted').textContent).toContain('۱ سند');
    expect(screen.queryByTestId('vat-warning-no_vat')).toBeNull();
    expect(screen.getByTestId('vat-source-document').textContent).toContain('۱٬۸۶۵٬۰۰۰');
    expect(screen.getByTestId('vat-comparison').textContent).toContain('۱٬۰۰۰٬۰۰۰');
    const difference = screen.getByTestId('vat-difference-document_unconverted');
    expect(difference.textContent).toContain('فاکتور فروش ۱۲۵');
    expect(difference.textContent).toContain('۴۱ (پیش‌نویس)');
    expect(within(screen.getByTestId('vat-document-1')).getByText('مالیات با درصد سند یکی نیست')).toBeTruthy();
    expect(screen.getByTestId('vat-document-1').textContent).toContain('مالیات درصد: ۵۰٬۰۰۰');
    expect(screen.getByText(/مالیات خرید \(اعتبار مالیاتی\) در برنامه ثبت نمی‌شود/)).toBeTruthy();
    const quarter = presetRange('this_quarter', getTodayIsoDate());
    const url = vatUrls()[0];
    expect(url).toContain(`from=${quarter?.from}`);
    expect(url).toContain(`to=${getTodayIsoDate()}`);
    expect(url).toContain('list=all');
  });

  it('lists only the documents with a warning from page one', async () => {
    viewerPermissions = ['accounting.reports'];
    routeFetch(sampleReport({ total: 120 }));
    renderPage();
    await screen.findByTestId('vat-rate-10');
    fireEvent.click(screen.getByRole('button', { name: 'صفحه بعد' }));
    await waitFor(() => expect(vatUrls().some(u => u.includes('page=2'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'فقط سندهای دارای هشدار' }));
    await waitFor(() => expect(vatUrls().some(u => u.includes('list=warnings') && u.includes('page=1'))).toBe(true));
  });

  it('says when the VAT account is not mapped', async () => {
    viewerPermissions = ['accounting.reports'];
    routeFetch(sampleReport({ ledger: null, comparison: null }));
    renderPage();
    expect((await screen.findByTestId('vat-ledger-missing')).textContent).toContain('در نگاشت حساب‌ها پیدا نشد');
    expect(screen.queryByTestId('vat-comparison')).toBeNull();
  });

  it('exports every document and difference in four sheets', async () => {
    viewerPermissions = ['accounting.reports'];
    routeFetch(sampleReport());
    renderPage();
    await screen.findByTestId('vat-rate-10');
    fireEvent.click(screen.getByRole('button', { name: /خروجی اکسل/ }));
    await waitFor(() => expect(downloadReportWorkbook).toHaveBeenCalledTimes(1));
    const exportUrl = String(vatUrls().find(u => u.includes('export=true')));
    expect(exportUrl).not.toContain('page=');
    expect(exportUrl).not.toContain('limit=');
    const [sheets, fileName] = downloadReportWorkbook.mock.calls[0] as [Array<{ name: string }>, string];
    expect(sheets.map(s => s.name)).toEqual(['به تفکیک درصد', 'دفتر کل', 'تفاوت‌ها', 'فهرست سندها']);
    expect(fileName).toBe('مالیات-بر-ارزش-افزوده-۱۴۰۵-تابستان.xlsx');
  });
});
