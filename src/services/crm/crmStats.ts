import { and, eq, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmActivities, crmLeads } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { fin } from '../../lib/financialDecimal.js';
import { sortCurrencyTotals, type CrmStats, type CurrencyTotal } from '../../lib/crm/leadCurrencyTotals.js';

const currencySql = sql<string>`UPPER(COALESCE(NULLIF(btrim(${crmLeads.currency}), ''), 'IRR'))`;

async function totalsByCurrency(where: SQL | undefined): Promise<CurrencyTotal[]> {
  const rows = await orm.select({
    currency: currencySql,
    count: sql<string>`count(*)::text`,
    value: sql<string>`COALESCE(SUM(${crmLeads.estimatedValue}), 0)::text`,
  }).from(crmLeads).where(where).groupBy(currencySql);
  return sortCurrencyTotals(rows.map(r => ({ currency: String(r.currency), count: Number(r.count), value: fin(r.value).toNumber() })));
}

const countOf = (totals: CurrencyTotal[]) => totals.reduce((n, t) => n + t.count, 0);

/**
 * v9.0.11 (TD-422، تصمیم مالک محصول ت۷): آمار ارتباط با مشتری؛ ارزش پرونده‌ها فقط به تفکیک ارز. پیش‌تر
 * `totalPipelineValue`، `wonTotalValue` و ارزش هر مرحله مبلغ همه ارزها را با هم جمع می‌زدند (پرونده ۱٬۰۰۰ دلاری و
 * ۲٬۰۰۰٬۰۰۰ ریالی = ۲٬۰۰۱٬۰۰۰ «ریال»).
 */
export async function getCrmStats(): Promise<CrmStats> {
  const pipelineByCurrency = await totalsByCurrency(and(eq(crmLeads.isDeleted, 0), eq(crmLeads.status, 'active')));
  const wonByCurrency = await totalsByCurrency(and(eq(crmLeads.isDeleted, 0), eq(crmLeads.stage, 'won')));

  const todayIso = await businessTodayIsoDate();
  const [pending] = await orm.select({ count: sql<string>`count(*)::text` })
    .from(crmActivities)
    .where(and(
      eq(crmActivities.isDeleted, 0),
      eq(crmActivities.isFollowUpCompleted, 0),
      // v7.0.132 (TD-232): سررسید میلادی ISO است و با «امروز» میلادی مقایسه می‌شود
      sql`COALESCE(${crmActivities.nextFollowUpDate}, '') <> ''`,
      sql`${crmActivities.nextFollowUpDate} <= ${todayIso}::text`,
    ));

  const stageRows = await orm.select({
    stage: crmLeads.stage,
    currency: currencySql,
    count: sql<string>`count(*)::text`,
    value: sql<string>`COALESCE(SUM(${crmLeads.estimatedValue}), 0)::text`,
  }).from(crmLeads).where(eq(crmLeads.isDeleted, 0)).groupBy(crmLeads.stage, currencySql);
  const stageCounts: CrmStats['stageCounts'] = {};
  for (const row of stageRows) {
    if (!row.stage) continue;
    const stage = stageCounts[row.stage] ?? { count: 0, byCurrency: [] };
    stage.count += Number(row.count);
    stage.byCurrency = sortCurrencyTotals([...stage.byCurrency, { currency: String(row.currency), count: Number(row.count), value: fin(row.value).toNumber() }]);
    stageCounts[row.stage] = stage;
  }

  return {
    activeLeadsCount: countOf(pipelineByCurrency),
    pipelineByCurrency,
    wonLeadsCount: countOf(wonByCurrency),
    wonByCurrency,
    pendingFollowupsCount: Number(pending?.count ?? 0),
    stageCounts,
  };
}
