import { sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { comparisonRange, percentChange, periodBuckets, periodLabel, type ReportRange } from '../../lib/reports/reportPeriods.js';
import {
  PURCHASE_EMPTY_GROUP_LABELS, PURCHASE_TOP_COUNT, purchaseQuantityApplies,
  type PurchaseAmounts, type PurchaseDimension, type PurchaseGroup, type PurchaseReport, type PurchaseReportParams,
  type PurchaseReportRow, type PurchaseTopEntry,
} from '../../lib/reports/purchaseReport.js';
import {
  PURCHASE_AMOUNT_COLUMNS, PURCHASE_DIMENSION_SQL, PURCHASE_NET_SUM, purchaseFactsCte, unconvertedPurchaseDocsSql,
  type PurchaseScope,
} from './purchaseReportQuery.js';

/**
 * v10.1.15 (D-03 بخش ۴، تصمیم ت۱۵): «گزارش خرید» به تفکیک تأمین‌کننده، کالا، دسته و دوره، با همان موتور گزارش فروش:
 * جمع‌ها، صفحه‌بندی، مقایسه و فهرست‌های برتر در پایگاه‌داده است و هیچ ردیف سندی به مرورگر نمی‌رود. قاعده شمردن در
 * `purchaseReportQuery.ts` است.
 */

type Row = Record<string, unknown>;

const str = (value: unknown): string => fin(String(value ?? '0')).round(4).toString();

function amountsOf(r: Row, withQuantity: boolean): PurchaseAmounts {
  const quantity = fin(String(r.quantity ?? '0'));
  const net = fin(String(r.net ?? '0'));
  return {
    documentCount: Number(r.document_count ?? 0),
    quantity: withQuantity ? quantity.round(4).toString() : null,
    gross: str(r.gross),
    discount: str(r.discount),
    net: net.round(4).toString(),
    averageUnitPrice: withQuantity && !quantity.isZero() ? net.divide(quantity).round(4).toString() : null,
  };
}

function groupOf(dimension: PurchaseDimension, key: unknown, label: unknown, code: unknown, unit: unknown): PurchaseGroup {
  const k = String(key ?? '');
  let text = label === null || label === undefined || String(label).trim() === '' ? null : String(label);
  if (dimension === 'period') text = k ? periodLabel(k) : null;
  return {
    key: k,
    label: text ?? PURCHASE_EMPTY_GROUP_LABELS[dimension],
    code: code === null || code === undefined || code === '' ? null : String(code),
    unit: unit === null || unit === undefined || unit === '' ? null : String(unit),
  };
}

function scopeOf(params: PurchaseReportParams, range: ReportRange): PurchaseScope {
  const usesPeriod = params.groupBy === 'period' || params.thenBy === 'period';
  const buckets = usesPeriod ? periodBuckets(range, params.period) : null;
  if (usesPeriod && !buckets) {
    throw new ValidationError('بازه گزارش برای این تفکیک دوره‌ای بیش از اندازه دوره دارد؛ بازه را کوتاه‌تر یا دوره را بزرگ‌تر کنید.', undefined, 'REPORT_PERIODS_TOO_MANY');
  }
  return { range, currency: params.currency, buckets, partyId: params.partyId, itemId: params.itemId, category: params.category };
}

interface GroupedQuery {
  groupBy: PurchaseDimension;
  thenBy: PurchaseDimension | null;
  /** صفحه؛ null یعنی همه گروه‌ها */
  page: { limit: number; offset: number } | null;
  /** فقط این کلیدهای گروه اول */
  keys?: string[];
}

function groupedSql(scope: PurchaseScope, q: GroupedQuery): SQL {
  const g = PURCHASE_DIMENSION_SQL[q.groupBy];
  const t = q.thenBy ? PURCHASE_DIMENSION_SQL[q.thenBy] : null;
  const thenCols = t
    ? sql`${t.key} AS t_key, MIN(${t.label}) AS t_label, MIN(${t.code}) AS t_code, MIN(${t.unit}) AS t_unit,`
    : sql`NULL::text AS t_key, NULL::text AS t_label, NULL::text AS t_code, NULL::text AS t_unit,`;
  const groupBy = t ? sql`GROUP BY ${g.key}, ${t.key}` : sql`GROUP BY ${g.key}`;
  const thenOrder = !q.thenBy ? sql`` : q.thenBy === 'period' ? sql`, r.t_key ASC` : sql`, r.net_n DESC, r.t_key ASC`;
  const order = q.groupBy === 'period'
    ? sql`ORDER BY r.g_key ASC${thenOrder}`
    : sql`ORDER BY r.group_net DESC, r.g_key ASC${thenOrder}`;
  const keys = q.keys ? sql`WHERE r.g_key IN (${sql.join(q.keys.map(k => sql`${k}::text`), sql`, `)})` : sql``;
  const paging = q.page ? sql`LIMIT ${q.page.limit} OFFSET ${q.page.offset}` : sql``;
  return sql`${purchaseFactsCte(scope)}
    SELECT r.* FROM (
      SELECT ${g.key} AS g_key, MIN(${g.label}) AS g_label, MIN(${g.code}) AS g_code, MIN(${g.unit}) AS g_unit,
             ${thenCols}
             ${PURCHASE_AMOUNT_COLUMNS},
             ${PURCHASE_NET_SUM} AS net_n,
             SUM(${PURCHASE_NET_SUM}) OVER (PARTITION BY ${g.key}) AS group_net,
             COUNT(*) OVER () AS total_rows
        FROM purchase_facts f
       ${groupBy}
    ) r
    ${keys}
    ${order}
    ${paging}`;
}

const pairKey = (g: unknown, t: unknown) => `${String(g ?? '')}\u0001${String(t ?? '')}`;

async function totalsOf(scope: PurchaseScope, withQuantity: boolean): Promise<PurchaseAmounts> {
  const res = await orm.execute(sql`${purchaseFactsCte(scope)} SELECT ${PURCHASE_AMOUNT_COLUMNS} FROM purchase_facts f`);
  return amountsOf((res.rows as Row[])[0] ?? {}, withQuantity);
}

async function topEntries(scope: PurchaseScope, dimension: 'supplier' | 'item'): Promise<PurchaseTopEntry[]> {
  const d = PURCHASE_DIMENSION_SQL[dimension];
  const res = await orm.execute(sql`${purchaseFactsCte(scope)}
    SELECT ${d.key} AS key, MIN(${d.label}) AS label, MIN(${d.code}) AS code, MIN(${d.unit}) AS unit,
           COALESCE(SUM(f.qty), 0)::text AS quantity, ${PURCHASE_NET_SUM}::text AS net
      FROM purchase_facts f
     GROUP BY ${d.key}
     ORDER BY ${PURCHASE_NET_SUM} DESC, ${d.key} ASC
     LIMIT ${PURCHASE_TOP_COUNT}`);
  return (res.rows as Row[]).map(r => ({
    ...groupOf(dimension, r.key, r.label, r.code, r.unit),
    quantity: dimension === 'item' ? str(r.quantity) : null,
    net: str(r.net),
  }));
}

export async function purchaseReport(params: PurchaseReportParams): Promise<PurchaseReport> {
  if (params.from > params.to) {
    throw new ValidationError('آغاز بازه گزارش پس از پایان آن است.', undefined, 'REPORT_RANGE_INVALID');
  }
  if (params.thenBy && params.thenBy === params.groupBy) {
    throw new ValidationError('دو تفکیک گزارش یکی است؛ تفکیک دوم را تغییر دهید.', undefined, 'REPORT_DIMENSIONS_SAME');
  }
  const range: ReportRange = { from: params.from, to: params.to };
  const scope = scopeOf(params, range);
  const thenBy = params.thenBy ?? null;
  const withQuantity = purchaseQuantityApplies(params.groupBy, thenBy, params.itemId);
  const offset = (params.page - 1) * params.limit;

  const pageRows = (await orm.execute(groupedSql(scope, { groupBy: params.groupBy, thenBy, page: { limit: params.limit, offset } }))).rows as Row[];
  let total = Number(pageRows[0]?.total_rows ?? 0);
  if (pageRows.length === 0 && offset > 0) {
    const countRows = (await orm.execute(groupedSql(scope, { groupBy: params.groupBy, thenBy, page: { limit: 1, offset: 0 } }))).rows as Row[];
    total = Number(countRows[0]?.total_rows ?? 0);
  }

  const compareRange = comparisonRange(range, params.compare);
  const compareScope = compareRange ? scopeOf(params, compareRange) : null;
  const previousByKey = new Map<string, string>();
  const rowsCompare = compareScope !== null && params.groupBy !== 'period' && thenBy !== 'period' && pageRows.length > 0;
  if (rowsCompare && compareScope) {
    const keys = Array.from(new Set(pageRows.map(r => String(r.g_key ?? ''))));
    const prev = await orm.execute(groupedSql(compareScope, { groupBy: params.groupBy, thenBy, page: null, keys }));
    for (const r of prev.rows as Row[]) previousByKey.set(pairKey(r.g_key, r.t_key), str(r.net));
  }

  const rows: PurchaseReportRow[] = pageRows.map(r => {
    const amounts = amountsOf(r, withQuantity);
    const previous = rowsCompare ? (previousByKey.get(pairKey(r.g_key, r.t_key)) ?? '0') : null;
    return {
      ...amounts,
      group: groupOf(params.groupBy, r.g_key, r.g_label, r.g_code, r.g_unit),
      then: thenBy ? groupOf(thenBy, r.t_key, r.t_label, r.t_code, r.t_unit) : null,
      previousNet: previous,
      changePercent: previous === null ? null : percentChange(Number(amounts.net), Number(previous)),
    };
  });

  const totalsQuantity = withQuantity && Boolean(params.itemId);
  const totals = await totalsOf(scope, totalsQuantity);
  let comparison: PurchaseReport['comparison'] = null;
  if (compareRange && compareScope) {
    const compareTotals = await totalsOf(compareScope, totalsQuantity);
    comparison = { mode: params.compare, range: compareRange, totals: compareTotals, changePercent: percentChange(Number(totals.net), Number(compareTotals.net)) };
  }

  const [topSuppliers, topItems, unconverted] = await Promise.all([
    topEntries(scope, 'supplier'),
    topEntries(scope, 'item'),
    orm.execute(unconvertedPurchaseDocsSql(scope)),
  ]);

  return {
    range,
    currency: params.currency,
    groupBy: params.groupBy,
    thenBy,
    period: params.period,
    rows,
    total,
    page: params.page,
    limit: params.limit,
    totals,
    comparison,
    topSuppliers,
    topItems,
    unconvertedDocuments: Number((unconverted.rows as Row[])[0]?.n ?? 0),
  };
}
