import { fin } from '../financialDecimal.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import {
  AGING_BUCKETS, AGING_OVERDUE_BUCKETS, type AgingBuckets,
} from './agingReport.js';
import { periodBuckets, type ReportPeriodUnit, type ReportRange } from './reportPeriods.js';
import type { SalesChannel } from './salesReport.js';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، تصمیم‌های ت۱۴ و ت۱۶): قرارداد نمودارهای «گزارش‌های مدیریتی» و ابزارک
 * فروش پیشخوان، مشترک کارساز و مرورگر.
 *
 * - روند فروش (`GET /reports/sales/charts`): فروش خالص پس از برگشت هر دوره بازه، با همان پالایه‌های گزارش فروش؛ دوره ماه
 *   است و بازه‌ای که بیش از `SALES_TREND_MAX_BARS` ماه دارد به فصل و سپس سال می‌رود. دوره بی فروش صفر است.
 * - سهم دسته‌ها: `SALES_CHART_CATEGORY_COUNT` دسته بزرگ و «سایر دسته‌ها»، با درصد از جمع وقتی جمع مثبت است.
 * - سن مطالبات: پنج بازه سن از جمع همان زبانه، بی درخواست تازه.
 * - ابزارک پیشخوان (`GET /reports/dashboard-summary`): فروش این ماه تا امروز در برابر همان روزهای ماه قبل، روند شش ماه،
 *   و جمع مطالبات و بخش بالای ۹۰ روز؛ هر بخش فقط برای دارنده کلید خودش.
 */

export const SALES_TREND_MAX_BARS = 24;
export const SALES_CHART_CATEGORY_COUNT = 8;
/** شمار ماه‌های روند ابزارک پیشخوان (ماه جاری هم شمرده می‌شود) */
export const DASHBOARD_TREND_MONTHS = 6;
export const OTHER_CATEGORIES_LABEL = 'سایر دسته‌ها';

export interface ChartBar {
  key: string;
  label: string;
  /** رشته دهدهی */
  value: string;
  /** سهم از جمع با یک رقم اعشار؛ بی جمع مثبت null */
  percent?: number | null;
}

export interface SalesChartFilters {
  partyId?: number | null;
  itemId?: number | null;
  projectId?: number | null;
  category?: string | null;
  channel?: SalesChannel | null;
}

export interface SalesChartParams extends SalesChartFilters {
  from: string;
  to: string;
  /** 'all' یا کد ارز */
  currency: string;
}

export interface SalesChartSeries {
  range: ReportRange;
  currency: string;
  /** دوره روند */
  period: ReportPeriodUnit;
  trend: ChartBar[];
  /** دسته‌های بزرگ و «سایر دسته‌ها»، به ترتیب فروش */
  categories: ChartBar[];
  /** فروش خالص پس از برگشت کل بازه */
  total: string;
}

/** کوچک‌ترین دوره‌ای که روند بازه را در `max` ستون نشان می‌دهد */
export function trendPeriodFor(range: ReportRange, max = SALES_TREND_MAX_BARS): ReportPeriodUnit {
  if (periodBuckets(range, 'month', max)) return 'month';
  if (periodBuckets(range, 'quarter', max)) return 'quarter';
  return 'year';
}

const percentOf = (value: string, total: string): number | null => {
  const t = fin(total);
  if (!t.greaterThan(0)) return null;
  return Math.round(fin(value).toNumber() / t.toNumber() * 1000) / 10;
};

/** دسته‌های به ترتیب فروش ← `count` دسته بزرگ و یک «سایر دسته‌ها» برای بقیه */
export function categoryShareBars(rows: Array<{ key: string; label: string; value: string }>, total: string, count = SALES_CHART_CATEGORY_COUNT): ChartBar[] {
  const head = rows.slice(0, count);
  const rest = rows.slice(count);
  const bars: ChartBar[] = head.map(r => ({ ...r, percent: percentOf(r.value, total) }));
  if (rest.length > 0) {
    const value = rest.reduce((acc, r) => acc.add(r.value), fin(0)).round(4).toString();
    bars.push({ key: '__other', label: `${OTHER_CATEGORIES_LABEL} (${toPersianDigits(String(rest.length))})`, value, percent: percentOf(value, total) });
  }
  return bars;
}

/** میله‌های پنج بازه سن، با سهم هر بازه */
export function agingChartBars(buckets: AgingBuckets): ChartBar[] {
  const total = AGING_BUCKETS.reduce((acc, b) => acc.add(buckets[b.key] ?? '0'), fin(0)).toString();
  return AGING_BUCKETS.map(b => ({ key: b.key, label: b.label, value: buckets[b.key] ?? '0', percent: percentOf(buckets[b.key] ?? '0', total) }));
}

export interface DashboardSalesSummary {
  /** این ماه تا امروز */
  range: ReportRange;
  /** همان روزهای ماه قبل */
  previousRange: ReportRange;
  netAfterReturns: string;
  previousNetAfterReturns: string;
  changePercent: number | null;
  /** شش ماه تا ماه جاری، ماه جاری تا امروز */
  trend: ChartBar[];
  /** سند ارزی بی نرخ که در جمع ریالی نیامد */
  unconvertedDocuments: number;
}

export interface DashboardReceivablesSummary {
  asOf: string;
  /** جمع مانده‌های سن‌دار مطالبات */
  total: string;
  /** بخش بالای ۹۰ روز */
  over90: string;
  partyCount: number;
}

export interface DashboardSummary {
  /** فقط برای `reports.sales` */
  sales: DashboardSalesSummary | null;
  /** فقط برای `accounting.reports` */
  receivables: DashboardReceivablesSummary | null;
}

/** جمع مطالبات سن‌دار و بخش بالای ۹۰ روز از بازه‌های سن */
export function receivablesOf(buckets: AgingBuckets): { total: string; over90: string } {
  const total = AGING_BUCKETS.reduce((acc, b) => acc.add(buckets[b.key] ?? '0'), fin(0)).round(4).toString();
  const over90 = AGING_OVERDUE_BUCKETS.reduce((acc, key) => acc.add(buckets[key] ?? '0'), fin(0)).round(4).toString();
  return { total, over90 };
}

/**
 * نقطه‌های خط روند SVG ابزارک پیشخوان در قاب `width` × `height` با `pad` فاصله. نمودار راست‌به‌چپ است: نخستین ماه در راست.
 * محور از صفر است؛ همه صفر ← خط افقی وسط قاب.
 */
export function sparklinePoints(values: number[], width: number, height: number, pad = 2): Array<{ x: number; y: number }> {
  if (values.length === 0) return [];
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: Math.round((width - pad - i * step) * 10) / 10,
    y: Math.round((span === 0 ? height / 2 : pad + (max - v) / span * (height - pad * 2)) * 10) / 10,
  }));
}
