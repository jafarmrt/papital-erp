import { sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { comparisonRange, percentChange, periodBuckets, periodLabel, type ReportRange } from '../../lib/reports/reportPeriods.js';
import {
  SALES_CHANNEL_LABELS, SALES_EMPTY_GROUP_LABELS, SALES_TOP_COUNT, quantityApplies,
  type SalesAmounts, type SalesChannel, type SalesDimension, type SalesGroup, type SalesReport, type SalesReportParams,
  type SalesReportRow, type SalesTopEntry, type SalesTotals,
} from '../../lib/reports/salesReport.js';
import {
  AMOUNT_COLUMNS, DIMENSION_SQL, NET_AFTER_SUM, NET_QUANTITY_SUM, documentLevelSql, salesFactsCte, unconvertedDocsSql,
  type SalesScope,
} from './salesReportQuery.js';
import { salesLedgerCheck } from './salesLedgerCheck.js';

/**
 * v10.1.7 (D-03، طرح گزارش‌های مدیریتی §۲، تصمیم‌های ت۲ تا ت۶): «گزارش فروش». جمع‌ها، صفحه‌بندی، مقایسه و فهرست‌های برتر
 * در پایگاه‌داده است (§۶.۱) و هیچ ردیف سندی به مرورگر نمی‌رود. قاعده شمردن در `salesReportQuery.ts` است.
 */

export interface SalesReportAccess {
  /** خواننده بهای کالا (`ITEM_COST_READ_PERMISSIONS`، ت۳) */
  cost: boolean;
  /** خواننده گزارش‌های دفتر (سطر هم‌خوانی با دفتر کل) */
  ledger: boolean;
}

type Row = Record<string, unknown>;

const str = (value: unknown): string => fin(String(value ?? '0')).round(4).toString();

function amountsOf(r: Row, withQuantity: boolean, withCost: boolean): SalesAmounts {
  const netAfter = fin(String(r.net_after ?? '0'));
  const profit = netAfter.subtract(String(r.cost ?? '0'));
  return {
    invoiceCount: Number(r.invoice_count ?? 0),
    returnCount: Number(r.return_count ?? 0),
    quantity: withQuantity ? str(r.quantity) : null,
    returnQuantity: withQuantity ? str(r.return_quantity) : null,
    gross: str(r.gross),
    discount: str(r.discount),
    net: str(r.net),
    returnAmount: str(r.return_amount),
    netAfterReturns: netAfter.round(4).toString(),
    cost: withCost ? str(r.cost) : null,
    grossProfit: withCost ? profit.round(4).toString() : null,
    marginPercent: withCost && !netAfter.isZero() ? Math.round(profit.toNumber() / netAfter.toNumber() * 1000) / 10 : null,
  };
}

function groupOf(dimension: SalesDimension, key: unknown, label: unknown, code: unknown, unit: unknown): SalesGroup {
  const k = String(key ?? '');
  let text = label === null || label === undefined || String(label).trim() === '' ? null : String(label);
  if (dimension === 'period') text = k ? periodLabel(k) : null;
  if (dimension === 'channel') text = SALES_CHANNEL_LABELS[k as SalesChannel] ?? null;
  return {
    key: k,
    label: text ?? SALES_EMPTY_GROUP_LABELS[dimension],
    code: code === null || code === undefined || code === '' ? null : String(code),
    unit: unit === null || unit === undefined || unit === '' ? null : String(unit),
  };
}

function assertParams(params: SalesReportParams): void {
  if (params.from > params.to) {
    throw new ValidationError('آغاز بازه گزارش پس از پایان آن است.', undefined, 'REPORT_RANGE_INVALID');
  }
  if (params.thenBy && params.thenBy === params.groupBy) {
    throw new ValidationError('دو تفکیک گزارش یکی است؛ تفکیک دوم را تغییر دهید.', undefined, 'REPORT_DIMENSIONS_SAME');
  }
}

function scopeOf(params: SalesReportParams, range: ReportRange): SalesScope {
  const usesPeriod = params.groupBy === 'period' || params.thenBy === 'period';
  const buckets = usesPeriod ? periodBuckets(range, params.period) : null;
  if (usesPeriod && !buckets) {
    throw new ValidationError('بازه گزارش برای این تفکیک دوره‌ای بیش از اندازه دوره دارد؛ بازه را کوتاه‌تر یا دوره را بزرگ‌تر کنید.', undefined, 'REPORT_PERIODS_TOO_MANY');
  }
  return {
    range,
    currency: params.currency,
    buckets,
    partyId: params.partyId,
    itemId: params.itemId,
    category: params.category,
    projectId: params.projectId,
    channel: params.channel,
  };
}

async function totalsOf(scope: SalesScope, withQuantity: boolean, withCost: boolean): Promise<SalesTotals> {
  const res = await orm.execute(sql`${salesFactsCte(scope)} SELECT ${AMOUNT_COLUMNS} FROM sales_facts f`);
  const amounts = amountsOf((res.rows as Row[])[0] ?? {}, withQuantity, withCost);
  const lineFiltered = Boolean(scope.itemId) || (scope.category !== undefined && scope.category !== null);
  if (lineFiltered) return { ...amounts, vat: null, returnVat: null, serviceCharge: null };
  const doc = ((await orm.execute(documentLevelSql(scope))).rows as Row[])[0] ?? {};
  return { ...amounts, vat: str(doc.vat), returnVat: str(doc.return_vat), serviceCharge: str(doc.service_charge) };
}

interface GroupedQuery {
  groupBy: SalesDimension;
  thenBy: SalesDimension | null;
  /** صفحه؛ null یعنی همه گروه‌ها */
  page: { limit: number; offset: number } | null;
  /** فقط این کلیدهای گروه اول */
  keys?: string[];
}

function groupedSql(scope: SalesScope, q: GroupedQuery): SQL {
  const g = DIMENSION_SQL[q.groupBy];
  const t = q.thenBy ? DIMENSION_SQL[q.thenBy] : null;
  const thenCols = t
    ? sql`${t.key} AS t_key, MIN(${t.label}) AS t_label, MIN(${t.code}) AS t_code, MIN(${t.unit}) AS t_unit,`
    : sql`NULL::text AS t_key, NULL::text AS t_label, NULL::text AS t_code, NULL::text AS t_unit,`;
  const groupBy = t ? sql`GROUP BY ${g.key}, ${t.key}` : sql`GROUP BY ${g.key}`;
  const thenOrder = !q.thenBy ? sql`` : q.thenBy === 'period' ? sql`, r.t_key ASC` : sql`, r.net_after_n DESC, r.t_key ASC`;
  const order = q.groupBy === 'period'
    ? sql`ORDER BY r.g_key ASC${thenOrder}`
    : sql`ORDER BY r.group_net DESC, r.g_key ASC${thenOrder}`;
  const keys = q.keys ? sql`WHERE r.g_key IN (${sql.join(q.keys.map(k => sql`${k}::text`), sql`, `)})` : sql``;
  const paging = q.page ? sql`LIMIT ${q.page.limit} OFFSET ${q.page.offset}` : sql``;
  return sql`${salesFactsCte(scope)}
    SELECT r.* FROM (
      SELECT ${g.key} AS g_key, MIN(${g.label}) AS g_label, MIN(${g.code}) AS g_code, MIN(${g.unit}) AS g_unit,
             ${thenCols}
             ${AMOUNT_COLUMNS},
             ${NET_AFTER_SUM} AS net_after_n,
             SUM(${NET_AFTER_SUM}) OVER (PARTITION BY ${g.key}) AS group_net,
             COUNT(*) OVER () AS total_rows
        FROM sales_facts f
       ${groupBy}
    ) r
    ${keys}
    ${order}
    ${paging}`;
}

const pairKey = (g: unknown, t: unknown) => `${String(g ?? '')}\u0001${String(t ?? '')}`;

async function topEntries(scope: SalesScope, dimension: 'item' | 'customer'): Promise<SalesTopEntry[]> {
  const d = DIMENSION_SQL[dimension];
  const res = await orm.execute(sql`${salesFactsCte(scope)}
    SELECT ${d.key} AS key, MIN(${d.label}) AS label, MIN(${d.code}) AS code, MIN(${d.unit}) AS unit,
           ${NET_QUANTITY_SUM}::text AS quantity, ${NET_AFTER_SUM}::text AS net_after
      FROM sales_facts f
     GROUP BY ${d.key}
     ORDER BY ${NET_AFTER_SUM} DESC, ${d.key} ASC
     LIMIT ${SALES_TOP_COUNT}`);
  return (res.rows as Row[]).map(r => {
    const group = groupOf(dimension, r.key, r.label, r.code, r.unit);
    return { ...group, quantity: dimension === 'item' ? str(r.quantity) : null, netAfterReturns: str(r.net_after) };
  });
}

export async function salesReport(params: SalesReportParams, access: SalesReportAccess): Promise<SalesReport> {
  assertParams(params);
  const range: ReportRange = { from: params.from, to: params.to };
  const scope = scopeOf(params, range);
  const thenBy = params.thenBy ?? null;
  const withQuantity = quantityApplies(params.groupBy, thenBy, params.itemId);
  const offset = (params.page - 1) * params.limit;

  const pageRes = await orm.execute(groupedSql(scope, { groupBy: params.groupBy, thenBy, page: { limit: params.limit, offset } }));
  const pageRows = pageRes.rows as Row[];
  let total = Number(pageRows[0]?.total_rows ?? 0);
  if (pageRows.length === 0 && offset > 0) {
    const countRes = await orm.execute(groupedSql(scope, { groupBy: params.groupBy, thenBy, page: { limit: 1, offset: 0 } }));
    total = Number((countRes.rows as Row[])[0]?.total_rows ?? 0);
  }

  const compareRange = comparisonRange(range, params.compare);
  const compareScope = compareRange ? scopeOf(params, compareRange) : null;
  const previousByKey = new Map<string, string>();
  const rowsCompare = compareScope && params.groupBy !== 'period' && thenBy !== 'period' && pageRows.length > 0;
  if (rowsCompare && compareScope) {
    const keys = Array.from(new Set(pageRows.map(r => String(r.g_key ?? ''))));
    const prev = await orm.execute(groupedSql(compareScope, { groupBy: params.groupBy, thenBy, page: null, keys }));
    for (const r of prev.rows as Row[]) previousByKey.set(pairKey(r.g_key, r.t_key), str(r.net_after));
  }

  const rows: SalesReportRow[] = pageRows.map(r => {
    const amounts = amountsOf(r, withQuantity, access.cost);
    const previous = rowsCompare ? (previousByKey.get(pairKey(r.g_key, r.t_key)) ?? '0') : null;
    return {
      ...amounts,
      group: groupOf(params.groupBy, r.g_key, r.g_label, r.g_code, r.g_unit),
      then: thenBy ? groupOf(thenBy, r.t_key, r.t_label, r.t_code, r.t_unit) : null,
      previousNetAfterReturns: previous,
      changePercent: previous === null ? null : percentChange(Number(amounts.netAfterReturns), Number(previous)),
    };
  });

  const totals = await totalsOf(scope, withQuantity && Boolean(params.itemId), access.cost);
  let comparison: SalesReport['comparison'] = null;
  if (compareRange && compareScope) {
    const compareTotals = await totalsOf(compareScope, withQuantity && Boolean(params.itemId), access.cost);
    comparison = {
      mode: params.compare,
      range: compareRange,
      totals: compareTotals,
      changePercent: percentChange(Number(totals.netAfterReturns), Number(compareTotals.netAfterReturns)),
    };
  }

  const [topItems, topCustomers, unconverted] = await Promise.all([
    topEntries(scope, 'item'),
    topEntries(scope, 'customer'),
    orm.execute(unconvertedDocsSql(scope)),
  ]);

  const filtered = Boolean(params.partyId || params.itemId || params.projectId || params.channel)
    || (params.category !== undefined && params.category !== null);
  const ledgerUnavailable = !access.ledger ? 'no_access' : filtered ? 'filtered' : null;
  const ledger = ledgerUnavailable ? null : await salesLedgerCheck(range, params.currency, totals.netAfterReturns);

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
    topItems,
    topCustomers,
    ledger,
    ledgerUnavailable,
    costVisible: access.cost,
    unconvertedDocuments: Number((unconverted.rows as Row[])[0]?.n ?? 0),
  };
}
