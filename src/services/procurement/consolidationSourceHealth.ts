import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

export interface OpenConsolidationSource {
  consolidatedId: number;
  consolidatedCode: string;
  sourceId: number;
  sourceCode: string;
  sourceStatus: string | null;
}

/**
 * v9.0.342 (TD-694، تصمیم ت۳ بسته ۱۰): منبع‌های تجمیع پیش از این نسخه باز ماندند (یادداشت درخواست تجمیعی «تجمیع شده از
 * درخواست‌های: …» آن‌ها را نام می‌برد). منبعی که هنوز حذف، تجمیع، دریافت یا رد نشده است فقط فهرست می‌شود تا یک نیاز دو
 * بار سفارش داده نشود؛ هیچ درخواستی خودکار بسته نمی‌شود.
 */
export async function findOpenLegacyConsolidationSources(db: DbExecutor = orm): Promise<OpenConsolidationSource[]> {
  const res = await db.execute(sql`
    SELECT c.id AS "consolidatedId", c.code AS "consolidatedCode", s.id AS "sourceId", s.code AS "sourceCode", s.status AS "sourceStatus"
      FROM purchase_requisitions c
     CROSS JOIN LATERAL regexp_split_to_table(substring(c.notes FROM 'تجمیع شده از درخواست‌های: ([^\n]*)'), '،') AS listed(code)
      JOIN purchase_requisitions s ON s.code = btrim(listed.code) AND s.id <> c.id AND s.is_deleted = 0
     WHERE c.is_deleted = 0
       AND strpos(c.notes, 'تجمیع شده از درخواست‌های: ') > 0
       AND s.consolidated_into_id IS NULL
       AND s.status NOT IN ('consolidated', 'received', 'completed', 'rejected', 'cancelled')
     ORDER BY c.id, s.id`);
  return (res.rows ?? []) as unknown as OpenConsolidationSource[];
}

export function buildConsolidationSourcesHealthTest(rows: OpenConsolidationSource[]): HealthCheckTestResult {
  return {
    id: 'procurement_consolidation_open_sources',
    category: 'documents',
    title: 'درخواست خرید تجمیع‌شده‌ای که هنوز باز است',
    description: 'منبع‌های تجمیع باید بسته شوند تا یک نیاز دو بار سفارش داده نشود؛ منبع‌های تجمیع‌های قدیمی فقط فهرست می‌شوند',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} درخواست خرید در درخواست تجمیعی دیگری آمده ولی هنوز باز است و می‌تواند دوباره سفارش داده شود. این درخواست‌ها خودکار بسته نمی‌شوند؛ هر یک را از «میز تدارکات» بررسی و در صورت نیاز رد کنید.`
      : 'منبع هیچ تجمیعی باز نمانده است.',
    items: rows.map(r => ({
      id: r.sourceId,
      code: r.sourceCode,
      title: `تجمیع‌شده در ${r.consolidatedCode}`,
      subtitle: `وضعیت: ${r.sourceStatus ?? '-'}`,
      details: 'منبع تجمیعی که پیش از بسته شدن خودکار منبع‌ها ثبت شد، باز ماند (TD-694).',
    })),
    metrics: { openConsolidationSources: rows.length },
  };
}
