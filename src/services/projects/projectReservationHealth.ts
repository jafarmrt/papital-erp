import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * v9.0.371 (TD-817، یافته B07-01، تصمیم ت۲ بسته ۷): فقط رزرو ذخیره‌شده پروژه ثبت نهایی‌شده موجودی را رزرو می‌کند. پروژه‌هایی
 * که پیش از این قاعده با رزرو ناهمخوان ذخیره شده‌اند خودکار تغییر نمی‌کنند و فقط این‌جا فهرست می‌شوند:
 * - پروژه ثبت نهایی‌شده‌ای که پیش از ثبت رزرو در سرور (v8.0.58، TD-306) نهایی شده و رزرو ذخیره‌شده و زمان ثبت نهایی ندارد:
 *   پیش‌تر خواننده رزرو آن را هر بار از بخش‌ها می‌ساخت و اکنون هیچ رزرو نمی‌کند؛ برای رزرو دوباره، پروژه را از ثبت نهایی
 *   خارج و دوباره ثبت نهایی کنید.
 * - پروژه ثبت نهایی‌نشده‌ای که رزرو ذخیره‌شده دارد: این رزرو دیگر شمرده نمی‌شود.
 * v9.0.372 (TD-820، تصمیم ت۴): پروژه ثبت نهایی‌شده‌ای که ردیف رزروش پیش از تبدیل واحد ساخته شده است (واحد درخواست با
 * واحد کالا فرق دارد و ضریب تبدیل ندارد): مقدار رزرو به واحد ردیف کنترل گرفته شده است.
 * v9.0.394 (TD-821): پروژه ثبت نهایی‌شده‌ای که ردیف رزروی با مقدار مثبت دارد که به هیچ کالای فعالی (شناسه، کد، نام) نمی‌رسد:
 * این ردیف رزرو نمی‌کند و `reservedRows` شمار همین ردیف‌هاست.
 */
export type ProjectReservationIssueKind =
  'finalized_without_reservation' | 'unfinalized_with_reservation' | 'reservation_unit_unconverted' | 'reservation_row_unmatched';

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
  reservation_unit_unconverted: 'رزرو با واحد درخواست، بی تبدیل به واحد کالا',
  reservation_row_unmatched: 'ردیف رزرو بی کالای شناخته‌شده',
};

const ISSUE_ADVICE: Record<ProjectReservationIssueKind, string> = {
  finalized_without_reservation: 'برای رزرو، پروژه را از ثبت نهایی خارج و دوباره ثبت نهایی کنید.',
  unfinalized_with_reservation: 'این رزرو شمرده نمی‌شود؛ با ثبت نهایی پروژه رزرو تازه ساخته می‌شود.',
  reservation_unit_unconverted: 'تبدیل واحد ردیف را ثبت کنید و پروژه را از ثبت نهایی خارج و دوباره ثبت نهایی کنید.',
  reservation_row_unmatched: 'این ردیف رزرو نمی‌کند؛ کالای ردیف را در کنترل موجودی پروژه درست کنید و پروژه را از ثبت نهایی خارج و دوباره ثبت نهایی کنید.',
};

const ISSUE_TD: Record<ProjectReservationIssueKind, string> = {
  finalized_without_reservation: 'TD-817',
  unfinalized_with_reservation: 'TD-817',
  reservation_unit_unconverted: 'TD-820',
  reservation_row_unmatched: 'TD-821',
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
    UNION ALL
    SELECT p.id, p.project_code, p.title, p.reserved_rows, 'reservation_unit_unconverted'
      FROM p
      JOIN production_projects pp ON pp.id = p.id
     WHERE p.finalized AND p.reserved_rows > 0
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(pp.inventory_control -> 'reservedItems') r
          WHERE jsonb_typeof(r) = 'object'
            AND NULLIF(lower(btrim(COALESCE(r ->> 'originalUnit', ''))), '') IS NOT NULL
            AND NULLIF(lower(btrim(COALESCE(r ->> 'unit', ''))), '') IS NOT NULL
            AND lower(btrim(r ->> 'originalUnit')) <> lower(btrim(r ->> 'unit'))
            AND NULLIF(btrim(COALESCE(r ->> 'conversionRate', '')), '') IS NULL)
     ORDER BY 1, 5`);
  const issues: ProjectReservationIssue[] = ((res.rows ?? []) as Array<Record<string, unknown>>).map(r => ({
    projectId: Number(r.projectId),
    projectCode: (r.projectCode as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    kind: r.kind as ProjectReservationIssueKind,
    reservedRows: Number(r.reservedRows) || 0,
  }));
  // v9.0.394 (TD-821): همان قاعده تطبیق گزارش رزروها (findProjectItemMatch)، نه یک بازنویسی SQL از آن
  const { ItemStockReservationService } = await import('../items/itemStockReservation.service.js');
  const unmatched = new Map<number, ProjectReservationIssue>();
  for (const row of await ItemStockReservationService.unmatchedProjectReservationRows(executor)) {
    const issue = unmatched.get(row.projectId)
      ?? { projectId: row.projectId, projectCode: row.projectCode, title: row.projectTitle, kind: 'reservation_row_unmatched' as const, reservedRows: 0 };
    issue.reservedRows += 1;
    unmatched.set(row.projectId, issue);
  }
  issues.push(...unmatched.values());
  return issues.sort((a, b) => a.projectId - b.projectId || a.kind.localeCompare(b.kind));
}

export function buildProjectReservationHealthTest(issues: ProjectReservationIssue[]): HealthCheckTestResult {
  const count = (kind: ProjectReservationIssueKind) => issues.filter(i => i.kind === kind).length;
  return {
    id: 'project_reservation_integrity',
    category: 'inventory',
    title: 'رزرو پروژه ناهمخوان با ثبت نهایی',
    description: 'فقط رزرو ذخیره‌شده پروژه ثبت نهایی‌شده که به کالای فعالی می‌رسد موجودی را رزرو می‌کند؛ پروژه‌های قدیمی ناهمخوان خودکار تغییر نمی‌کنند',
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
      details: `${ISSUE_ADVICE[i.kind]} (${ISSUE_TD[i.kind]})`,
    })),
    metrics: {
      finalizedWithoutReservation: count('finalized_without_reservation'),
      unfinalizedWithReservation: count('unfinalized_with_reservation'),
      reservationUnitUnconverted: count('reservation_unit_unconverted'),
      reservationRowUnmatched: count('reservation_row_unmatched'),
    },
  };
}

/**
 * v9.0.373 (TD-819، تصمیم ت۳ بسته ۷): کالایی که جمع رزروهایش (پیش‌فاکتور فروش و پروژه ثبت نهایی‌شده) از موجودی کل بیشتر است.
 * ثبت نهایی دیگر بیش از موجودی آزاد رزرو نمی‌کند؛ بیش‌رزرو پروژه‌های پیشین، یا کاهش موجودی پس از رزرو (شمارش انبار، ابطال
 * رسید)، فقط این‌جا فهرست می‌شود و خودکار تغییر نمی‌کند: در بیش‌رزرو، «رزرو دیگران» هر دارنده به تنهایی همه موجودی را می‌پوشاند.
 */
export interface OverReservedItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  unit: string;
  stock: number;
  reserved: number;
  sources: string[];
}

export async function findOverReservedItems(executor: DbExecutor = orm): Promise<OverReservedItem[]> {
  const { ItemStockReservationService } = await import('../items/itemStockReservation.service.js');
  const report = await ItemStockReservationService.getReservedStockDetails(executor, true);
  return report.itemSummaries
    .filter(s => s.itemId && Number(s.totalReservedQty) > Number(s.currentStock))
    .map(s => ({
      itemId: Number(s.itemId),
      itemCode: s.itemCode,
      itemName: s.itemName,
      unit: s.unit,
      stock: Number(s.currentStock),
      reserved: Number(s.totalReservedQty),
      sources: s.reservations.map(r => `${r.sourceRef} (${r.reservedQty})`),
    }))
    .sort((a, b) => a.itemId - b.itemId);
}

export function buildOverReservedHealthTest(rows: OverReservedItem[]): HealthCheckTestResult {
  return {
    id: 'stock_reservation_exceeds_stock',
    category: 'inventory',
    title: 'رزرو بیش از موجودی',
    description: 'جمع رزرو پیش‌فاکتورهای فروش و پروژه‌های ثبت نهایی‌شده یک کالا از موجودی کل آن بیشتر است',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: 0,
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} کالا بیش از موجودی رزرو شده است و دارندگان رزرو آن نمی‌توانند خروج بزنند. خودکار تغییر نمی‌کند؛ یکی از پروژه‌ها را از ثبت نهایی خارج و دوباره ثبت نهایی کنید یا پیش‌فاکتور را باطل کنید.`
      : 'رزرو هیچ کالایی از موجودی آن بیشتر نیست.',
    items: rows.map(r => ({
      id: r.itemId,
      code: r.itemCode,
      title: r.itemName,
      subtitle: `موجودی: ${r.stock} ${r.unit} | رزرو: ${r.reserved} ${r.unit}`,
      details: `رزروها: ${r.sources.join('، ')} (TD-819)`,
    })),
    metrics: { overReservedItems: rows.length },
  };
}
