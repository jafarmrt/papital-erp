import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { getDisplayTimezone } from '../../lib/businessClock.js';
import { zonedDayRangeUtc } from '../../lib/serverTimestamp.js';
import { FUNNEL_STAGES, conversionPercentOf, type FunnelReport, type FunnelStage } from '../../lib/crm/funnelReport.js';
import { isLostReason } from '../../lib/crm/leadFields.js';

export interface FunnelFilter {
  /** ISO، روز کسب‌وکار */
  fromDate?: string;
  /** ISO، روز کسب‌وکار */
  toDate?: string;
  assignedPersonnelId?: number;
}

type FunnelSqlRow = { stage: string; reason: string; entered: number; advanced: number; avg_days: string | null; measured: number; estimated: number };

/** ترتیب مرحله در قیف؛ «از دست رفته» بیرون از قیف است (-1) */
const stageRank = (column: string) => sql.raw(
  `CASE ${column} WHEN 'lead' THEN 0 WHEN 'qualified' THEN 1 WHEN 'proposal' THEN 2 WHEN 'won' THEN 3 ELSE -1 END`,
);

/**
 * v10.1.18 (N-02 بخش ۲، ت۷): گزارش قیف از `crm_lead_stage_history` در SQL. بازه روز کسب‌وکار با `zonedDayRangeUtc` به بازه
 * UTC زمان تغییر برمی‌گردد؛ پرونده حذف‌شده شمرده نمی‌شود. قاعده‌ها در `src/lib/crm/funnelReport.ts`. تاریخچه پیش از ۱۰.۱.۱۸
 * را migration 0125 از دفترچه اقدامات بازسازی کرده و ورودهای تخمینی آن (`backfill_estimated`) جدا شمرده می‌شوند.
 */
export async function crmFunnelReport(filter: FunnelFilter): Promise<FunnelReport> {
  const range = zonedDayRangeUtc(filter.fromDate, filter.toDate, await getDisplayTimezone());
  const inRange = sql.join([
    sql`true`,
    range.from ? sql`h.changed_at >= ${range.from}::timestamptz` : sql`true`,
    range.before ? sql`h.changed_at < ${range.before}::timestamptz` : sql`true`,
    filter.assignedPersonnelId ? sql`h.assigned_personnel_id = ${filter.assignedPersonnelId}` : sql`true`,
  ], sql` AND `);

  const result = await orm.execute(sql`
    WITH h AS (
      SELECT sh.id, sh.lead_id, sh.to_stage, sh.lost_reason, sh.changed_at, sh.assigned_personnel_id, sh.source,
             lead(sh.changed_at) OVER (PARTITION BY sh.lead_id ORDER BY sh.changed_at, sh.id) AS next_at
      FROM crm_lead_stage_history sh
      JOIN crm_leads l ON l.id = sh.lead_id AND l.is_deleted = 0
    ),
    entries AS (
      SELECT h.*,
             EXISTS (
               SELECT 1 FROM crm_lead_stage_history later
               WHERE later.lead_id = h.lead_id
                 AND (later.changed_at, later.id) > (h.changed_at, h.id)
                 AND ${stageRank('later.to_stage')} > ${stageRank('h.to_stage')}
             ) AS advanced
      FROM h
      WHERE ${inRange}
    )
    SELECT to_stage AS stage, '' AS reason,
           count(DISTINCT lead_id)::int AS entered,
           count(DISTINCT lead_id) FILTER (WHERE advanced)::int AS advanced,
           round(avg(extract(epoch FROM (next_at - changed_at)) / 86400.0) FILTER (WHERE next_at IS NOT NULL)::numeric, 1)::text AS avg_days,
           count(*) FILTER (WHERE next_at IS NOT NULL)::int AS measured,
           count(DISTINCT lead_id) FILTER (WHERE source = 'backfill_estimated')::int AS estimated
    FROM entries WHERE to_stage <> 'lost' GROUP BY to_stage
    UNION ALL
    SELECT 'lost', coalesce(lost_reason, ''), count(DISTINCT lead_id)::int, 0, NULL, 0,
           count(DISTINCT lead_id) FILTER (WHERE source = 'backfill_estimated')::int
    FROM entries WHERE to_stage = 'lost' GROUP BY coalesce(lost_reason, '')
  `);
  const rows = result.rows as FunnelSqlRow[];

  const stages = FUNNEL_STAGES.map((stage: FunnelStage) => {
    const row = rows.find(r => r.stage === stage);
    const entered = Number(row?.entered ?? 0);
    const advanced = stage === 'won' ? 0 : Number(row?.advanced ?? 0);
    return {
      stage,
      entered,
      advanced,
      conversionPercent: conversionPercentOf(entered, advanced, stage),
      avgDays: row?.avg_days != null ? Number(row.avg_days) : null,
      measured: Number(row?.measured ?? 0),
    };
  });
  const lostRows = rows.filter(r => r.stage === 'lost');
  return {
    fromDate: filter.fromDate ?? null,
    toDate: filter.toDate ?? null,
    assignedPersonnelId: filter.assignedPersonnelId ?? null,
    stages,
    estimatedEntries: rows.reduce((n, r) => n + Number(r.estimated ?? 0), 0),
    lost: {
      count: lostRows.reduce((n, r) => n + Number(r.entered), 0),
      reasons: lostRows
        .map(r => ({ reason: isLostReason(r.reason) ? r.reason : '' as const, count: Number(r.entered) }))
        .sort((a, b) => b.count - a.count),
    },
  };
}
