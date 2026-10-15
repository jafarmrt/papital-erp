import { formatCurrencyLabel } from '../../utils/formatters.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import {
  REPORT_COMPARE_LABELS, REPORT_PERIOD_UNIT_LABELS, presetRange, type ReportCompareMode, type ReportPeriodUnit, type ReportRange,
} from './reportPeriods.js';
import { rangeMeta, reportFileName, type ReportCell, type ReportSheet } from './reportExport.js';

/**
 * v10.1.15 (D-03 بخش ۴، طرح گزارش‌های مدیریتی §۵، تصمیم ت۱۵): قرارداد «گزارش خرید»، مشترک کارساز (`GET /reports/purchases`)
 * و زبانه «خرید» صفحه «گزارش‌های مدیریتی»، با همان موتور گزارش فروش.
 *
 * خرید: رسید و سند خرید قطعی و باطل‌نشده به تاریخ خود سند (رسید انبار، سند خرید و سفارش تحویل‌شده تدارکات). سند برگشت از
 * خرید در برنامه نیست. مبلغ هر سطر مقدار × بهای واحد منهای تخفیف سطر است (همان مبلغی که سند حسابداری خرید به بستانکار
 * تأمین‌کننده می‌زند)؛ کالای اهدایی (بهای صفر) فقط در مقدار می‌آید. نمای «همه ارزها» هر سند ارزی را با نرخ خود سند به ریال
 * می‌آورد و نمای یک ارز فقط سندهای همان ارز را با مبلغ خودشان. مقدار و میانگین بهای خرید فقط وقتی کالا در تفکیک یا پالایه است.
 */

export const PURCHASE_DIMENSIONS = ['supplier', 'item', 'category', 'period'] as const;
export type PurchaseDimension = typeof PURCHASE_DIMENSIONS[number];
export const PURCHASE_DIMENSION_LABELS: Record<PurchaseDimension, string> = {
  supplier: 'تأمین‌کننده',
  item: 'کالا',
  category: 'دسته کالا',
  period: 'دوره',
};

/** برچسب گروه بی مقدار هر تفکیک */
export const PURCHASE_EMPTY_GROUP_LABELS: Record<PurchaseDimension, string> = {
  supplier: 'بی تأمین‌کننده',
  item: 'کالای حذف‌شده',
  category: 'بی دسته',
  period: 'بی دوره',
};

export const PURCHASE_REPORT_DEFAULT_LIMIT = 50;
export const PURCHASE_REPORT_MAX_LIMIT = 200;
/** بیشترین ردیف خروجی اکسل */
export const PURCHASE_REPORT_EXPORT_LIMIT = 5000;
export const PURCHASE_TOP_COUNT = 10;

export interface PurchaseReportFilters {
  /** تأمین‌کننده */
  partyId?: number | null;
  itemId?: number | null;
  category?: string | null;
}

export interface PurchaseReportParams extends PurchaseReportFilters {
  from: string;
  to: string;
  groupBy: PurchaseDimension;
  thenBy?: PurchaseDimension | null;
  period: ReportPeriodUnit;
  /** 'all' یا کد ارز */
  currency: string;
  compare: ReportCompareMode;
  page: number;
  limit: number;
}

export interface PurchaseGroup {
  key: string;
  label: string;
  /** کد کالا */
  code?: string | null;
  /** واحد کالا */
  unit?: string | null;
}

export interface PurchaseAmounts {
  documentCount: number;
  /** فقط وقتی کالا در تفکیک یا پالایه است (جمع واحدهای گوناگون بی‌معناست) */
  quantity: string | null;
  gross: string;
  discount: string;
  net: string;
  /** خرید خالص ÷ مقدار، چهار رقم اعشار؛ فقط همراه مقدار و وقتی مقدار صفر نیست */
  averageUnitPrice: string | null;
}

export interface PurchaseReportRow extends PurchaseAmounts {
  group: PurchaseGroup;
  then: PurchaseGroup | null;
  /** خرید خالص همین گروه در دوره مقایسه */
  previousNet: string | null;
  changePercent: number | null;
}

export interface PurchaseTopEntry extends PurchaseGroup {
  quantity: string | null;
  net: string;
}

export interface PurchaseReport {
  range: ReportRange;
  currency: string;
  groupBy: PurchaseDimension;
  thenBy: PurchaseDimension | null;
  period: ReportPeriodUnit;
  rows: PurchaseReportRow[];
  total: number;
  page: number;
  limit: number;
  totals: PurchaseAmounts;
  comparison: { mode: ReportCompareMode; range: ReportRange; totals: PurchaseAmounts; changePercent: number | null } | null;
  topSuppliers: PurchaseTopEntry[];
  topItems: PurchaseTopEntry[];
  /** سند ارزی بی نرخ تبدیل که در نمای همه ارزها کنار ماند */
  unconvertedDocuments: number;
}

/** پیش‌فرض زبانه خرید، همان پیش‌فرض کارساز: این ماه تا امروز، به تفکیک تأمین‌کننده، همه ارزها به ریال، بی مقایسه */
export function defaultPurchaseParams(todayIso: string): PurchaseReportParams {
  const range = presetRange('this_month', todayIso) ?? { from: todayIso, to: todayIso };
  return {
    from: range.from,
    to: range.to,
    groupBy: 'supplier',
    thenBy: null,
    period: 'month',
    currency: 'all',
    compare: 'none',
    partyId: null,
    itemId: null,
    category: null,
    page: 1,
    limit: PURCHASE_REPORT_DEFAULT_LIMIT,
  };
}

/** نام تأمین‌کننده و کالای انتخاب‌شده (از فهرست انتخاب صفحه) */
export interface PurchaseFilterLabels {
  party?: string;
  item?: string;
}

/** سطرهای مشخصات پالایه‌ها برای سربرگ چاپ و برگه اکسل */
export function purchaseFilterMeta(filters: PurchaseReportFilters, labels: PurchaseFilterLabels = {}): Array<[string, string]> {
  const meta: Array<[string, string]> = [];
  const named = (id: number | null | undefined, label: string | undefined) => label?.trim() || `شناسه ${toPersianDigits(String(id))}`;
  if (filters.partyId) meta.push(['تأمین‌کننده', named(filters.partyId, labels.party)]);
  if (filters.itemId) meta.push(['کالا', named(filters.itemId, labels.item)]);
  if (filters.category) meta.push(['دسته کالا', filters.category]);
  return meta;
}

/** آیا مقدار شمرده می‌شود؟ کالا در تفکیک یا یک کالا در پالایه */
export function purchaseQuantityApplies(groupBy: PurchaseDimension, thenBy: PurchaseDimension | null | undefined, itemId?: number | null): boolean {
  return groupBy === 'item' || thenBy === 'item' || Boolean(itemId);
}

/** رشته پرسش نشانی گزارش؛ پالایه خالی فرستاده نمی‌شود */
export function purchaseReportSearch(params: Partial<PurchaseReportParams> & { export?: boolean }): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  return query.toString();
}

export function purchaseCurrencyLabel(currency: string): string {
  return currency === 'all' ? 'همه ارزها به ریال' : formatCurrencyLabel(currency);
}

const num = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

function groupTitle(group: PurchaseGroup): string {
  return group.code ? `${group.label} (${group.code})` : group.label;
}

/** برگه اصلی خروجی اکسل گزارش خرید، با همان ستون‌های جدول صفحه */
export function purchaseReportSheet(report: PurchaseReport, filterMeta: Array<[string, string]> = []): ReportSheet {
  const unit = report.currency === 'all' ? 'ریال' : formatCurrencyLabel(report.currency);
  const withQuantity = report.rows.some(r => r.quantity !== null) || report.totals.quantity !== null;
  const withPrevious = report.comparison !== null;
  const columns = [
    PURCHASE_DIMENSION_LABELS[report.groupBy],
    ...(report.thenBy ? [PURCHASE_DIMENSION_LABELS[report.thenBy]] : []),
    'تعداد سند',
    ...(withQuantity ? ['مقدار'] : []),
    `مبلغ ناخالص (${unit})`,
    `تخفیف (${unit})`,
    `خرید خالص (${unit})`,
    ...(withQuantity ? [`میانگین بهای خرید (${unit})`] : []),
    ...(withPrevious ? [`دوره مقایسه (${unit})`, 'درصد تغییر'] : []),
  ];
  const amountCells = (a: PurchaseAmounts): ReportCell[] => [
    a.documentCount,
    ...(withQuantity ? [num(a.quantity)] : []),
    num(a.gross), num(a.discount), num(a.net),
    ...(withQuantity ? [num(a.averageUnitPrice)] : []),
  ];
  const rows = report.rows.map(row => [
    groupTitle(row.group),
    ...(report.thenBy ? [row.then ? groupTitle(row.then) : ''] : []),
    ...amountCells(row),
    ...(withPrevious ? [num(row.previousNet), row.changePercent] : []),
  ]);
  const totals: ReportCell[] = [
    'جمع',
    ...(report.thenBy ? [''] : []),
    ...amountCells(report.totals),
    ...(withPrevious && report.comparison ? [num(report.comparison.totals.net), report.comparison.changePercent] : []),
  ];
  return {
    name: 'گزارش خرید',
    title: 'گزارش خرید',
    meta: [
      rangeMeta(report.range),
      ['ارز', purchaseCurrencyLabel(report.currency)],
      ['تفکیک', [report.groupBy, report.thenBy].filter((d): d is PurchaseDimension => Boolean(d)).map(d => PURCHASE_DIMENSION_LABELS[d]).join(' و ')],
      ...(report.groupBy === 'period' || report.thenBy === 'period' ? [['دوره', REPORT_PERIOD_UNIT_LABELS[report.period]] as [string, string]] : []),
      ...(report.comparison ? [['مقایسه با', REPORT_COMPARE_LABELS[report.comparison.mode]] as [string, string]] : []),
      ...filterMeta,
    ],
    columns,
    rows,
    totals,
  };
}

/** برگه‌های ده تأمین‌کننده بزرگ و ده کالای پرخرید */
export function purchaseTopSheets(report: PurchaseReport): ReportSheet[] {
  const unit = report.currency === 'all' ? 'ریال' : formatCurrencyLabel(report.currency);
  const sheet = (name: string, column: string, entries: PurchaseTopEntry[], withQuantity: boolean): ReportSheet => ({
    name,
    title: name,
    meta: [rangeMeta(report.range)],
    columns: ['ردیف', column, ...(withQuantity ? ['مقدار'] : []), `خرید خالص (${unit})`],
    rows: entries.map((e, i) => [i + 1, groupTitle(e), ...(withQuantity ? [num(e.quantity)] : []), num(e.net)]),
  });
  return [
    sheet('ده تأمین‌کننده بزرگ', 'تأمین‌کننده', report.topSuppliers, false),
    sheet('ده کالای پرخرید', 'کالا', report.topItems, true),
  ];
}

/** «گزارش-خرید-۱۴۰۵-۰۸.xlsx» */
export function purchaseReportFileName(range: ReportRange): string {
  return reportFileName('گزارش خرید', range);
}
