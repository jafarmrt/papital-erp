import { sql, type SQL } from 'drizzle-orm';
import { journalVoucherItems } from '../../db/schema.js';
import { VOUCHER_BALANCE_TOLERANCE } from '../../lib/voucherBalance.js';
import type { ReportRange } from '../../lib/reports/reportPeriods.js';
import type { VatListFilter } from '../../lib/reports/vatReport.js';
import { accountSubtreeCondition } from '../accounting/accountSubtree.js';
import { voucherItemReportAmountSql } from '../accounting/voucherItemAmount.js';

/**
 * v10.1.14 (D-03، طرح گزارش‌های مدیریتی §۴): بخش‌های SQL «مالیات بر ارزش افزوده».
 *
 * - سندها (`vatDocsCte`): فاکتور فروش (و پیش‌فاکتور قطعی‌شده قدیمی با نوع proforma، همان که سند حسابداری فروش می‌گیرد)
 *   و برگشت از فروش، قطعی و باطل‌نشده، به تاریخ خود سند؛ مبلغ خالص اقلام با قاعده مالیات سند (`computeNetAmount`:
 *   ناخالص و تخفیف هر کدام گرد به ۴ رقم، کمینه صفر). ریال سند ارزی: هر مبلغ جدا ضربدر نرخ سند و گرد به ریال، همان قاعده
 *   ردیف ارزی سند حسابداری (TD-260)؛ سند ارزی بی نرخ ریال ندارد.
 * - هشدار: درصد مثبت با مالیاتی جز گرد(خالص × درصد ÷ ۱۰۰) به کوچک‌ترین واحد ارز سند (TD-382)؛ مالیات بی درصد؛ فاکتور
 *   ریالی با مبلغ خالص و بی مالیات. برگشت مالیات را به نسبت از فاکتور مرجع می‌گیرد (TD-774)، پس درصدش سنجیده نمی‌شود.
 * - دفتر (`vatLedgerRowsCte`): ردیف زنده سند زنده (پیش‌نویس، تأییدشده و دائم) روی حساب مالیات و زیرحساب‌هایش، به تاریخ
 *   سند حسابداری، مبلغ به ریال (TD-260)؛ اسناد بستن سال و افتتاحیه پس از آن (`source_fiscal_year`) شمرده نمی‌شوند.
 *   منبع: سند فروش یا برگشت (`source_document_id`)، خزانه و چک (`source_cheque_id`، یا ردیف خزانه یا چکی که به این سند
 *   اشاره می‌کند)، دیگر؛ سند برگشت منبع سند اصلی‌اش را دارد.
 */

/** تاریخ متنی سند حسابداری (ISO، یا شمسی قدیمی سال‌های بسته) به ISO */
const isoDay = sql`COALESCE(erp_text_date_to_iso(journal_vouchers.date), journal_vouchers.date)`;

function vatDocsCte(range: ReportRange): SQL {
  return sql`vat_base AS (
    SELECT d.id,
           CASE WHEN d.type = 'return' THEN 'return' ELSE 'sale' END AS kind,
           d.ref_number,
           d.date::date AS day,
           COALESCE(c.name, NULLIF(btrim(COALESCE(d.buyer_name, '')), '')) AS party,
           UPPER(COALESCE(NULLIF(btrim(d.currency), ''), 'IRR')) AS currency,
           NULLIF(d.exchange_rate, 0) AS rate,
           COALESCE(d.vat_percent, 0)::numeric AS percent,
           COALESCE(d.vat_amount, 0) AS vat_own,
           GREATEST(ROUND(COALESCE(l.gross, 0), 4) - ROUND(COALESCE(l.discount, 0), 4), 0) AS net_own
      FROM documents d
      LEFT JOIN customers c ON c.id = d.party_id
      LEFT JOIN LATERAL (
        SELECT SUM(di.quantity * COALESCE(di.unit_price, 0)) AS gross, SUM(COALESCE(di.discount, 0)) AS discount
          FROM document_items di
         WHERE di.document_id = d.id AND di.is_deleted = 0
      ) l ON true
     WHERE d.is_deleted = 0
       AND d.status = 'final'
       AND d.type IN ('invoice', 'proforma', 'return')
       AND d.date >= ${range.from}::date
       AND d.date < ${range.to}::date + 1
  ),
  vat_docs AS (
    SELECT b.*,
           (b.currency = 'IRR' OR b.rate IS NOT NULL) AS converted,
           CASE WHEN b.currency = 'IRR' THEN b.net_own WHEN b.rate IS NULL THEN NULL ELSE ROUND(b.net_own * b.rate, 0) END AS net,
           CASE WHEN b.currency = 'IRR' THEN b.vat_own WHEN b.rate IS NULL THEN NULL ELSE ROUND(b.vat_own * b.rate, 0) END AS vat,
           CASE WHEN b.percent = 0 AND b.vat_own <> 0 THEN 'unknown' ELSE (b.percent::float8)::text END AS rate_key,
           CASE WHEN b.kind = 'sale' AND b.percent > 0
                THEN ROUND(b.net_own * b.percent / 100, CASE WHEN b.currency = 'IRR' THEN 0 ELSE 2 END) END AS expected_vat_own
      FROM vat_base b
  ),
  vat_flagged AS (
    SELECT v.*,
           CASE WHEN NOT v.converted THEN 'unconverted'
                WHEN v.expected_vat_own IS NOT NULL AND v.vat_own <> v.expected_vat_own THEN 'rate_mismatch'
                WHEN v.kind = 'sale' AND v.percent = 0 AND v.vat_own <> 0 THEN 'rate_missing'
                WHEN v.kind = 'sale' AND v.currency = 'IRR' AND v.vat_own = 0 AND v.net_own > 0 THEN 'no_vat'
           END AS warning
      FROM vat_docs v
  )`;
}

/** جمع‌های بخش ۱ به تفکیک درصد، فقط سندهای ریالی و ارزیِ نرخ‌دار */
export function vatRatesSql(range: ReportRange): SQL {
  return sql`WITH ${vatDocsCte(range)}
    SELECT f.rate_key,
           COUNT(*) FILTER (WHERE f.kind = 'sale')::int AS invoice_count,
           COALESCE(SUM(f.net) FILTER (WHERE f.kind = 'sale'), 0)::text AS sales_base,
           COALESCE(SUM(f.vat) FILTER (WHERE f.kind = 'sale'), 0)::text AS sales_vat,
           COUNT(*) FILTER (WHERE f.kind = 'return')::int AS return_count,
           COALESCE(SUM(f.net) FILTER (WHERE f.kind = 'return'), 0)::text AS return_base,
           COALESCE(SUM(f.vat) FILTER (WHERE f.kind = 'return'), 0)::text AS return_vat
      FROM vat_flagged f
     WHERE f.converted
     GROUP BY f.rate_key`;
}

/** شمار سندهای هر هشدار */
export function vatWarningsSql(range: ReportRange): SQL {
  return sql`WITH ${vatDocsCte(range)}
    SELECT f.warning, COUNT(*)::int AS n FROM vat_flagged f WHERE f.warning IS NOT NULL GROUP BY f.warning`;
}

/** یک صفحه از فهرست سندها، به ترتیب روز و شناسه */
export function vatDocumentsSql(range: ReportRange, list: VatListFilter, limit: number, offset: number): SQL {
  const where = list === 'warnings' ? sql`WHERE f.warning IS NOT NULL` : sql``;
  return sql`WITH ${vatDocsCte(range)}
    SELECT f.id, f.kind, f.ref_number, f.day::text AS day, f.party, f.currency, f.rate::text AS rate,
           f.net_own::text AS net_own, f.vat_own::text AS vat_own, f.net::text AS net, f.vat::text AS vat,
           f.percent::float8 AS percent, f.expected_vat_own::text AS expected_vat_own, f.warning,
           COUNT(*) OVER () AS total_rows
      FROM vat_flagged f
      ${where}
     ORDER BY f.day ASC, f.id ASC
     LIMIT ${limit} OFFSET ${offset}`;
}

/**
 * ردیف‌های حساب مالیات و منبع هر سند حسابداری؛ سند برگشت (`REV-V…`، `VOID-REPOST-V…`، `RE-REV-V…`) منبع و سند فروش سند
 * اصلی‌اش را دارد، همان قاعده `voucherSourceKinds`، تا برگشت سند حسابداری فاکتوری باطل‌شده کنار همان فاکتور بیاید.
 * بازگشتی است، پس پرسش آن با `WITH RECURSIVE` آغاز می‌شود.
 */
function vatLedgerRowsCte(accountId: number): SQL {
  const credit = voucherItemReportAmountSql(journalVoucherItems.credit, 'all');
  const debit = voucherItemReportAmountSql(journalVoucherItems.debit, 'all');
  const treasuryLinked = (v: string) => sql.raw(`(EXISTS (SELECT 1 FROM treasury_transactions t WHERE t.voucher_id = ${v}.id)
                  OR EXISTS (SELECT 1 FROM cheques ch WHERE ch.voucher_id = ${v}.id))`);
  return sql`vat_rows AS (
    SELECT journal_vouchers.id AS voucher_id,
           journal_vouchers.voucher_number AS vno,
           journal_vouchers.status,
           ${isoDay} AS day,
           (journal_vouchers.status = 'draft') AS is_draft,
           ${credit}::numeric AS cr,
           ${debit}::numeric AS dr
      FROM journal_voucher_items
      JOIN journal_vouchers ON journal_vouchers.id = journal_voucher_items.voucher_id
     WHERE journal_voucher_items.is_deleted = 0
       AND journal_vouchers.is_deleted = 0
       AND journal_vouchers.status IN ('draft', 'approved', 'permanent')
       AND journal_vouchers.source_fiscal_year IS NULL
       AND ${accountSubtreeCondition(journalVoucherItems.accountId, accountId)}
  ),
  vat_chain AS (
    SELECT v.id AS voucher_id, v.id AS cur_id, v.reference_number, v.reference_id, 0 AS depth
      FROM journal_vouchers v
     WHERE v.id IN (SELECT DISTINCT r.voucher_id FROM vat_rows r)
    UNION ALL
    SELECT c.voucher_id, o.id, o.reference_number, o.reference_id, c.depth + 1
      FROM vat_chain c
      JOIN journal_vouchers o ON o.id = c.reference_id
     WHERE c.depth < 5 AND c.reference_number ~ '^(REV-V|VOID-REPOST-V|RE-REV-V)'
  ),
  vat_origin AS (
    SELECT DISTINCT ON (c.voucher_id) c.voucher_id,
           x.source_document_id AS doc_id,
           CASE WHEN x.source_document_id IS NOT NULL THEN 'document' ELSE 'treasury' END AS source
      FROM vat_chain c
      JOIN journal_vouchers x ON x.id = c.cur_id
     WHERE x.source_document_id IS NOT NULL OR x.source_cheque_id IS NOT NULL OR ${treasuryLinked('x')}
     ORDER BY c.voucher_id, c.depth
  ),
  vat_ledger AS (
    SELECT r.*, o.doc_id, COALESCE(o.source, 'other') AS source
      FROM vat_rows r
      LEFT JOIN vat_origin o ON o.voucher_id = r.voucher_id
  )`;
}

/** مانده اول و پایان، گردش دوره و سهم پیش‌نویس هر کدام، و گردش هر منبع */
export function vatLedgerSummarySql(range: ReportRange, accountId: number): SQL {
  const before = sql`l.day < ${range.from}`;
  const within = sql`l.day >= ${range.from} AND l.day <= ${range.to}`;
  const upTo = sql`l.day <= ${range.to}`;
  const sum = (expr: SQL, cond: SQL) => sql`COALESCE(SUM(${expr}) FILTER (WHERE ${cond}), 0)::text`;
  const net = sql`(l.cr - l.dr)`;
  const bySource = (source: string) => sql`
    ${sum(sql`l.cr`, sql`${within} AND l.source = ${source}`)} AS ${sql.raw(`credit_${source}`)},
    ${sum(sql`l.dr`, sql`${within} AND l.source = ${source}`)} AS ${sql.raw(`debit_${source}`)}`;
  return sql`WITH RECURSIVE ${vatLedgerRowsCte(accountId)}
    SELECT ${sum(net, before)} AS opening,
           ${sum(net, sql`${before} AND l.is_draft`)} AS opening_draft,
           ${sum(sql`l.cr`, within)} AS credit,
           ${sum(sql`l.cr`, sql`${within} AND l.is_draft`)} AS credit_draft,
           ${sum(sql`l.dr`, within)} AS debit,
           ${sum(sql`l.dr`, sql`${within} AND l.is_draft`)} AS debit_draft,
           ${sum(net, upTo)} AS closing,
           ${sum(net, sql`${upTo} AND l.is_draft`)} AS closing_draft,
           ${bySource('document')},
           ${bySource('treasury')},
           ${bySource('other')}
      FROM vat_ledger l`;
}

/**
 * فهرست تفاوت‌های دفتر با بخش ۱، بزرگ‌ترین نخست: برای هر سند فروش یا برگشت (سند بخش ۱، یا سندی که سند حسابداری این دوره
 * به آن اشاره می‌کند) مالیات سند (سند ارزی بی نرخ صفر) در برابر گردش ردیف‌های آن در دوره، و برای هر سند حسابداری بی سند
 * فروش گردش خودش. تفاوتی کمتر از تلورانس تراز سند (۰٫۰۱) نمی‌آید؛ جمع همه ردیف‌ها همان تفاوت گردش خالص دفتر با خالص
 * بخش ۱ است.
 */
export function vatDifferencesSql(range: ReportRange, accountId: number, limit: number): SQL {
  const tolerance = String(VOUCHER_BALANCE_TOLERANCE);
  const voucherJson = sql`jsonb_build_object('number', p.vno, 'status', p.status, 'date', p.day)`;
  return sql`WITH RECURSIVE ${vatDocsCte(range)},
    ${vatLedgerRowsCte(accountId)},
    vat_period AS (
      SELECT l.* FROM vat_ledger l WHERE l.day >= ${range.from} AND l.day <= ${range.to}
    ),
    doc_ledger AS (
      SELECT p.doc_id, SUM(p.cr - p.dr) AS ledger, jsonb_agg(DISTINCT ${voucherJson}) AS vouchers
        FROM vat_period p
       WHERE p.source = 'document'
       GROUP BY p.doc_id
    ),
    doc_expected AS (
      SELECT f.id, f.converted,
             CASE WHEN NOT f.converted THEN 0 WHEN f.kind = 'return' THEN -f.vat ELSE f.vat END AS expected
        FROM vat_flagged f
    ),
    diffs AS (
      SELECT 'd' || COALESCE(e.id, l.doc_id) AS key,
             CASE WHEN e.id IS NULL THEN CASE WHEN od.is_deleted = 1 THEN 'document_voided' ELSE 'document_outside' END
                  WHEN NOT e.converted THEN 'document_unconverted'
                  WHEN l.doc_id IS NULL THEN 'document_missing'
                  ELSE 'document_differs' END AS kind,
             COALESCE(e.id, l.doc_id) AS doc_id,
             COALESCE(e.expected, 0) AS expected,
             COALESCE(l.ledger, 0) AS ledger,
             COALESCE(l.vouchers, '[]'::jsonb) AS vouchers
        FROM doc_expected e
        FULL JOIN doc_ledger l ON l.doc_id = e.id
        LEFT JOIN documents od ON od.id = COALESCE(e.id, l.doc_id)
       WHERE ABS(COALESCE(l.ledger, 0) - COALESCE(e.expected, 0)) > ${tolerance}::numeric
      UNION ALL
      SELECT 'v' || p.voucher_id, MIN(p.source), NULL::int, 0::numeric, SUM(p.cr - p.dr), jsonb_agg(DISTINCT ${voucherJson})
        FROM vat_period p
       WHERE p.source <> 'document'
       GROUP BY p.voucher_id
      HAVING ABS(SUM(p.cr - p.dr)) > ${tolerance}::numeric
    )
    SELECT x.key, x.kind, x.doc_id, od.type AS doc_type, od.ref_number, od.date::date::text AS doc_day,
           x.expected::text AS expected, x.ledger::text AS ledger, (x.ledger - x.expected)::text AS difference, x.vouchers,
           COUNT(*) OVER () AS total_rows
      FROM diffs x
      LEFT JOIN documents od ON od.id = x.doc_id
     ORDER BY ABS(x.ledger - x.expected) DESC, x.key ASC
     LIMIT ${limit}`;
}
