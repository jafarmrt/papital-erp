import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toStorageDate } from '../../utils/calendarDate';
import { reportSheetAoa } from '../../lib/reports/reportExport';
import {
  AGING_BUCKETS, agingBucketPercents, agingPartyTitle, agingReportFileName, agingReportSheet, agingStatementPath,
  type AgingAmounts, type AgingReport, type AgingRow,
} from '../../lib/reports/agingReport';
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
// v10.1.15: jsdom بوم ندارد؛ نمودار بازه‌های سن با یک عنوان ساده جایگزین می‌شود
vi.mock('../../components/reports/charts/ReportBarChart', () => ({
  ReportBarChart: ({ title }: { title: string }) => <div data-testid="report-bar-chart">{title}</div>,
}));
vi.mock('react-hot-toast', () => { const toast = { error: vi.fn(), success: vi.fn() }; return { default: toast, toast }; });

import ManagementReportsPage from '../../pages/ManagementReportsPage';

afterEach(() => { cleanup(); fetchJson.mockReset(); downloadReportWorkbook.mockReset(); });

const iso = (jalali: string) => toStorageDate(jalali) as string;
const AS_OF = iso('1405/07/23');

function amounts(over: Partial<AgingAmounts> = {}): AgingAmounts {
  return {
    balance: '900000',
    buckets: { upTo30: '300000', upTo60: '400000', upTo90: '0', upTo180: '200000', over180: '0' },
    advance: '0',
    draft: '300000',
    pendingCheques: '120000',
    bouncedCheques: '80000',
    ...over,
  };
}

function row(over: Partial<AgingRow> = {}): AgingRow {
  return {
    ...amounts(),
    key: 'p7',
    party: { id: 7, name: 'خانم نمونه', kind: 'party', deleted: false },
    lastSettlement: { date: iso('1405/07/20'), amount: '120000', byCheque: true },
    ...over,
  };
}

function sampleReport(over: Partial<AgingReport> = {}): AgingReport {
  const totals = { ...amounts(), partyCount: 2 };
  return {
    kind: 'receivable',
    asOf: AS_OF,
    currency: 'all',
    approvedOnly: false,
    sort: 'balance',
    rows: [row(), row({ key: 'nفروشگاه قدیمی', party: { id: null, name: 'فروشگاه قدیمی', kind: 'name', deleted: false }, lastSettlement: null })],
    total: 2,
    page: 1,
    limit: 50,
    totals,
    bucketPercents: agingBucketPercents(totals.buckets),
    account: { code: '1201', name: 'حساب‌های دریافتنی تجاری' },
    chequesApply: true,
    ...over,
  };
}

// v10.1.10 (D-03، طرح گزارش‌های مدیریتی §۳): قرارداد «سن مطالبات و بدهی‌ها» و خروجی اکسل آن
describe('receivables and payables aging contract (D-03)', () => {
  it('gives each bucket its share of the aged balance to one decimal, and none without a balance', () => {
    expect(agingBucketPercents(amounts().buckets)).toEqual({ upTo30: 33.3, upTo60: 44.4, upTo90: 0, upTo180: 22.2, over180: 0 });
    expect(agingBucketPercents({ upTo30: '0', upTo60: '0', upTo90: '0', upTo180: '0', over180: '0' }).upTo30).toBeNull();
    expect(AGING_BUCKETS.map(b => b.label)).toEqual(['جاری تا ۳۰ روز', '۳۱ تا ۶۰ روز', '۶۱ تا ۹۰ روز', '۹۱ تا ۱۸۰ روز', 'بیش از ۱۸۰ روز']);
  });

  it('links a party to its statement and names rows without a party', () => {
    const party = { id: 7, name: 'خانم نمونه', kind: 'party' as const, deleted: false };
    expect(agingStatementPath('receivable', party)).toBe('/accounting/reports?subTab=party_ledger&partyType=customer&partyId=7');
    expect(agingStatementPath('payable', party)).toBe('/accounting/reports?subTab=party_ledger&partyType=supplier&partyId=7');
    expect(agingStatementPath('receivable', { id: null, name: 'x', kind: 'name', deleted: false })).toBeNull();
    expect(agingPartyTitle({ ...party, deleted: true })).toBe('خانم نمونه (حذف‌شده)');
    expect(agingPartyTitle({ id: null, name: 'فروشگاه قدیمی', kind: 'name', deleted: false })).toBe('فروشگاه قدیمی (بی طرف حساب)');
    expect(agingPartyTitle({ id: null, name: '', kind: 'none', deleted: false })).toBe('بی تفصیلی');
  });

  it('exports the page columns, the totals and a bucket share row under them', () => {
    const sheet = agingReportSheet(sampleReport(), 'خانم نمونه');
    expect(sheet.name).toBe('سن مطالبات');
    expect(sheet.columns).toEqual([
      'مشتری', 'مانده (ریال)', 'جاری تا ۳۰ روز (ریال)', '۳۱ تا ۶۰ روز (ریال)', '۶۱ تا ۹۰ روز (ریال)', '۹۱ تا ۱۸۰ روز (ریال)',
      'بیش از ۱۸۰ روز (ریال)', 'پیش‌دریافت (بستانکار) (ریال)', 'از سندهای پیش‌نویس (ریال)', 'چک وصول‌نشده (ریال)',
      'چک برگشتی (ریال)', 'تاریخ آخرین دریافت', 'مبلغ آخرین دریافت (ریال)',
    ]);
    expect(sheet.rows[0]).toEqual(['خانم نمونه', 900000, 300000, 400000, 0, 200000, 0, 0, 300000, 120000, 80000, '۱۴۰۵/۰۷/۲۰', 120000]);
    expect(sheet.rows[1][0]).toBe('فروشگاه قدیمی (بی طرف حساب)');
    expect(sheet.totals?.length).toBe(sheet.columns.length);
    expect(sheet.meta).toContainEqual(['مشتری', 'خانم نمونه']);
    expect(sheet.meta).toContainEqual(['تاریخ گزارش', '۱۴۰۵/۰۷/۲۳']);
    const aoa = reportSheetAoa(sheet);
    expect(aoa[aoa.length - 1]).toEqual(['سهم از مانده سن‌دار (درصد)', null, 33.3, 44.4, 0, 22.2, 0]);
    expect(aoa[aoa.length - 2]).toEqual(sheet.totals);
  });

  it('drops the draft column for approved vouchers only, the bounced column for payables and the cheque columns in a foreign currency', () => {
    expect(agingReportSheet(sampleReport({ approvedOnly: true })).columns).not.toContain('از سندهای پیش‌نویس (ریال)');
    const payable = agingReportSheet(sampleReport({ kind: 'payable' }));
    expect(payable.columns[0]).toBe('تأمین‌کننده');
    expect(payable.columns).toContain('پیش‌پرداخت (بدهکار) (ریال)');
    expect(payable.columns).not.toContain('چک برگشتی (ریال)');
    expect(payable.columns.at(-1)).toBe('مبلغ آخرین پرداخت (ریال)');
    const usd = agingReportSheet(sampleReport({ currency: 'USD', chequesApply: false }));
    expect(usd.columns.some(c => String(c).includes('چک'))).toBe(false);
    expect(usd.columns[1]).toBe('مانده (دلار)');
    expect(usd.rows[0].length).toBe(usd.columns.length);
  });

  it('names the export file by the report date', () => {
    expect(agingReportFileName('receivable', AS_OF)).toBe('سن-مطالبات-۱۴۰۵-۰۷-۲۳.xlsx');
    expect(agingReportFileName('payable', AS_OF)).toBe('سن-بدهی‌ها-۱۴۰۵-۰۷-۲۳.xlsx');
  });
});

function renderPage(path = '/management-reports/aging') {
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

function routeFetch(report: AgingReport) {
  fetchJson.mockImplementation((url: string) => {
    if (String(url).startsWith('/reports/aging')) return Promise.resolve(report);
    return Promise.resolve({ success: true, data: [] });
  });
}

const agingUrls = () => fetchJson.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('/reports/aging'));

describe('receivables and payables aging tab (D-03)', () => {
  it('opens only with accounting.reports', () => {
    expect(canOpenPage(managementReportPath('aging'), { permissions: ['accounting.reports'] })).toBe(true);
    expect(canOpenPage(managementReportPath('aging'), { permissions: ['reports.sales'] })).toBe(false);
    expect(canOpenPage('/management-reports', { permissions: ['accounting.reports'] })).toBe(true);
  });

  it('shows the receivables of today to a holder of accounting.reports, with links to the statements and the draft share', async () => {
    viewerPermissions = ['accounting.reports'];
    routeFetch(sampleReport());
    renderPage('/management-reports');
    const link = await screen.findByRole('link', { name: 'خانم نمونه' });
    expect(link.getAttribute('href')).toBe('/accounting/reports?subTab=party_ledger&partyType=customer&partyId=7');
    expect(screen.getByRole('tab', { name: 'سن مطالبات و بدهی‌ها' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'فروش' })).toBeNull();
    expect(screen.getByText('فروشگاه قدیمی (بی طرف حساب)')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('از سندهای پیش‌نویس است');
    expect(screen.getByTestId('aging-bucket-upTo60').textContent).toContain('۴۴٫۴٪');
    const url = agingUrls()[0];
    expect(url).toContain('kind=receivable');
    expect(url).toContain('currency=all');
    expect(url).toMatch(/asOf=\d{4}-\d{2}-\d{2}/);
    expect(url).not.toContain('approvedOnly');
  });

  it('switches to payables and to approved vouchers only, from page one', async () => {
    viewerPermissions = ['accounting.reports'];
    routeFetch(sampleReport({ total: 120 }));
    renderPage();
    await screen.findByRole('link', { name: 'خانم نمونه' });
    fireEvent.click(screen.getByRole('button', { name: 'صفحه بعد' }));
    await waitFor(() => expect(agingUrls().some(u => u.includes('page=2'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'بدهی به تأمین‌کنندگان' }));
    await waitFor(() => expect(agingUrls().some(u => u.includes('kind=payable') && u.includes('page=1'))).toBe(true));
    fireEvent.click(screen.getByRole('checkbox', { name: 'فقط سندهای تأییدشده' }));
    await waitFor(() => expect(agingUrls().some(u => u.includes('kind=payable') && u.includes('approvedOnly=true'))).toBe(true));
  });

  it('exports every row with the same conditions', async () => {
    viewerPermissions = ['accounting.reports'];
    routeFetch(sampleReport());
    renderPage();
    await screen.findByRole('link', { name: 'خانم نمونه' });
    fireEvent.click(screen.getByRole('button', { name: /خروجی اکسل/ }));
    await waitFor(() => expect(downloadReportWorkbook).toHaveBeenCalledTimes(1));
    const exportUrl = String(agingUrls().find(u => u.includes('export=true')));
    expect(exportUrl).not.toContain('page=');
    expect(exportUrl).not.toContain('limit=');
    const [sheets, fileName] = downloadReportWorkbook.mock.calls[0] as [Array<{ name: string }>, string];
    expect(sheets.map(s => s.name)).toEqual(['سن مطالبات']);
    expect(fileName).toBe('سن-مطالبات-۱۴۰۵-۰۷-۲۳.xlsx');
  });
});
