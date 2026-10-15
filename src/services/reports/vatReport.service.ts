import { orm } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import {
  VAT_DIFFERENCE_KINDS, VAT_LEDGER_SOURCES, VAT_WARNINGS,
  type VatAmounts, type VatComparison, type VatDifferenceKind, type VatDifferenceRow, type VatDocumentKind, type VatDocumentRow,
  type VatLedger, type VatLedgerSource, type VatRateRow, type VatReport, type VatReportParams, type VatVoucherRef, type VatWarning,
} from '../../lib/reports/vatReport.js';
import { AccountMappingService } from '../accounting/accountMapping.service.js';
import { vatDifferencesSql, vatDocumentsSql, vatLedgerSummarySql, vatRatesSql, vatWarningsSql } from './vatReportQuery.js';

/**
 * v10.1.13 (D-03، طرح گزارش‌های مدیریتی §۴، تصمیم‌های ت۱۲ و ت۱۳): «مالیات بر ارزش افزوده». جمع‌ها، صفحه‌بندی و فهرست
 * تفاوت‌ها در پایگاه‌داده است (§۶.۱)؛ قاعده شمردن در `vatReportQuery.ts`. گزارش فقط می‌خواند و چیزی نمی‌نویسد.
 */

export interface VatReportOptions {
  /** بیشترین ردیف فهرست تفاوت‌ها */
  differenceLimit: number;
}

type Row = Record<string, unknown>;

const str = (value: unknown): string => fin(String(value ?? '0')).round(4).toString();
const optionalStr = (value: unknown): string | null => (value === null || value === undefined ? null : str(value));

function assertParams(params: VatReportParams): void {
  if (params.from > params.to) {
    throw new ValidationError('آغاز بازه گزارش پس از پایان آن است.', undefined, 'REPORT_RANGE_INVALID');
  }
}

function amountsOf(r: Row): VatAmounts {
  const salesVat = fin(String(r.sales_vat ?? '0'));
  const returnVat = fin(String(r.return_vat ?? '0'));
  return {
    invoiceCount: Number(r.invoice_count ?? 0),
    salesBase: str(r.sales_base),
    salesVat: salesVat.round(4).toString(),
    returnCount: Number(r.return_count ?? 0),
    returnBase: str(r.return_base),
    returnVat: returnVat.round(4).toString(),
    netVat: salesVat.subtract(returnVat).round(4).toString(),
  };
}

/** درصد بزرگ‌تر نخست، «نامشخص» آخر */
function rateOrder(a: VatRateRow, b: VatRateRow): number {
  if (a.percent === null) return b.percent === null ? 0 : 1;
  if (b.percent === null) return -1;
  return b.percent - a.percent;
}

function sumAmounts(rows: VatAmounts[]): VatAmounts {
  let salesBase = fin(0);
  let salesVat = fin(0);
  let returnBase = fin(0);
  let returnVat = fin(0);
  let invoiceCount = 0;
  let returnCount = 0;
  for (const r of rows) {
    salesBase = salesBase.add(r.salesBase);
    salesVat = salesVat.add(r.salesVat);
    returnBase = returnBase.add(r.returnBase);
    returnVat = returnVat.add(r.returnVat);
    invoiceCount += r.invoiceCount;
    returnCount += r.returnCount;
  }
  return {
    invoiceCount,
    salesBase: salesBase.round(4).toString(),
    salesVat: salesVat.round(4).toString(),
    returnCount,
    returnBase: returnBase.round(4).toString(),
    returnVat: returnVat.round(4).toString(),
    netVat: salesVat.subtract(returnVat).round(4).toString(),
  };
}

async function ratesOf(params: VatReportParams): Promise<VatRateRow[]> {
  const res = await orm.execute(vatRatesSql(params));
  return (res.rows as Row[])
    .map(r => {
      const key = String(r.rate_key ?? 'unknown');
      return { ...amountsOf(r), key, percent: key === 'unknown' ? null : Number(key) };
    })
    .sort(rateOrder);
}

async function warningsOf(params: VatReportParams): Promise<Record<VatWarning, number>> {
  const out = Object.fromEntries(VAT_WARNINGS.map(w => [w, 0])) as Record<VatWarning, number>;
  const res = await orm.execute(vatWarningsSql(params));
  for (const r of res.rows as Row[]) {
    const warning = String(r.warning) as VatWarning;
    if (warning in out) out[warning] = Number(r.n ?? 0);
  }
  return out;
}

const isWarning = (value: unknown): value is VatWarning => (VAT_WARNINGS as readonly string[]).includes(String(value));

function documentOf(r: Row): VatDocumentRow {
  const currency = String(r.currency ?? 'IRR');
  return {
    id: Number(r.id),
    kind: r.kind === 'return' ? 'return' : 'sale',
    refNumber: String(r.ref_number ?? ''),
    date: String(r.day ?? ''),
    party: r.party === null || r.party === undefined ? null : String(r.party),
    currency,
    exchangeRate: currency === 'IRR' ? null : optionalStr(r.rate),
    netOwn: str(r.net_own),
    vatOwn: str(r.vat_own),
    net: optionalStr(r.net),
    vat: optionalStr(r.vat),
    percent: Number(r.percent ?? 0),
    expectedVatOwn: r.warning === 'rate_mismatch' ? optionalStr(r.expected_vat_own) : null,
    warning: isWarning(r.warning) ? r.warning : null,
  };
}

async function documentsOf(params: VatReportParams): Promise<{ rows: VatDocumentRow[]; total: number }> {
  const offset = (params.page - 1) * params.limit;
  const res = await orm.execute(vatDocumentsSql(params, params.list, params.limit, offset));
  const rows = res.rows as Row[];
  let total = Number(rows[0]?.total_rows ?? 0);
  if (rows.length === 0 && offset > 0) {
    const count = await orm.execute(vatDocumentsSql(params, params.list, 1, 0));
    total = Number((count.rows as Row[])[0]?.total_rows ?? 0);
  }
  return { rows: rows.map(documentOf), total };
}

async function ledgerOf(params: VatReportParams, account: { id: number; code: string; name: string }): Promise<VatLedger> {
  const r = ((await orm.execute(vatLedgerSummarySql(params, account.id))).rows as Row[])[0] ?? {};
  const figure = (total: unknown, draft: unknown) => ({ total: str(total), draft: str(draft) });
  const bySource = Object.fromEntries(VAT_LEDGER_SOURCES.map(s => [s, { credit: str(r[`credit_${s}`]), debit: str(r[`debit_${s}`]) }])) as
    Record<VatLedgerSource, { credit: string; debit: string }>;
  return {
    account: { code: account.code, name: account.name },
    opening: figure(r.opening, r.opening_draft),
    credit: figure(r.credit, r.credit_draft),
    debit: figure(r.debit, r.debit_draft),
    closing: figure(r.closing, r.closing_draft),
    bySource,
  };
}

function vouchersOf(value: unknown): VatVoucherRef[] {
  const list = Array.isArray(value) ? value as Row[] : [];
  return list
    .map(v => ({ number: Number(v.number ?? 0), status: String(v.status ?? ''), date: String(v.date ?? '') }))
    .sort((a, b) => a.number - b.number);
}

const isDifferenceKind = (value: unknown): value is VatDifferenceKind => (VAT_DIFFERENCE_KINDS as readonly string[]).includes(String(value));

function differenceOf(r: Row): VatDifferenceRow {
  const docId = r.doc_id === null || r.doc_id === undefined ? null : Number(r.doc_id);
  const kind: VatDocumentKind | null = r.doc_type === 'return' ? 'return' : r.doc_type ? 'sale' : null;
  return {
    key: String(r.key ?? ''),
    kind: isDifferenceKind(r.kind) ? r.kind : 'other',
    document: docId ? { id: docId, kind, refNumber: String(r.ref_number ?? ''), date: String(r.doc_day ?? '') } : null,
    vouchers: vouchersOf(r.vouchers),
    expected: str(r.expected),
    ledger: str(r.ledger),
    difference: str(r.difference),
  };
}

async function comparisonOf(params: VatReportParams, accountId: number, ledger: VatLedger, totals: VatAmounts, limit: number): Promise<VatComparison> {
  const res = await orm.execute(vatDifferencesSql(params, accountId, limit));
  const rows = res.rows as Row[];
  const ledgerNet = fin(ledger.credit.total).subtract(ledger.debit.total);
  return {
    documentsNet: totals.netVat,
    ledgerNet: ledgerNet.round(4).toString(),
    difference: ledgerNet.subtract(totals.netVat).round(4).toString(),
    rows: rows.map(differenceOf),
    rowCount: Number(rows[0]?.total_rows ?? 0),
  };
}

export async function vatReport(params: VatReportParams, options: VatReportOptions): Promise<VatReport> {
  assertParams(params);
  const [rates, warnings, documents, account] = await Promise.all([
    ratesOf(params),
    warningsOf(params),
    documentsOf(params),
    AccountMappingService.getSalesVatPayableAccount(),
  ]);
  const totals = sumAmounts(rates);
  const ledger = account ? await ledgerOf(params, account) : null;
  const comparison = account && ledger ? await comparisonOf(params, account.id, ledger, totals, options.differenceLimit) : null;
  return {
    range: { from: params.from, to: params.to },
    list: params.list,
    rates,
    totals,
    warnings,
    ledger,
    comparison,
    documents: documents.rows,
    total: documents.total,
    page: params.page,
    limit: params.limit,
  };
}
