import { sql, type SQL } from 'drizzle-orm';
import { journalVoucherItems } from '../../db/schema.js';
import { AGING_PENDING_CHEQUE_STATUSES, type AgingKind, type AgingSort } from '../../lib/reports/agingReport.js';
import { accountSubtreeCondition } from '../accounting/accountSubtree.js';
import { voucherItemCurrencyCondition, voucherItemReportAmountSql } from '../accounting/voucherItemAmount.js';

/**
 * v10.1.9 (D-03، طرح گزارش‌های مدیریتی §۳): بخش‌های SQL «سن مطالبات و بدهی‌ها». هر پرسش از `agingRowsCte` آغاز می‌شود:
 * یک ردیف برای هر طرف حساب با مانده، بازه‌های سن، پیش‌دریافت یا پیش‌پرداخت، سهم پیش‌نویس و چک‌های وصول‌نشده.
 *
 * - ردیف‌ها: ردیف زنده سند زنده روی حساب گزارش و زیرحساب‌هایش، به تاریخ سند تا «تاریخ گزارش». اسناد بستن سال و افتتاحیه
 *   پس از آن (`source_fiscal_year`، هر دو با هم و برگشت آن‌ها) شمرده نمی‌شوند: بستن، مانده هر طرف حساب را صفر و افتتاحیه
 *   دوباره به نخستین روز سال بعد می‌برد و سن همه طلب‌ها را از نو آغاز می‌کرد؛ جفت آن‌ها روی مانده اثری ندارد.
 * - طرف حساب (TD-416): تفصیلی مشتری یا تأمین‌کننده با شناسه؛ ردیف قدیمیِ بی‌شناسه با نام دقیق یک طرف حساب (زنده پیش از
 *   حذف‌شده)؛ هر ردیف دیگر با نام تفصیلی خودش، و بی تفصیلی یک گروه.
 * - مبلغ (TD-260): در نمای همه ارزها ردیف ارزی با نرخ خودش به ریال؛ در نمای یک ارز فقط ردیف‌های همان ارز. سوی افزاینده
 *   (بدهکار برای مطالبات، بستانکار برای بدهی‌ها) مثبت است.
 * - سن (ت۷ الف): جمع ردیف‌های کاهنده یک طرف حساب از قدیمی‌ترین ردیف افزاینده کم می‌شود؛ باقی‌مانده هر ردیف افزاینده
 *   `max(0, min(جمع افزاینده تا همین ردیف − جمع کاهنده، مبلغ ردیف))` است که همان تسویه «اولین وارده، اولین تسویه» است.
 */

export interface AgingScope {
  kind: AgingKind;
  accountId: number;
  asOf: string;
  /** 'all' یا کد ارز با حروف بزرگ */
  currency: string;
  approvedOnly: boolean;
  partyId: number | null;
  chequesApply: boolean;
}

const PARTY_TYPES = sql`('customer', 'supplier')`;

/** تاریخ متنی سند (ISO، یا شمسی قدیمی سال‌های بسته) به ISO */
const isoDay = (column: SQL): SQL => sql`COALESCE(erp_text_date_to_iso(${column}), ${column})`;

const chequeTypeOf = (kind: AgingKind) => (kind === 'receivable' ? 'received' : 'paid');

function factsCte(scope: AgingScope): SQL {
  const debit = voucherItemReportAmountSql(journalVoucherItems.debit, scope.currency);
  const credit = voucherItemReportAmountSql(journalVoucherItems.credit, scope.currency);
  const amount = scope.kind === 'receivable' ? sql`(${debit} - ${credit})` : sql`(${credit} - ${debit})`;
  const statuses = scope.approvedOnly ? sql`('approved', 'permanent')` : sql`('approved', 'permanent', 'draft')`;
  const currency = voucherItemCurrencyCondition(scope.currency);
  return sql`aging_facts AS (
    SELECT COALESCE(
             CASE WHEN journal_voucher_items.detailed_type IN ${PARTY_TYPES} THEN journal_voucher_items.detailed_id END,
             legacy.id
           ) AS party_id,
           NULLIF(btrim(COALESCE(journal_voucher_items.detailed_name, '')), '') AS detail_name,
           ${isoDay(sql`journal_vouchers.date`)} AS day,
           COALESCE(journal_vouchers.voucher_number, 0) AS vno,
           COALESCE(journal_voucher_items.row_order, 0) AS ro,
           journal_voucher_items.id AS rid,
           ${amount}::numeric AS amt,
           (journal_vouchers.status = 'draft') AS is_draft
      FROM journal_voucher_items
      JOIN journal_vouchers ON journal_vouchers.id = journal_voucher_items.voucher_id
      LEFT JOIN LATERAL (
        SELECT c.id FROM customers c
         WHERE journal_voucher_items.detailed_type IN ${PARTY_TYPES}
           AND journal_voucher_items.detailed_id IS NULL
           AND btrim(c.name) = btrim(journal_voucher_items.detailed_name)
         ORDER BY c.is_deleted, c.id
         LIMIT 1
      ) legacy ON true
     WHERE journal_voucher_items.is_deleted = 0
       AND journal_vouchers.is_deleted = 0
       AND ${accountSubtreeCondition(journalVoucherItems.accountId, scope.accountId)}
       AND journal_vouchers.status IN ${statuses}
       AND journal_vouchers.source_fiscal_year IS NULL
       ${currency ? sql`AND ${currency}` : sql``}
  ),
  aging_dated AS (
    SELECT f.*, CASE WHEN f.party_id IS NOT NULL THEN 'p' || f.party_id ELSE 'n' || COALESCE(f.detail_name, '') END AS g_key
      FROM aging_facts f
     WHERE f.day <= ${scope.asOf}
  )`;
}

function chequesCte(scope: AgingScope): SQL {
  if (!scope.chequesApply) {
    return sql`aging_cheques AS (SELECT NULL::text AS g_key, NULL::int AS party_id, 0::numeric AS pending, 0::numeric AS bounced WHERE false)`;
  }
  const statuses = scope.kind === 'receivable'
    ? [...AGING_PENDING_CHEQUE_STATUSES, 'bounced']
    : [...AGING_PENDING_CHEQUE_STATUSES];
  return sql`aging_cheques AS (
    SELECT 'p' || q.party_id AS g_key, q.party_id,
           COALESCE(SUM(q.amount) FILTER (WHERE q.status IN (${sql.join(AGING_PENDING_CHEQUE_STATUSES.map(s => sql`${s}`), sql`, `)})), 0) AS pending,
           COALESCE(SUM(q.amount) FILTER (WHERE q.status = 'bounced'), 0) AS bounced
      FROM cheques q
     WHERE q.is_deleted = 0
       AND q.type = ${chequeTypeOf(scope.kind)}
       AND q.party_type IN ${PARTY_TYPES}
       AND q.party_id IS NOT NULL
       AND UPPER(COALESCE(NULLIF(q.currency, ''), 'IRR')) = 'IRR'
       AND q.status IN (${sql.join(statuses.map(s => sql`${s}`), sql`, `)})
       AND ${isoDay(sql`q.issue_date`)} <= ${scope.asOf}
     GROUP BY q.party_id
  )`;
}

const bucketSum = (from: number, to: number | null): SQL => (to === null
  ? sql`COALESCE(SUM(x.rem) FILTER (WHERE x.age >= ${from}), 0)`
  : sql`COALESCE(SUM(x.rem) FILTER (WHERE x.age >= ${from} AND x.age <= ${to}), 0)`);

/** `aging_rows`: یک ردیف برای هر طرف حساب با مانده یا چک وصول‌نشده */
export function agingRowsCte(scope: AgingScope): SQL {
  const partyFilter = scope.partyId ? sql`AND COALESCE(g.g_key, c.g_key) = ${`p${scope.partyId}`}` : sql``;
  return sql`WITH ${factsCte(scope)},
  aging_groups AS (
    SELECT d.g_key, MIN(d.party_id) AS party_id, MIN(d.detail_name) AS detail_name,
           SUM(d.amt) AS balance,
           SUM(CASE WHEN d.amt < 0 THEN -d.amt ELSE 0 END) AS settled,
           COALESCE(SUM(d.amt) FILTER (WHERE d.is_draft), 0) AS draft
      FROM aging_dated d
     GROUP BY d.g_key
  ),
  aging_open AS (
    SELECT d.g_key, d.day, d.amt,
           SUM(d.amt) OVER (PARTITION BY d.g_key ORDER BY d.day, d.vno, d.ro, d.rid ROWS UNBOUNDED PRECEDING) AS cum
      FROM aging_dated d
     WHERE d.amt > 0
  ),
  aging_buckets AS (
    SELECT x.g_key,
           ${bucketSum(0, 30)} AS up_to_30,
           ${bucketSum(31, 60)} AS up_to_60,
           ${bucketSum(61, 90)} AS up_to_90,
           ${bucketSum(91, 180)} AS up_to_180,
           ${bucketSum(181, null)} AS over_180
      FROM (
        SELECT o.g_key,
               GREATEST(LEAST(o.cum - g.settled, o.amt), 0) AS rem,
               (${scope.asOf}::date - o.day::date) AS age
          FROM aging_open o
          JOIN aging_groups g ON g.g_key = o.g_key
      ) x
     GROUP BY x.g_key
  ),
  ${chequesCte(scope)},
  aging_rows AS (
    SELECT COALESCE(g.g_key, c.g_key) AS g_key,
           COALESCE(g.party_id, c.party_id) AS party_id,
           g.detail_name,
           COALESCE(g.balance, 0) AS balance,
           COALESCE(b.up_to_30, 0) AS up_to_30,
           COALESCE(b.up_to_60, 0) AS up_to_60,
           COALESCE(b.up_to_90, 0) AS up_to_90,
           COALESCE(b.up_to_180, 0) AS up_to_180,
           COALESCE(b.over_180, 0) AS over_180,
           GREATEST(-COALESCE(g.balance, 0), 0) AS advance,
           COALESCE(g.draft, 0) AS draft,
           COALESCE(c.pending, 0) AS pending,
           COALESCE(c.bounced, 0) AS bounced
      FROM aging_groups g
      FULL OUTER JOIN aging_cheques c ON c.g_key = g.g_key
      LEFT JOIN aging_buckets b ON b.g_key = COALESCE(g.g_key, c.g_key)
     WHERE (COALESCE(g.balance, 0) <> 0 OR COALESCE(c.pending, 0) <> 0 OR COALESCE(c.bounced, 0) <> 0)
       ${partyFilter}
  )`;
}

const ORDER: Record<AgingSort, SQL> = {
  balance: sql`ORDER BY r.balance DESC, r.g_key ASC`,
  overdue: sql`ORDER BY (r.up_to_180 + r.over_180) DESC, r.balance DESC, r.g_key ASC`,
  name: sql`ORDER BY COALESCE(btrim(p.name), r.detail_name, '') ASC, r.g_key ASC`,
};

/** یک صفحه ردیف‌ها با نام کنونی طرف حساب و شمار همه ردیف‌ها */
export function agingPageSql(scope: AgingScope, sort: AgingSort, limit: number, offset: number): SQL {
  return sql`${agingRowsCte(scope)}
    SELECT r.*, p.name AS party_name, p.is_deleted AS party_deleted, COUNT(*) OVER () AS total_rows
      FROM aging_rows r
      LEFT JOIN customers p ON p.id = r.party_id
     ${ORDER[sort]}
     LIMIT ${limit} OFFSET ${offset}`;
}

/** جمع همه ردیف‌ها */
export function agingTotalsSql(scope: AgingScope): SQL {
  return sql`${agingRowsCte(scope)}
    SELECT COUNT(*) AS party_count,
           COALESCE(SUM(r.balance), 0)::text AS balance,
           COALESCE(SUM(r.up_to_30), 0)::text AS up_to_30,
           COALESCE(SUM(r.up_to_60), 0)::text AS up_to_60,
           COALESCE(SUM(r.up_to_90), 0)::text AS up_to_90,
           COALESCE(SUM(r.up_to_180), 0)::text AS up_to_180,
           COALESCE(SUM(r.over_180), 0)::text AS over_180,
           COALESCE(SUM(r.advance), 0)::text AS advance,
           COALESCE(SUM(r.draft), 0)::text AS draft,
           COALESCE(SUM(r.pending), 0)::text AS pending,
           COALESCE(SUM(r.bounced), 0)::text AS bounced
      FROM aging_rows r`;
}

/**
 * آخرین دریافت (مطالبات) یا پرداخت (بدهی‌ها) هر طرف حساب تا تاریخ گزارش: تراکنش خزانه انجام‌شده و برگشت‌نخورده، یا چک
 * دریافتی / پرداختی که برگشت نخورده است. مبلغ به ارز نما (همان قاعده TD-260 با نرخ خود تراکنش).
 */
export function lastSettlementSql(scope: AgingScope, partyIds: number[]): SQL {
  const ids = sql.join(partyIds.map(id => sql`${id}::int`), sql`, `);
  const treasuryCurrency = sql`UPPER(COALESCE(NULLIF(t.currency, ''), 'IRR'))`;
  const treasuryAmount = scope.currency === 'all'
    ? sql`CASE WHEN ${treasuryCurrency} = 'IRR' THEN t.amount ELSE ROUND(t.amount * COALESCE(NULLIF(t.exchange_rate, 0), 1), 0) END`
    : sql`t.amount`;
  const treasuryCurrencyFilter = scope.currency === 'all' ? sql`` : sql`AND ${treasuryCurrency} = ${scope.currency}`;
  const cheques = scope.chequesApply
    ? sql`UNION ALL
      SELECT q.party_id, ${isoDay(sql`q.issue_date`)} AS day, 1 AS src, q.id AS sid, q.amount AS amount
        FROM cheques q
       WHERE q.is_deleted = 0
         AND q.type = ${chequeTypeOf(scope.kind)}
         AND q.party_type IN ${PARTY_TYPES}
         AND q.party_id IN (${ids})
         AND q.status NOT IN ('bounced', 'returned')
         AND UPPER(COALESCE(NULLIF(q.currency, ''), 'IRR')) = 'IRR'`
    : sql``;
  return sql`SELECT DISTINCT ON (s.party_id) s.party_id, s.day, s.src, s.amount::text AS amount
    FROM (
      SELECT t.party_id, ${isoDay(sql`t.date`)} AS day, 0 AS src, t.id AS sid, ${treasuryAmount} AS amount
        FROM treasury_transactions t
       WHERE t.is_deleted = 0
         AND t.reversal_of_id IS NULL
         AND COALESCE(t.status, 'completed') = 'completed'
         AND t.type = ${scope.kind === 'receivable' ? 'receipt' : 'payment'}
         AND t.party_type IN ${PARTY_TYPES}
         AND t.party_id IN (${ids})
         ${treasuryCurrencyFilter}
      ${cheques}
    ) s
   WHERE s.day <= ${scope.asOf}
   ORDER BY s.party_id, s.day DESC, s.src ASC, s.sid DESC`;
}
