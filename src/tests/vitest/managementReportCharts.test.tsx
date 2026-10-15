import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { toStorageDate } from '../../utils/calendarDate';
import {
  OTHER_CATEGORIES_LABEL, agingChartBars, categoryShareBars, receivablesOf, sparklinePoints, trendPeriodFor,
  type DashboardSummary,
} from '../../lib/reports/reportCharts';
import { purchaseReportFileName, purchaseReportSheet, type PurchaseAmounts, type PurchaseReport } from '../../lib/reports/purchaseReport';
import { canOpenPage } from '../../lib/permissions/pageAccess';

/** v10.1.15 (D-03 بخش ۴، ت۱۴ تا ت۱۶): نمودارهای گزارش‌های مدیریتی، زبانه خرید و ابزارک فروش پیشخوان */

interface FakeAxis { reverse?: boolean; position?: string }
interface FakeOptions { indexAxis?: string; plugins: { legend: { display: boolean } }; scales: { x: FakeAxis; y: FakeAxis } }
interface FakeChart { config: { type: string; data: { labels: string[]; datasets: Array<Record<string, unknown>> }; options: FakeOptions }; destroyed: boolean }
const charts = vi.hoisted(() => [] as FakeChart[]);
// jsdom بوم ندارد؛ Chart.js با کلاسی جایگزین می‌شود که فقط پیکربندی را نگه می‌دارد
vi.mock('chart.js', () => {
  class Chart {
    static register = () => undefined;
    config: FakeChart['config'];
    destroyed = false;
    constructor(_canvas: unknown, config: FakeChart['config']) { this.config = config; charts.push(this); }
    destroy() { this.destroyed = true; }
  }
  return { Chart, BarController: {}, BarElement: {}, CategoryScale: {}, LinearScale: {}, Tooltip: {} };
});
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
import { ReportChartCard } from '../../components/reports/charts/ReportChartCard';
import { SalesSummaryWidget } from '../../components/dashboard/SalesSummaryWidget';

afterEach(() => { cleanup(); fetchJson.mockReset(); downloadReportWorkbook.mockReset(); charts.length = 0; });

const iso = (jalali: string) => toStorageDate(jalali) as string;

function withClient(children: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={children} />
          <Route path="/management-reports/:tab" element={<ManagementReportsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('report chart data (D-03)', () => {
  it('draws a trend by month, by season over 24 months and by year beyond', () => {
    expect(trendPeriodFor({ from: iso('1405/08/01'), to: iso('1405/08/14') })).toBe('month');
    expect(trendPeriodFor({ from: iso('1403/01/01'), to: iso('1404/12/29') })).toBe('month');
    expect(trendPeriodFor({ from: iso('1402/01/01'), to: iso('1404/12/29') })).toBe('quarter');
    expect(trendPeriodFor({ from: iso('1395/01/01'), to: iso('1404/12/29') })).toBe('year');
  });

  it('keeps the eight largest categories and folds the rest into one bar with its count', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ key: `c${i}`, label: `دسته ${i}`, value: String(100 - i * 10) }));
    const bars = categoryShareBars(rows, '550');
    expect(bars).toHaveLength(9);
    expect(bars[0]).toMatchObject({ key: 'c0', value: '100', percent: 18.2 });
    expect(bars[8]).toMatchObject({ key: '__other', label: `${OTHER_CATEGORIES_LABEL} (۲)`, value: '30', percent: 5.5 });
    expect(categoryShareBars(rows.slice(0, 2), '0').map(b => b.percent)).toEqual([null, null]);
  });

  it('gives the five aging bars their share and sums the receivables over 90 days', () => {
    const buckets = { upTo30: '500', upTo60: '200', upTo90: '100', upTo180: '150', over180: '50' };
    expect(agingChartBars(buckets).map(b => `${b.key}:${b.percent}`)).toEqual(['upTo30:50', 'upTo60:20', 'upTo90:10', 'upTo180:15', 'over180:5']);
    expect(receivablesOf(buckets)).toEqual({ total: '1000', over90: '200' });
  });

  it('draws the dashboard trend right to left, the first month on the right', () => {
    const points = sparklinePoints([0, 50, 100], 104, 44, 2);
    expect(points.map(p => p.x)).toEqual([102, 52, 2]);
    expect(points.map(p => p.y)).toEqual([42, 22, 2]);
    expect(sparklinePoints([5, 5], 104, 44).map(p => p.y)).toEqual([2, 2]);
    expect(sparklinePoints([0, 0], 104, 44).map(p => p.y)).toEqual([22, 22]);
  });
});

describe('report bar chart (D-03)', () => {
  const bars = [
    { label: 'مهر ۱۴۰۵', value: 1_200_000, text: '۱٬۲۰۰٬۰۰۰ ریال' },
    { label: 'آبان ۱۴۰۵', value: 800_000, text: '۸۰۰٬۰۰۰ ریال' },
  ];

  it('loads the chart only for data and says so when every bar is zero', async () => {
    render(<ReportChartCard title="روند فروش" bars={bars.map(b => ({ ...b, value: 0 }))} orientation="vertical" emptyText="در این بازه فروشی نیست." />);
    expect(screen.getByText('در این بازه فروشی نیست.')).toBeTruthy();
    expect(charts).toHaveLength(0);
  });

  it('draws one series right to left with no legend and the full amount in its label', async () => {
    render(<ReportChartCard title="روند فروش" bars={bars} orientation="vertical" emptyText="خالی" />);
    const canvas = await screen.findByRole('img');
    expect(canvas.getAttribute('aria-label')).toBe('روند فروش: مهر ۱۴۰۵ ۱٬۲۰۰٬۰۰۰ ریال، آبان ۱۴۰۵ ۸۰۰٬۰۰۰ ریال');
    await waitFor(() => expect(charts).toHaveLength(1));
    const { config } = charts[0];
    expect(config.data.labels).toEqual(['مهر ۱۴۰۵', 'آبان ۱۴۰۵']);
    expect(config.data.datasets).toHaveLength(1);
    expect(config.options.plugins.legend.display).toBe(false);
    expect(config.options.scales.x.reverse).toBe(true);
    expect(config.options.scales.y.position).toBe('right');
    expect(config.data.datasets[0].borderSkipped).toBe('start');
  });

  it('puts the labels of a horizontal chart on the right with bars growing left', async () => {
    render(<ReportChartCard title="سهم دسته‌ها" bars={bars} orientation="horizontal" emptyText="خالی" />);
    await waitFor(() => expect(charts).toHaveLength(1));
    const { options } = charts[0].config;
    expect(options.indexAxis).toBe('y');
    expect(options.scales.y.position).toBe('right');
    expect(options.scales.x.reverse).toBe(true);
  });
});

const amounts = (over: Partial<PurchaseAmounts> = {}): PurchaseAmounts => ({
  documentCount: 2, quantity: null, gross: '5500000', discount: '20000', net: '5480000', averageUnitPrice: null, ...over,
});

function samplePurchaseReport(over: Partial<PurchaseReport> = {}): PurchaseReport {
  return {
    range: { from: iso('1405/08/01'), to: iso('1405/08/30') },
    currency: 'all', groupBy: 'supplier', thenBy: null, period: 'month',
    rows: [{ ...amounts(), group: { key: 'p4', label: 'تأمین‌کننده نمونه', code: null, unit: null }, then: null, previousNet: null, changePercent: null }],
    total: 1, page: 1, limit: 50, totals: amounts(), comparison: null,
    topSuppliers: [{ key: 'p4', label: 'تأمین‌کننده نمونه', code: null, unit: null, quantity: null, net: '5480000' }],
    topItems: [{ key: '9', label: 'مهره کریستالی', code: 'R-9', unit: 'عدد', quantity: '30', net: '5080000' }],
    unconvertedDocuments: 0,
    ...over,
  };
}

describe('purchase report (D-03)', () => {
  it('opens the purchases tab only with reports.purchases', () => {
    expect(canOpenPage('/management-reports/purchases', { permissions: ['reports.purchases'] })).toBe(true);
    expect(canOpenPage('/management-reports/purchases', { permissions: ['reports.sales'] })).toBe(false);
    expect(canOpenPage('/management-reports/purchases', { permissions: ['procurement.view'] })).toBe(false);
  });

  it('writes the quantity and the average price of an item breakdown to the sheet', () => {
    const report = samplePurchaseReport({
      groupBy: 'item',
      rows: [{ ...amounts({ quantity: '30', averageUnitPrice: '169333.3333', net: '5080000' }), group: { key: '9', label: 'مهره کریستالی', code: 'R-9', unit: 'عدد' }, then: null, previousNet: null, changePercent: null }],
    });
    const sheet = purchaseReportSheet(report, [['تأمین‌کننده', 'تأمین‌کننده نمونه']]);
    expect(sheet.columns).toEqual(expect.arrayContaining(['کالا', 'مقدار', 'خرید خالص (ریال)']));
    expect(sheet.rows[0][0]).toBe('مهره کریستالی (R-9)');
    expect(sheet.meta).toEqual(expect.arrayContaining([['تأمین‌کننده', 'تأمین‌کننده نمونه']]));
    expect(purchaseReportFileName(report.range)).toBe('گزارش-خرید-۱۴۰۵-۰۸.xlsx');
  });

  it('shows the purchase tab by supplier and exports it with its top lists', async () => {
    viewerPermissions = ['reports.purchases'];
    fetchJson.mockImplementation((url: string) => {
      if (String(url).startsWith('/reports/purchases')) return Promise.resolve(samplePurchaseReport());
      if (String(url).startsWith('/categories')) return Promise.resolve([{ name: 'مهره', type: 'raw_material' }]);
      return Promise.resolve({ success: true, data: [] });
    });
    withClient(null, '/management-reports/purchases');
    expect((await screen.findAllByText('تأمین‌کننده نمونه')).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'خرید' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'فروش' })).toBeNull();
    const url = String(fetchJson.mock.calls.find(([u]) => String(u).startsWith('/reports/purchases'))?.[0]);
    expect(url).toContain('groupBy=supplier');
    expect(url).toContain('currency=all');
    expect(fetchJson.mock.calls.some(([u]) => String(u).startsWith('/reports/sales'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /خروجی اکسل/ }));
    await waitFor(() => expect(downloadReportWorkbook).toHaveBeenCalledTimes(1));
    const [sheets, fileName] = downloadReportWorkbook.mock.calls[0] as [Array<{ name: string }>, string];
    expect(sheets.map(s => s.name)).toEqual(['گزارش خرید', 'ده تأمین‌کننده بزرگ', 'ده کالای پرخرید']);
    expect(fileName).toBe('گزارش-خرید-۱۴۰۵-۰۸.xlsx');
  });
});

const summary = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  sales: {
    range: { from: iso('1405/08/01'), to: iso('1405/08/14') },
    previousRange: { from: iso('1405/07/01'), to: iso('1405/07/14') },
    netAfterReturns: '12000000', previousNetAfterReturns: '10000000', changePercent: 20,
    trend: ['۰۳', '۰۴', '۰۵', '۰۶', '۰۷', '۰۸'].map((m, i) => ({ key: `1405/${i + 3}`, label: `ماه ${m}`, value: String((i + 1) * 1_000_000) })),
    unconvertedDocuments: 1,
  },
  receivables: { asOf: iso('1405/08/14'), total: '40000000', over90: '7000000', partyCount: 4 },
  ...over,
});

describe('dashboard sales widget (D-03)', () => {
  it('shows the month sales against last month with its six-month trend and the receivables', async () => {
    fetchJson.mockResolvedValue(summary());
    withClient(<SalesSummaryWidget />);
    expect(await screen.findByText('فروش این ماه تا امروز')).toBeTruthy();
    expect(screen.getByText('۱۲٬۰۰۰٬۰۰۰ ریال')).toBeTruthy();
    expect(screen.getByText('+۲۰٪ نسبت به همان روزهای ماه قبل')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('ماه ۰۳');
    expect(screen.getByText('مطالبات از مشتریان')).toBeTruthy();
    expect(screen.getByText('بالای ۹۰ روز: ۷٬۰۰۰٬۰۰۰ ریال')).toBeTruthy();
    expect(screen.getByText(/۱ سند ارزی این ماه نرخ تبدیل ندارد/)).toBeTruthy();
    expect(fetchJson.mock.calls.map(([u]) => String(u))).toEqual(['/reports/dashboard-summary']);
  });

  it('shows only the part the server sends', async () => {
    fetchJson.mockResolvedValue(summary({ sales: null }));
    withClient(<SalesSummaryWidget />);
    expect(await screen.findByText('مطالبات از مشتریان')).toBeTruthy();
    expect(screen.queryByText('فروش این ماه تا امروز')).toBeNull();
  });

  it('says so when the summary cannot be read', async () => {
    fetchJson.mockRejectedValue(new Error('down'));
    withClient(<SalesSummaryWidget />);
    expect(await screen.findByText('خلاصه فروش خوانده نشد.')).toBeTruthy();
  });
});
