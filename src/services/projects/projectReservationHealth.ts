import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.349 (TD-817، یافته B07-01، تصمیم ت۲ بسته ۷): فقط رزرو ذخیره‌شده پروژه ثبت نهایی‌شده موجودی را رزرو می‌کند. پروژه‌هایی
 * که پیش از این قاعده با رزرو ناهمخوان ذخیره شده‌اند خودکار تغییر نمی‌کنند و فقط این‌جا فهرست می‌شوند:
 * - پروژه ثبت نهایی‌شده‌ای که پیش از ثبت رزرو در سرور (v8.0.58، TD-306) نهایی شده و رزرو ذخیره‌شده و زمان ثبت نهایی ندارد:
 *   پیش‌تر خواننده رزرو آن را هر بار از بخش‌ها می‌ساخت و اکنون هیچ رزرو نمی‌کند؛ برای رزرو دوباره، پروژه را از ثبت نهایی
 *   خارج و دوباره ثبت نهایی کنید.
 * - پروژه ثبت نهایی‌نشده‌ای که رزرو ذخیره‌شده دارد: این رزرو دیگر شمرده نمی‌شود.
 */
export type ProjectReservationIssueKind = 'finalized_without_reservation' | 'unfinalized_with_reservation';

export interface ProjectReservationIssue {
  projectId: number;
  projectCode: string | null;
  title: string | null;
  kind: ProjectReservationIssueKind;
  /** تعداد ردیف‌های رزرو ذخیره‌شده */
  reservedRows: number;
}

const ISSUE_LABELS: Record<ProjectReservationIssueKind, string> = {
  finalized_without_reservation: 'ثبت نهایی پیش از رزرو سرور، بی رزرو ذخیره‌شده',
  unfinalized_with_reservation: 'ثبت نهایی‌نشده با رزرو ذخیره‌شده',
};

const ISSUE_ADVICE: Record<ProjectReservationIssueKind, string> = {
  finalized_without_reservation: 'برای رزرو، پروژه را از ثبت نهایی خارج و دوباره ثبت نهایی کنید.',
  unfinalized_with_reservation: 'این رزرو شمرده نمی‌شود؛ با ثبت نهایی پروژه رزرو تازه ساخته می‌شود.',
};

export async function findProjectReservationIssues(executor: DbExecutor = orm): Promise<ProjectReservationIssue[]> {
  const res = await executor.execute(sql`
    WITH p AS (
      SELECT id, project_code, title,
             COALESCE(inventory_control -> 'isFinalized' = 'true'::jsonb, false) AS finalized,
             CASE WHEN jsonb_typeof(inventory_control -> 'reservedItems') = 'array'
                  THEN jsonb_array_length(inventory_control -> 'reservedItems') ELSE 0 END AS reserved_rows,
             NULLIF(btrim(COALESCE(inventory_control ->> 'finalizedAt', '')), '') AS finalized_at
        FROM production_projects
       WHERE is_deleted = 0
         AND status NOT IN ('completed', 'cancelled')
         AND jsonb_typeof(inventory_control) = 'object'
    )
    SELECT id AS "projectId", project_code AS "projectCode", title, reserved_rows AS "reservedRows",
           CASE WHEN finalized THEN 'finalized_without_reservation' ELSE 'unfinalized_with_reservation' END AS kind
      FROM p
     WHERE (finalized AND reserved_rows = 0 AND finalized_at IS NULL)
        OR (NOT finalized AND reserved_rows > 0)
     ORDER BY id`);
  return ((res.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    projectId: Number(r.projectId),
    projectCode: (r.projectCode as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    kind: r.kind as ProjectReservationIssueKind,
    reservedRows: Number(r.reservedRows) || 0,
  }));
}

export function buildProjectReservationHealthTest(issues: ProjectReservationIssue[]): HealthCheckTestResult {
  const count = (kind: ProjectReservationIssueKind) => issues.filter(i => i.kind === kind).length;
  return {
    id: 'project_reservation_integrity',
    category: 'inventory',
    title: 'رزرو پروژه ناهمخوان با ثبت نهایی',
    description: 'فقط رزرو ذخیره‌شده پروژه ثبت نهایی‌شده موجودی را رزرو می‌کند؛ پروژه‌های قدیمی ناهمخوان خودکار تغییر نمی‌کنند',
    status: issues.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: issues.length,
    message: issues.length > 0
      ? `${issues.length} پروژه رزرو ناهمخوان با ثبت نهایی دارد. هیچ‌کدام خودکار تغییر نمی‌کند؛ راهنمای هر ردیف را ببینید.`
      : 'رزرو همه پروژه‌های فعال با ثبت نهایی آن‌ها همخوان است.',
    items: issues.map(i => ({
      id: i.projectId,
      code: i.projectCode || `PRJ-${i.projectId}`,
      title: i.title || `پروژه ${i.projectId}`,
      subtitle: ISSUE_LABELS[i.kind],
      details: `${ISSUE_ADVICE[i.kind]} (TD-817)`,
    })),
    metrics: {
      finalizedWithoutReservation: count('finalized_without_reservation'),
      unfinalizedWithReservation: count('unfinalized_with_reservation'),
    },
  };
}
