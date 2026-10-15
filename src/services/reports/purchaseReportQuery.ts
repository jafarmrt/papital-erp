import { sql, type SQL } from 'drizzle-orm';
import type { PeriodBucket, ReportRange } from '../../lib/reports/reportPeriods.js';
import type { PurchaseDimension, PurchaseReportFilters } from '../../lib/reports/purchaseReport.js';

/**
 * v10.1.15 (D-03 بخش ۴، تصمیم ت۱۵): بخش‌های SQL گزارش خرید. هر پرسش از `purchaseFactsCte` آغاز می‌شود: یک ردیف برای هر
 * (سند، کالا)، با مبلغ‌ها به ارز نما.
 *
 * - سند: رسید (`receipt`) و سند خرید (`purchase`)، قطعی و باطل‌نشده (`is_deleted = 0`)، به تاریخ خود سند. پیش‌فاکتور خرید
 *   (رسید در وضعیت proforma) و پیش‌نویس خرید نیستند.
 * - تأمین‌کننده: شناسه سند، وگرنه طرف حساب زنده‌ای با دقیقاً همان نام (همان قاعده سند حسابداری خرید، TD-778).
 * - ارز: نمای «all» هر سند ارزی را با نرخ خود سند به ریال می‌آورد و سند ارزی بی نرخ را کنار می‌گذارد؛ نمای یک ارز فقط سندهای
 *   همان ارز با مبلغ خودشان.
 */

export interface PurchaseScope extends PurchaseReportFilters {
  range: ReportRange;
  /** 'all' یا کد ارز با حروف بزرگ */
  currency: string;
  /** دوره‌ها، فقط وقتی دوره یکی از تفکیک‌هاست */
  buckets?: PeriodBucket[] | null;
}

/** سندهای بازه با پالایه تأمین‌کننده، پیش از پالایه ارز */
function baseDocsCte(scope: PurchaseScope): SQL {
  const where = scope.partyId ? sql`WHERE b.party_id = ${scope.partyId}` : sql``;
  return sql`purchase_base AS (
    SELECT b.* FROM (
      SELECT d.id,
             d.date::date AS day,
             COALESCE(d.party_id, (
               SELECT c.id FROM customers c
                WHERE c.is_deleted = 0 AND c.name = btrim(COALESCE(d.buyer_name, ''))
                ORDER BY c.id LIMIT 1
             )) AS party_id,
             btrim(COALESCE(d.buyer_name, '')) AS supplier_name,
             UPPER(COALESCE(NULLIF(btrim(d.currency), ''), 'IRR')) AS currency,
             NULLIF(d.exchange_rate, 0) AS rate
        FROM documents d
       WHERE d.is_deleted = 0
         AND d.status = 'final'
         AND d.type IN ('receipt', 'purchase')
         AND d.date >= ${scope.range.from}::date
         AND d.date < ${scope.range.to}::date + 1
    ) b
    ${where}
  )`;
}

/** سندهای نما: پالایه ارز و ضریب مبلغ */
function viewDocsCte(currency: string): SQL {
  if (currency === 'all') {
    return sql`purchase_docs AS (
      SELECT pb.*, CASE WHEN pb.currency = 'IRR' THEN 1::numeric ELSE pb.rate END AS factor
        FROM purchase_base pb
       WHERE pb.currency = 'IRR' OR pb.rate IS NOT NULL
    )`;
  }
  return sql`purchase_docs AS (
    SELECT pb.*, 1::numeric AS factor FROM purchase_base pb WHERE pb.currency = ${currency}
  )`;
}

function bucketsCte(buckets: PeriodBucket[] | null | undefined): SQL {
  if (!buckets || buckets.length === 0) return sql`purchase_buckets (key, from_day, to_day) AS (SELECT NULL::text, NULL::date, NULL::date WHERE false)`;
  const rows = buckets.map(b => sql`(${b.key}::text, ${b.from}::date, ${b.to}::date)`);
  return sql`purchase_buckets (key, from_day, to_day) AS (VALUES ${sql.join(rows, sql`, `)})`;
}

/** پیشوند WITH همه پرسش‌های گزارش خرید: purchase_base، purchase_docs، purchase_lines، purchase_buckets و purchase_facts */
export function purchaseFactsCte(scope: PurchaseScope): SQL {
  const lineFilters: SQL[] = [];
  if (scope.itemId) lineFilters.push(sql`pl.item_id = ${scope.itemId}`);
  if (scope.category !== undefined && scope.category !== null) {
    lineFilters.push(sql`lower(btrim(COALESCE(i.category, ''))) = lower(btrim(${scope.category}::text))`);
  }
  const lineWhere = lineFilters.length > 0 ? sql`WHERE ${sql.join(lineFilters, sql` AND `)}` : sql``;
  return sql`WITH ${baseDocsCte(scope)},
  ${viewDocsCte(scope.currency)},
  purchase_lines AS (
    SELECT di.document_id, di.item_id,
           SUM(di.quantity) AS qty,
           SUM(di.quantity * COALESCE(di.unit_price, 0)) AS gross,
           SUM(COALESCE(di.discount, 0)) AS discount
      FROM document_items di
      JOIN purchase_docs pd ON pd.id = di.document_id
     WHERE di.is_deleted = 0
     GROUP BY di.document_id, di.item_id
  ),
  ${bucketsCte(scope.buckets)},
  purchase_facts AS (
    SELECT pd.id AS doc_id, pd.day,
           CASE WHEN pd.party_id IS NOT NULL THEN 'p' || pd.party_id ELSE 'n' || lower(pd.supplier_name) END AS supplier_key,
           COALESCE(c.name, NULLIF(pd.supplier_name, '')) AS supplier_label,
           pl.item_id, i.name AS item_name, i.code AS item_code, i.unit AS item_unit,
           btrim(COALESCE(i.category, '')) AS category,
           bk.key AS period_key,
           pl.qty,
           pl.gross * pd.factor AS gross,
           pl.discount * pd.factor AS discount,
           (pl.gross - pl.discount) * pd.factor AS net
      FROM purchase_lines pl
      JOIN purchase_docs pd ON pd.id = pl.document_id
      LEFT JOIN items i ON i.id = pl.item_id
      LEFT JOIN customers c ON c.id = pd.party_id
      LEFT JOIN purchase_buckets bk ON pd.day BETWEEN bk.from_day AND bk.to_day
    ${lineWhere}
  )`;
}

/** شمار سندهای ارزی بی نرخ تبدیل که نمای همه ارزها نتوانست به ریال ببرد */
export function unconvertedPurchaseDocsSql(scope: PurchaseScope): SQL {
  const currencyCond = scope.currency === 'all' ? sql`` : sql`AND pb.currency = ${scope.currency}`;
  return sql`WITH ${baseDocsCte(scope)}
    SELECT COUNT(*)::int AS n FROM purchase_base pb WHERE pb.currency <> 'IRR' AND pb.rate IS NULL ${currencyCond}`;
}

export interface PurchaseDimensionSql {
  key: SQL;
  label: SQL;
  code: SQL;
  unit: SQL;
}

/** کلید و برچسب هر تفکیک روی purchase_facts (برچسب دوره در کارساز ساخته می‌شود) */
export const PURCHASE_DIMENSION_SQL: Record<PurchaseDimension, PurchaseDimensionSql> = {
  supplier: { key: sql`f.supplier_key`, label: sql`f.supplier_label`, code: sql`NULL::text`, unit: sql`NULL::text` },
  item: { key: sql`f.item_id::text`, label: sql`f.item_name`, code: sql`f.item_code`, unit: sql`f.item_unit` },
  category: { key: sql`lower(f.category)`, label: sql`NULLIF(f.category, '')`, code: sql`NULL::text`, unit: sql`NULL::text` },
  period: { key: sql`COALESCE(f.period_key, '')`, label: sql`NULL::text`, code: sql`NULL::text`, unit: sql`NULL::text` },
};

/** ستون‌های مبلغ هر گروه (رشته دهدهی، جمع در SQL) */
export const PURCHASE_AMOUNT_COLUMNS = sql`
  COUNT(DISTINCT f.doc_id)::int AS document_count,
  COALESCE(SUM(f.qty), 0)::text AS quantity,
  COALESCE(SUM(f.gross), 0)::text AS gross,
  COALESCE(SUM(f.discount), 0)::text AS discount,
  COALESCE(SUM(f.net), 0)::text AS net`;

/** خرید خالص، عددی، برای مرتب کردن */
export const PURCHASE_NET_SUM = sql`COALESCE(SUM(f.net), 0)`;
