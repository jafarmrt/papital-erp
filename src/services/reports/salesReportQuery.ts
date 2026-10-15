import { sql, type SQL } from 'drizzle-orm';
import type { PeriodBucket, ReportRange } from '../../lib/reports/reportPeriods.js';
import type { SalesDimension, SalesReportFilters } from '../../lib/reports/salesReport.js';

/**
 * v10.1.8 (D-03، طرح گزارش‌های مدیریتی §۲): بخش‌های SQL گزارش فروش. هر پرسش از `salesFactsCte` آغاز می‌شود: یک ردیف برای
 * هر (سند، کالا)، با مبلغ‌ها به ارز نما و بهای کاردکس همان سند.
 *
 * - سند: فاکتور فروش (و پیش‌فاکتور قطعی‌شده قدیمی با نوع proforma، همان که سند حسابداری فروش می‌گیرد) و برگشت از فروش،
 *   قطعی و باطل‌نشده (`is_deleted = 0`)، به تاریخ خود سند (ت۵).
 * - طرف حساب: شناسه سند، وگرنه مشتری زنده‌ای با دقیقاً همان نام (همان قاعده سند حسابداری، `documentVoucherPartyId`).
 * - پروژه برگشت: پروژه خودش، وگرنه پروژه فاکتور اصلی. کانال: فاکتوری (یا فاکتور اصلی برگشتی) که سفارش ووکامرس دارد برخط است.
 * - ارز (ت۴): نمای «all» هر سند ارزی را با نرخ خود سند به ریال می‌آورد و سند ارزی بی نرخ را کنار می‌گذارد؛ نمای یک ارز فقط
 *   سندهای همان ارز با مبلغ خودشان، و بهای ریالی کاردکس را با نرخ سند به آن ارز می‌برد.
 * - بها: جمع `total_price` ردیف‌های خروج (برای برگشت، ورود) فعال و غیرمعکوس همان سند و کالا؛ بی ردیف کاردکس، مقدار × میانگین
 *   موزون بهای جاری (همان پشتیبان سند حسابداری فروش).
 */

export interface SalesScope extends SalesReportFilters {
  range: ReportRange;
  /** 'all' یا کد ارز با حروف بزرگ */
  currency: string;
  /** دوره‌ها، فقط وقتی دوره یکی از تفکیک‌هاست */
  buckets?: PeriodBucket[] | null;
}

/** سندهای بازه با پالایه‌های سطح سند، پیش از پالایه ارز */
function baseDocsCte(scope: SalesScope): SQL {
  const filters: SQL[] = [];
  if (scope.partyId) filters.push(sql`b.party_id = ${scope.partyId}`);
  if (scope.projectId) filters.push(sql`b.project_id = ${scope.projectId}`);
  if (scope.channel) filters.push(sql`b.channel = ${scope.channel}`);
  const where = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  return sql`sales_base AS (
    SELECT b.* FROM (
      SELECT d.id,
             CASE WHEN d.type = 'return' THEN 'return' ELSE 'sale' END AS kind,
             d.date::date AS day,
             COALESCE(d.party_id, (
               SELECT c.id FROM customers c
                WHERE c.is_deleted = 0 AND c.name = btrim(COALESCE(d.buyer_name, ''))
                ORDER BY c.id LIMIT 1
             )) AS party_id,
             btrim(COALESCE(d.buyer_name, '')) AS buyer_name,
             COALESCE(d.project_id, o.project_id) AS project_id,
             UPPER(COALESCE(NULLIF(btrim(d.currency), ''), 'IRR')) AS currency,
             NULLIF(d.exchange_rate, 0) AS rate,
             COALESCE(d.vat_amount, 0) AS vat,
             COALESCE(d.service_charge_amount, 0) AS service_charge,
             CASE WHEN EXISTS (
               SELECT 1 FROM woocommerce_order_logs w WHERE w.erp_document_id = COALESCE(d.return_of_document_id, d.id)
             ) THEN 'online' ELSE 'direct' END AS channel
        FROM documents d
        LEFT JOIN documents o ON o.id = d.return_of_document_id
       WHERE d.is_deleted = 0
         AND d.status = 'final'
         AND d.type IN ('invoice', 'proforma', 'return')
         AND d.date >= ${scope.range.from}::date
         AND d.date < ${scope.range.to}::date + 1
    ) b
    ${where}
  )`;
}

/** سندهای نما: پالایه ارز، ضریب مبلغ و ضریب بها */
function viewDocsCte(currency: string): SQL {
  if (currency === 'all') {
    return sql`sales_docs AS (
      SELECT sb.*, CASE WHEN sb.currency = 'IRR' THEN 1::numeric ELSE sb.rate END AS factor, 1::numeric AS cost_factor
        FROM sales_base sb
       WHERE sb.currency = 'IRR' OR sb.rate IS NOT NULL
    )`;
  }
  const costFactor = currency === 'IRR' ? sql`1::numeric` : sql`1 / sb.rate`;
  return sql`sales_docs AS (
    SELECT sb.*, 1::numeric AS factor, ${costFactor} AS cost_factor
      FROM sales_base sb
     WHERE sb.currency = ${currency}
  )`;
}

function bucketsCte(buckets: PeriodBucket[] | null | undefined): SQL {
  if (!buckets || buckets.length === 0) return sql`sales_buckets (key, from_day, to_day) AS (SELECT NULL::text, NULL::date, NULL::date WHERE false)`;
  const rows = buckets.map(b => sql`(${b.key}::text, ${b.from}::date, ${b.to}::date)`);
  return sql`sales_buckets (key, from_day, to_day) AS (VALUES ${sql.join(rows, sql`, `)})`;
}

/** پیشوند WITH همه پرسش‌های گزارش: sales_base، sales_docs، sales_lines، sales_kardex، sales_buckets و sales_facts */
export function salesFactsCte(scope: SalesScope): SQL {
  const lineFilters: SQL[] = [];
  if (scope.itemId) lineFilters.push(sql`sl.item_id = ${scope.itemId}`);
  if (scope.category !== undefined && scope.category !== null) {
    lineFilters.push(sql`lower(btrim(COALESCE(i.category, ''))) = lower(btrim(${scope.category}::text))`);
  }
  const lineWhere = lineFilters.length > 0 ? sql`WHERE ${sql.join(lineFilters, sql` AND `)}` : sql``;
  return sql`WITH ${baseDocsCte(scope)},
  ${viewDocsCte(scope.currency)},
  sales_lines AS (
    SELECT di.document_id, di.item_id,
           SUM(di.quantity) AS qty,
           SUM(di.quantity * COALESCE(di.unit_price, 0)) AS gross,
           SUM(COALESCE(di.discount, 0)) AS discount
      FROM document_items di
      JOIN sales_docs sd ON sd.id = di.document_id
     WHERE di.is_deleted = 0
     GROUP BY di.document_id, di.item_id
  ),
  sales_kardex AS (
    SELECT t.document_id, t.item_id, SUM(t.total_price) AS cost
      FROM transactions t
      JOIN sales_docs sd ON sd.id = t.document_id
     WHERE t.is_deleted = 0
       AND t.reversal_of_id IS NULL
       AND t.type = CASE WHEN sd.kind = 'return' THEN 'in' ELSE 'out' END
     GROUP BY t.document_id, t.item_id
  ),
  ${bucketsCte(scope.buckets)},
  sales_facts AS (
    SELECT sd.id AS doc_id, sd.kind, sd.day, sd.channel, sd.project_id,
           CASE WHEN sd.party_id IS NOT NULL THEN 'p' || sd.party_id ELSE 'n' || lower(sd.buyer_name) END AS customer_key,
           COALESCE(c.name, NULLIF(sd.buyer_name, '')) AS customer_label,
           sl.item_id, i.name AS item_name, i.code AS item_code, i.unit AS item_unit,
           btrim(COALESCE(i.category, '')) AS category,
           pp.title AS project_title, pp.project_code,
           bk.key AS period_key,
           sl.qty,
           sl.gross * sd.factor AS gross,
           sl.discount * sd.factor AS discount,
           (sl.gross - sl.discount) * sd.factor AS net,
           COALESCE(sk.cost, sl.qty * COALESCE(i.weighted_average_cost, 0)) * sd.cost_factor AS cost
      FROM sales_lines sl
      JOIN sales_docs sd ON sd.id = sl.document_id
      LEFT JOIN items i ON i.id = sl.item_id
      LEFT JOIN customers c ON c.id = sd.party_id
      LEFT JOIN production_projects pp ON pp.id = sd.project_id
      LEFT JOIN sales_kardex sk ON sk.document_id = sl.document_id AND sk.item_id = sl.item_id
      LEFT JOIN sales_buckets bk ON sd.day BETWEEN bk.from_day AND bk.to_day
    ${lineWhere}
  )`;
}

/** شمار سندهای ارزی بی نرخ تبدیل که نما نتوانست به ریال (یا بهایشان را به ارز نما) ببرد */
export function unconvertedDocsSql(scope: SalesScope): SQL {
  const currencyCond = scope.currency === 'all' ? sql`` : sql`AND sb.currency = ${scope.currency}`;
  return sql`WITH ${baseDocsCte(scope)}
    SELECT COUNT(*)::int AS n FROM sales_base sb WHERE sb.currency <> 'IRR' AND sb.rate IS NULL ${currencyCond}`;
}

export interface DimensionSql {
  key: SQL;
  label: SQL;
  code: SQL;
  unit: SQL;
}

/** کلید و برچسب هر تفکیک روی sales_facts (نام دسته و برچسب کانال و دوره در کارساز ساخته می‌شود) */
export const DIMENSION_SQL: Record<SalesDimension, DimensionSql> = {
  item: { key: sql`f.item_id::text`, label: sql`f.item_name`, code: sql`f.item_code`, unit: sql`f.item_unit` },
  customer: { key: sql`f.customer_key`, label: sql`f.customer_label`, code: sql`NULL::text`, unit: sql`NULL::text` },
  category: { key: sql`lower(f.category)`, label: sql`NULLIF(f.category, '')`, code: sql`NULL::text`, unit: sql`NULL::text` },
  period: { key: sql`COALESCE(f.period_key, '')`, label: sql`NULL::text`, code: sql`NULL::text`, unit: sql`NULL::text` },
  project: { key: sql`COALESCE(f.project_id::text, '')`, label: sql`f.project_title`, code: sql`f.project_code`, unit: sql`NULL::text` },
  channel: { key: sql`f.channel`, label: sql`NULL::text`, code: sql`NULL::text`, unit: sql`NULL::text` },
};

const SIGNED_NET = sql`CASE WHEN f.kind = 'return' THEN -f.net ELSE f.net END`;

/** ستون‌های مبلغ هر گروه (رشته دهدهی، جمع در SQL) */
export const AMOUNT_COLUMNS = sql`
  COUNT(DISTINCT f.doc_id) FILTER (WHERE f.kind = 'sale')::int AS invoice_count,
  COUNT(DISTINCT f.doc_id) FILTER (WHERE f.kind = 'return')::int AS return_count,
  COALESCE(SUM(f.qty) FILTER (WHERE f.kind = 'sale'), 0)::text AS quantity,
  COALESCE(SUM(f.qty) FILTER (WHERE f.kind = 'return'), 0)::text AS return_quantity,
  COALESCE(SUM(f.gross) FILTER (WHERE f.kind = 'sale'), 0)::text AS gross,
  COALESCE(SUM(f.discount) FILTER (WHERE f.kind = 'sale'), 0)::text AS discount,
  COALESCE(SUM(f.net) FILTER (WHERE f.kind = 'sale'), 0)::text AS net,
  COALESCE(SUM(f.net) FILTER (WHERE f.kind = 'return'), 0)::text AS return_amount,
  COALESCE(SUM(${SIGNED_NET}), 0)::text AS net_after,
  COALESCE(SUM(CASE WHEN f.kind = 'return' THEN -f.cost ELSE f.cost END), 0)::text AS cost`;

/** فروش خالص پس از برگشت، عددی، برای مرتب کردن */
export const NET_AFTER_SUM = sql`COALESCE(SUM(${SIGNED_NET}), 0)`;

/** مقدار خالص (فروش منهای برگشت) */
export const NET_QUANTITY_SUM = sql`COALESCE(SUM(CASE WHEN f.kind = 'return' THEN -f.qty ELSE f.qty END), 0)`;

/** مالیات و حمل و خدمات سطح سند، در نما */
export function documentLevelSql(scope: SalesScope): SQL {
  return sql`WITH ${baseDocsCte(scope)}, ${viewDocsCte(scope.currency)}
    SELECT COALESCE(SUM(sd.vat * sd.factor) FILTER (WHERE sd.kind = 'sale'), 0)::text AS vat,
           COALESCE(SUM(sd.vat * sd.factor) FILTER (WHERE sd.kind = 'return'), 0)::text AS return_vat,
           COALESCE(SUM(sd.service_charge * sd.factor) FILTER (WHERE sd.kind = 'sale'), 0)::text AS service_charge
      FROM sales_docs sd`;
}
