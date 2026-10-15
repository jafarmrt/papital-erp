import { formatCurrencyLabel } from '../../utils/formatters.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import {
  REPORT_COMPARE_LABELS, REPORT_PERIOD_UNIT_LABELS, presetRange, type ReportCompareMode, type ReportPeriodUnit, type ReportRange,
} from './reportPeriods.js';
import { rangeMeta, reportFileName, type ReportCell, type ReportSheet } from './reportExport.js';

/**
 * v10.1.7 (D-03، طرح گزارش‌های مدیریتی §۲، تصمیم‌های ت۲ تا ت۶): قرارداد «گزارش فروش»، مشترک کارساز
 * (`GET /reports/sales`) و زبانه فروش صفحه «گزارش‌های مدیریتی».
 *
 * فروش: فاکتور فروش قطعی و باطل‌نشده به تاریخ خودش؛ برگشت از فروش قطعی به تاریخ خود برگشت کم می‌شود (ت۵). مبلغ‌ها
 * رشته دهدهی‌اند؛ نمای «همه ارزها» هر سند ارزی را با نرخ خود سند به ریال می‌آورد و نمای یک ارز فقط سندهای همان ارز را با
 * مبلغ خودشان (ت۴). بها و سود ناخالص فقط برای خواننده بهای کالا (ت۳)، و مقدار فقط وقتی کالا در تفکیک یا پالایه است.
 */

export const SALES_DIMENSIONS = ['item', 'customer', 'category', 'period', 'project', 'channel'] as const;
export type SalesDimension = typeof SALES_DIMENSIONS[number];
export const SALES_DIMENSION_LABELS: Record<SalesDimension, string> = {
  item: 'کالا',
  customer: 'مشتری',
  category: 'دسته کالا',
  period: 'دوره',
  project: 'پروژه',
  channel: 'کانال فروش',
};

export const SALES_CHANNELS = ['online', 'direct'] as const;
export type SalesChannel = typeof SALES_CHANNELS[number];
export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = { online: 'فروشگاه برخط', direct: 'فروش مستقیم' };

/** برچسب گروه بی مقدار هر تفکیک */
export const SALES_EMPTY_GROUP_LABELS: Record<SalesDimension, string> = {
  item: 'کالای حذف‌شده',
  customer: 'بی نام',
  category: 'بی دسته',
  period: 'بی دوره',
  project: 'بی پروژه',
  channel: 'نامعلوم',
};

export const SALES_REPORT_DEFAULT_LIMIT = 50;
export const SALES_REPORT_MAX_LIMIT = 200;
/** بیشترین ردیف خروجی اکسل */
export const SALES_REPORT_EXPORT_LIMIT = 5000;
export const SALES_TOP_COUNT = 10;

export interface SalesReportFilters {
  partyId?: number | null;
  itemId?: number | null;
  category?: string | null;
  projectId?: number | null;
  channel?: SalesChannel | null;
}

export interface SalesReportParams extends SalesReportFilters {
  from: string;
  to: string;
  groupBy: SalesDimension;
  thenBy?: SalesDimension | null;
  period: ReportPeriodUnit;
  /** 'all' یا کد ارز */
  currency: string;
  compare: ReportCompareMode;
  page: number;
  limit: number;
}

export interface SalesGroup {
  key: string;
  label: string;
  /** کد کالا یا پروژه */
  code?: string | null;
  /** واحد کالا */
  unit?: string | null;
}

export interface SalesAmounts {
  invoiceCount: number;
  returnCount: number;
  /** فقط وقتی کالا در تفکیک یا پالایه است (جمع واحدهای گوناگون بی‌معناست) */
  quantity: string | null;
  returnQuantity: string | null;
  gross: string;
  discount: string;
  net: string;
  returnAmount: string;
  netAfterReturns: string;
  /** بهای فروش منهای بهای برگشت؛ فقط برای خواننده بهای کالا */
  cost: string | null;
  grossProfit: string | null;
  /** سود ناخالص ÷ فروش خالص پس از برگشت × ۱۰۰، یک رقم اعشار */
  marginPercent: number | null;
}

export interface SalesReportRow extends SalesAmounts {
  group: SalesGroup;
  then: SalesGroup | null;
  /** فروش خالص پس از برگشت همین گروه در دوره مقایسه */
  previousNetAfterReturns: string | null;
  changePercent: number | null;
}

export interface SalesTotals extends SalesAmounts {
  /** مالیات و حمل و خدمات سطح سندند؛ با پالایه کالا یا دسته null */
  vat: string | null;
  returnVat: string | null;
  serviceCharge: string | null;
}

export interface SalesTopEntry {
  key: string;
  label: string;
  code?: string | null;
  unit?: string | null;
  quantity: string | null;
  netAfterReturns: string;
}

export interface SalesLedgerCheck {
  /** فروش خالص پس از برگشت همین گزارش */
  reportNet: string;
  /** درآمد فروش منهای تخفیف و برگشت در دفتر کل، سندهای تأییدشده و دائم */
  approved: string;
  /** همان، سندهای پیش‌نویس */
  draft: string;
  ledgerTotal: string;
  /** گزارش منهای دفتر */
  difference: string;
  accounts: Array<{ code: string; name: string }>;
}

export type SalesLedgerUnavailable = 'no_access' | 'filtered';

export interface SalesReport {
  range: ReportRange;
  currency: string;
  groupBy: SalesDimension;
  thenBy: SalesDimension | null;
  period: ReportPeriodUnit;
  rows: SalesReportRow[];
  total: number;
  page: number;
  limit: number;
  totals: SalesTotals;
  comparison: { mode: ReportCompareMode; range: ReportRange; totals: SalesTotals; changePercent: number | null } | null;
  topItems: SalesTopEntry[];
  topCustomers: SalesTopEntry[];
  ledger: SalesLedgerCheck | null;
  ledgerUnavailable: SalesLedgerUnavailable | null;
  costVisible: boolean;
  /** سند ارزی بی نرخ تبدیل: در نمای همه ارزها کنار ماند؛ در نمای یک ارز بهایش در سود نیامد */
  unconvertedDocuments: number;
}

/** پیش‌فرض زبانه فروش، همان پیش‌فرض کارساز: این ماه تا امروز، به تفکیک کالا، همه ارزها به ریال، بی مقایسه */
export function defaultSalesParams(todayIso: string): SalesReportParams {
  const range = presetRange('this_month', todayIso) ?? { from: todayIso, to: todayIso };
  return {
    from: range.from,
    to: range.to,
    groupBy: 'item',
    thenBy: null,
    period: 'month',
    currency: 'all',
    compare: 'none',
    partyId: null,
    itemId: null,
    projectId: null,
    category: null,
    channel: null,
    page: 1,
    limit: SALES_REPORT_DEFAULT_LIMIT,
  };
}

/** نام طرف حساب، کالا و پروژه انتخاب‌شده (از فهرست انتخاب صفحه) */
export interface SalesFilterLabels {
  party?: string;
  item?: string;
  project?: string;
}

/** سطرهای مشخصات پالایه‌های گزارش برای سربرگ چاپ و برگه اکسل */
export function salesFilterMeta(filters: SalesReportFilters, labels: SalesFilterLabels = {}): Array<[string, string]> {
  const meta: Array<[string, string]> = [];
  const named = (id: number | null | undefined, label: string | undefined) => label?.trim() || `شناسه ${toPersianDigits(String(id))}`;
  if (filters.partyId) meta.push(['مشتری', named(filters.partyId, labels.party)]);
  if (filters.itemId) meta.push(['کالا', named(filters.itemId, labels.item)]);
  if (filters.category) meta.push(['دسته کالا', filters.category]);
  if (filters.projectId) meta.push(['پروژه', named(filters.projectId, labels.project)]);
  if (filters.channel) meta.push(['کانال فروش', SALES_CHANNEL_LABELS[filters.channel]]);
  return meta;
}

/** آیا مقدار شمرده می‌شود؟ کالا در تفکیک یا یک کالا در پالایه */
export function quantityApplies(groupBy: SalesDimension, thenBy: SalesDimension | null | undefined, itemId?: number | null): boolean {
  return groupBy === 'item' || thenBy === 'item' || Boolean(itemId);
}

/** رشته پرسش نشانی گزارش؛ پالایه خالی فرستاده نمی‌شود */
export function salesReportSearch(params: Partial<SalesReportParams> & { export?: boolean }): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  return query.toString();
}

export function salesCurrencyLabel(currency: string): string {
  return currency === 'all' ? 'همه ارزها به ریال' : formatCurrencyLabel(currency);
}

/** واحد ستون‌های مبلغ اکسل: ریال در نمای همه ارزها، وگرنه همان ارز */
function amountUnit(currency: string): string {
  return currency === 'all' ? 'ریال' : formatCurrencyLabel(currency);
}

const num = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

function groupTitle(group: SalesGroup): string {
  return group.code ? `${group.label} (${group.code})` : group.label;
}

/** برگه اصلی خروجی اکسل گزارش فروش، با همان ستون‌های جدول صفحه */
export function salesReportSheet(report: SalesReport, filterMeta: Array<[string, string]> = []): ReportSheet {
  const unit = amountUnit(report.currency);
  const withQuantity = report.rows.some(r => r.quantity !== null) || report.totals.quantity !== null;
  const withPrevious = report.comparison !== null;
  const columns = [
    SALES_DIMENSION_LABELS[report.groupBy],
    ...(report.thenBy ? [SALES_DIMENSION_LABELS[report.thenBy]] : []),
    'تعداد فاکتور',
    ...(withQuantity ? ['مقدار', 'مقدار برگشتی'] : []),
    `مبلغ ناخالص (${unit})`,
    `تخفیف (${unit})`,
    `فروش خالص (${unit})`,
    `برگشت از فروش (${unit})`,
    `فروش خالص پس از برگشت (${unit})`,
    ...(report.costVisible ? [`بهای تمام‌شده (${unit})`, `سود ناخالص (${unit})`, 'درصد سود'] : []),
    ...(withPrevious ? [`دوره مقایسه (${unit})`, 'درصد تغییر'] : []),
  ];
  const amountCells = (a: SalesAmounts): ReportCell[] => [
    a.invoiceCount,
    ...(withQuantity ? [num(a.quantity), num(a.returnQuantity)] : []),
    num(a.gross), num(a.discount), num(a.net), num(a.returnAmount), num(a.netAfterReturns),
    ...(report.costVisible ? [num(a.cost), num(a.grossProfit), a.marginPercent] : []),
  ];
  const rows = report.rows.map(row => [
    groupTitle(row.group),
    ...(report.thenBy ? [row.then ? groupTitle(row.then) : ''] : []),
    ...amountCells(row),
    ...(withPrevious ? [num(row.previousNetAfterReturns), row.changePercent] : []),
  ]);
  const totals: ReportCell[] = [
    'جمع',
    ...(report.thenBy ? [''] : []),
    ...amountCells(report.totals),
    ...(withPrevious && report.comparison ? [num(report.comparison.totals.netAfterReturns), report.comparison.changePercent] : []),
  ];
  return {
    name: 'گزارش فروش',
    title: 'گزارش فروش',
    meta: [
      rangeMeta(report.range),
      ['ارز', salesCurrencyLabel(report.currency)],
      ['تفکیک', [report.groupBy, report.thenBy].filter((d): d is SalesDimension => Boolean(d)).map(d => SALES_DIMENSION_LABELS[d]).join(' و ')],
      ...(report.groupBy === 'period' || report.thenBy === 'period' ? [['دوره', REPORT_PERIOD_UNIT_LABELS[report.period]] as [string, string]] : []),
      ...(report.comparison ? [['مقایسه با', REPORT_COMPARE_LABELS[report.comparison.mode]] as [string, string]] : []),
      ...filterMeta,
    ],
    columns,
    rows,
    totals,
  };
}

/** برگه‌های ده کالای پرفروش و ده مشتری بزرگ */
export function salesTopSheets(report: SalesReport): ReportSheet[] {
  const unit = amountUnit(report.currency);
  const sheet = (name: string, entries: SalesTopEntry[], withQuantity: boolean): ReportSheet => ({
    name,
    title: name,
    meta: [rangeMeta(report.range)],
    columns: ['ردیف', name.includes('کالا') ? 'کالا' : 'مشتری', ...(withQuantity ? ['مقدار'] : []), `فروش خالص پس از برگشت (${unit})`],
    rows: entries.map((e, i) => [i + 1, groupTitle(e), ...(withQuantity ? [num(e.quantity)] : []), num(e.netAfterReturns)]),
  });
  return [sheet('ده کالای پرفروش', report.topItems, true), sheet('ده مشتری بزرگ', report.topCustomers, false)];
}

/** «گزارش-فروش-۱۴۰۵-۰۸.xlsx» */
export function salesReportFileName(range: ReportRange): string {
  return reportFileName('گزارش فروش', range);
}
