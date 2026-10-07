import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

export interface UnresolvedProcurementOrderLink {
  documentId: number;
  refNumber: string | null;
  type: string | null;
  status: string | null;
  linkedRequisitionId: number | null;
  listedRequisitionCodes: string | null;
}

/**
 * v9.0.272 (TD-691، تصمیم ت۲ بسته ۱۰): سندهایی که مهاجرت 0076 پیوندشان را نساخت، چون مبهم بودند: سند زنده‌ای که برچسب
 * `[تدارکات: درخواست …]` دارد ولی ستون پیوند ندارد (کد ناموجود، برچسب دو درخواست، یا ردیف درخواست دیگری آن را دارد)، یا
 * سندی که در `linkedDocumentIds` درخواستی زنده آمده ولی پیوندش تهی است یا به درخواست دیگری است. فقط فهرست می‌شوند و
 * چیزی بازنویسی نمی‌شود.
 */
export async function findUnresolvedProcurementOrderLinks(db: DbExecutor = orm): Promise<UnresolvedProcurementOrderLink[]> {
  const res = await db.execute(sql`
    WITH listed AS (
      SELECT DISTINCT (link #>> '{}')::integer AS document_id, pr.id AS requisition_id, pr.code
        FROM purchase_requisitions pr
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(pr.items) = 'array' THEN pr.items ELSE '[]'::jsonb END) AS row_item
       CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(row_item -> 'linkedDocumentIds') = 'array' THEN row_item -> 'linkedDocumentIds' ELSE '[]'::jsonb END) AS link
       WHERE pr.is_deleted = 0
         AND (link #>> '{}') ~ '^[0-9]{1,9}$'
    )
    SELECT d.id AS "documentId", d.ref_number AS "refNumber", d.type, d.status,
           d.procurement_requisition_id AS "linkedRequisitionId",
           string_agg(DISTINCT l.code, '، ' ORDER BY l.code) AS "listedRequisitionCodes"
      FROM documents d
      LEFT JOIN listed l ON l.document_id = d.id
     WHERE d.is_deleted = 0
       AND (
             (d.procurement_requisition_id IS NULL AND (strpos(d.notes, '[تدارکات: درخواست ') > 0 OR l.document_id IS NOT NULL))
          OR (l.document_id IS NOT NULL AND l.requisition_id <> d.procurement_requisition_id)
       )
     GROUP BY d.id
     ORDER BY d.id`);
  return (res.rows ?? []) as unknown as UnresolvedProcurementOrderLink[];
}

export function buildProcurementOrderLinkHealthTest(rows: UnresolvedProcurementOrderLink[]): HealthCheckTestResult {
  const open = rows.filter(r => r.status !== 'final').length;
  return {
    id: 'procurement_order_link_unresolved',
    category: 'documents',
    title: 'سفارش خرید تدارکات بی پیوند روشن به درخواست',
    description: 'هر سفارش خرید تدارکات باید با ستون پیوند به یک درخواست خرید وصل باشد؛ سندهای قدیمی مبهم فقط فهرست می‌شوند',
    status: open > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, open),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} سند برچسب یا ردیف درخواست خرید دارد ولی پیوندش روشن نیست (${open} سند هنوز نهایی نشده است). این سندها خودکار تغییر نمی‌کنند؛ سند نهایی‌نشده را از «ورود و خروج انبار» بررسی و نهایی کنید.`
      : 'همه سفارش‌های خرید تدارکات به درخواست خود پیوند دارند.',
    items: rows.map(r => ({
      id: r.documentId,
      code: r.refNumber ?? `سند #${r.documentId}`,
      title: r.listedRequisitionCodes ? `درخواست‌ها: ${r.listedRequisitionCodes}` : 'برچسب درخواست بی پیوند',
      subtitle: `نوع: ${r.type ?? '-'} | وضعیت: ${r.status ?? '-'}`,
      details: 'پیوند سفارش و درخواست مبهم است و در مهاجرت ساخته نشد (TD-691).',
      linkType: 'document' as const,
      linkId: r.documentId,
    })),
    metrics: { unresolvedLinks: rows.length, openUnresolvedLinks: open },
  };
}
