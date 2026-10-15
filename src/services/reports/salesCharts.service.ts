import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import {
  DASHBOARD_TREND_MONTHS, categoryShareBars, receivablesOf, trendPeriodFor,
  type ChartBar, type DashboardReceivablesSummary, type DashboardSalesSummary, type SalesChartParams, type SalesChartSeries,
} from '../../lib/reports/reportCharts.js';
import { comparisonRange, percentChange, periodBuckets, presetRange, unitRange, type ReportPeriodUnit, type ReportRange } from '../../lib/reports/reportPeriods.js';
import { NET_AFTER_SUM, salesFactsCte, unconvertedDocsSql, type SalesScope } from './salesReportQuery.js';
import { agingReport } from './agingReport.service.js';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، ت۱۴ و ت۱۶): داده نمودارهای گزارش فروش و ابزارک فروش پیشخوان، با همان
 * قاعده شمردن گزارش فروش (`salesReportQuery.ts`). جمع‌ها در پایگاه‌داده است و فقط یک ردیف برای هر دوره یا دسته برمی‌گردد.
 */

type Row = Record<string, unknown>;

const str = (value: unknown): string => fin(String(value ?? '0')).round(4).toString();

/** فروش خالص پس از برگشت هر دوره بازه به ترتیب، دوره بی فروش صفر */
async function trendBars(scope: SalesScope, range: ReportRange, unit: ReportPeriodUnit): Promise<ChartBar[]> {
  const buckets = periodBuckets(range, unit) ?? [];
  const res = await orm.execute(sql`${salesFactsCte({ ...scope, buckets })}
    SELECT COALESCE(f.period_key, '') AS key, ${NET_AFTER_SUM}::text AS net FROM sales_facts f GROUP BY COALESCE(f.period_key, '')`);
  const byKey = new Map((res.rows as Row[]).map(r => [String(r.key ?? ''), str(r.net)]));
  return buckets.map(b => ({ key: b.key, label: b.label, value: byKey.get(b.key) ?? '0' }));
}

async function netOf(scope: SalesScope): Promise<string> {
  const res = await orm.execute(sql`${salesFactsCte(scope)} SELECT ${NET_AFTER_SUM}::text AS net FROM sales_facts f`);
  return str((res.rows as Row[])[0]?.net);
}

export async function salesChartSeries(params: SalesChartParams): Promise<SalesChartSeries> {
  if (params.from > params.to) {
    throw new ValidationError('آغاز بازه گزارش پس از پایان آن است.', undefined, 'REPORT_RANGE_INVALID');
  }
  const range: ReportRange = { from: params.from, to: params.to };
  const scope: SalesScope = {
    range,
    currency: params.currency,
    partyId: params.partyId,
    itemId: params.itemId,
    projectId: params.projectId,
    category: params.category,
    channel: params.channel,
  };
  const period = trendPeriodFor(range);
  const [trend, categoryRes, total] = await Promise.all([
    trendBars(scope, range, period),
    orm.execute(sql`${salesFactsCte(scope)}
      SELECT lower(f.category) AS key, MIN(NULLIF(f.category, '')) AS label, ${NET_AFTER_SUM}::text AS net
        FROM sales_facts f
       GROUP BY lower(f.category)
       ORDER BY ${NET_AFTER_SUM} DESC, lower(f.category) ASC`),
    netOf(scope),
  ]);
  const categoryRows = (categoryRes.rows as Row[]).map(r => ({
    key: String(r.key ?? ''),
    label: r.label === null || r.label === undefined ? 'بی دسته' : String(r.label),
    value: str(r.net),
  }));
  return { range, currency: params.currency, period, trend, categories: categoryShareBars(categoryRows, total), total };
}

/** فروش این ماه تا امروز در برابر همان روزهای ماه قبل، و روند شش ماه (همه ارزها به ریال، بی پالایه) */
export async function dashboardSalesSummary(todayIso: string): Promise<DashboardSalesSummary> {
  const range = presetRange('this_month', todayIso) ?? { from: todayIso, to: todayIso };
  const previousRange = comparisonRange(range, 'previous') ?? range;
  const trendRange: ReportRange = { from: unitRange(todayIso, 'month', 1 - DASHBOARD_TREND_MONTHS)?.from ?? range.from, to: todayIso };
  const scopeOf = (r: ReportRange): SalesScope => ({ range: r, currency: 'all' });
  const [net, previous, trend, unconverted] = await Promise.all([
    netOf(scopeOf(range)),
    netOf(scopeOf(previousRange)),
    trendBars(scopeOf(trendRange), trendRange, 'month'),
    orm.execute(unconvertedDocsSql(scopeOf(range))),
  ]);
  return {
    range,
    previousRange,
    netAfterReturns: net,
    previousNetAfterReturns: previous,
    changePercent: percentChange(Number(net), Number(previous)),
    trend,
    unconvertedDocuments: Number((unconverted.rows as Row[])[0]?.n ?? 0),
  };
}

/** جمع مطالبات سن‌دار تا امروز و بخش بالای ۹۰ روز، از همان گزارش سن (همه ارزها به ریال، با پیش‌نویس) */
export async function dashboardReceivablesSummary(todayIso: string): Promise<DashboardReceivablesSummary> {
  const aging = await agingReport({
    kind: 'receivable', asOf: todayIso, currency: 'all', approvedOnly: false, partyId: null, sort: 'balance', page: 1, limit: 1,
  });
  return { asOf: todayIso, ...receivablesOf(aging.totals.buckets), partyCount: aging.totals.partyCount };
}
