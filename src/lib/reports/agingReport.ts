import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { formatCurrencyLabel } from '../../utils/formatters.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { reportDayFileName, type ReportCell, type ReportSheet } from './reportExport.js';

/**
 * v10.1.9 (D-03، طرح گزارش‌های مدیریتی §۳، تصمیم‌های ت۷ تا ت۱۱): قرارداد «سن مطالبات و بدهی‌ها»، مشترک کارساز
 * (`GET /reports/aging`) و زبانه همین نام در صفحه «گزارش‌های مدیریتی».
 *
 * پایه دفتر کل است (ت۷ الف): مانده هر طرف حساب روی حساب دریافتنی تجاری (مطالبات) یا پرداختنی تجاری (بدهی‌ها) تا «تاریخ
 * گزارش»، از ردیف‌های سند با تفصیلی همان طرف حساب (قاعده TD-416 صورت‌حساب). ردیف کاهنده به ترتیب از قدیمی‌ترین ردیف
 * افزاینده کم می‌شود و آنچه می‌ماند به سن تاریخ سند خودش می‌رود (فاکتور سررسید ندارد، ت۸). مانده سوی دیگر (پیش‌دریافت یا
 * پیش‌پرداخت) جدا و بی سن است. سند پیش‌نویس پیش‌فرض شمرده می‌شود و سهمش جدا نشان داده می‌شود (ت۱۰). چک وصول‌نشده طرف
 * حساب ستون جداست (ت۱۱). مبلغ‌ها رشته دهدهی‌اند؛ نمای «همه ارزها» ردیف ارزی را با نرخ خودش به ریال می‌آورد (TD-260).
 */

export const AGING_KINDS = ['receivable', 'payable'] as const;
export type AgingKind = typeof AGING_KINDS[number];
export const AGING_KIND_LABELS: Record<AgingKind, string> = { receivable: 'مطالبات از مشتریان', payable: 'بدهی به تأمین‌کنندگان' };
export const AGING_REPORT_TITLES: Record<AgingKind, string> = { receivable: 'سن مطالبات', payable: 'سن بدهی‌ها' };
/** مانده سوی دیگر حساب: مشتری بستانکار (پیش‌دریافت) یا تأمین‌کننده بدهکار (پیش‌پرداخت) */
export const AGING_ADVANCE_LABELS: Record<AgingKind, string> = { receivable: 'پیش‌دریافت (بستانکار)', payable: 'پیش‌پرداخت (بدهکار)' };
export const AGING_PARTY_LABELS: Record<AgingKind, string> = { receivable: 'مشتری', payable: 'تأمین‌کننده' };
export const AGING_SETTLEMENT_LABELS: Record<AgingKind, string> = { receivable: 'آخرین دریافت', payable: 'آخرین پرداخت' };

/** بازه‌های سن به روز از تاریخ سند (ت۹) */
export const AGING_BUCKETS = [
  { key: 'upTo30', label: 'جاری تا ۳۰ روز', toDay: 30 },
  { key: 'upTo60', label: '۳۱ تا ۶۰ روز', toDay: 60 },
  { key: 'upTo90', label: '۶۱ تا ۹۰ روز', toDay: 90 },
  { key: 'upTo180', label: '۹۱ تا ۱۸۰ روز', toDay: 180 },
  { key: 'over180', label: 'بیش از ۱۸۰ روز', toDay: null },
] as const;
export type AgingBucketKey = typeof AGING_BUCKETS[number]['key'];
export type AgingBuckets = Record<AgingBucketKey, string>;
/** بازه‌هایی که «بالای ۹۰ روز» شمرده می‌شوند (مرتب‌سازی «سررسیدگذشته») */
export const AGING_OVERDUE_BUCKETS: readonly AgingBucketKey[] = ['upTo180', 'over180'];

export const AGING_SORTS = ['balance', 'overdue', 'name'] as const;
export type AgingSort = typeof AGING_SORTS[number];
export const AGING_SORT_LABELS: Record<AgingSort, string> = {
  balance: 'بیشترین مانده',
  overdue: 'بیشترین مانده بالای ۹۰ روز',
  name: 'نام طرف حساب',
};

/** وضعیت‌های چک که هنوز پول نیامده یا نرفته است */
export const AGING_PENDING_CHEQUE_STATUSES = ['received', 'in_treasury', 'in_safe', 'in_collection'] as const;

export const AGING_REPORT_DEFAULT_LIMIT = 50;
export const AGING_REPORT_MAX_LIMIT = 200;
/** بیشترین ردیف خروجی اکسل */
export const AGING_REPORT_EXPORT_LIMIT = 5000;

export interface AgingReportParams {
  kind: AgingKind;
  /** تاریخ گزارش، ISO؛ سن در این روز */
  asOf: string;
  /** 'all' یا کد ارز */
  currency: string;
  /** فقط سندهای تأییدشده و دائم (پیش‌فرض: پیش‌نویس هم شمرده می‌شود، ت۱۰) */
  approvedOnly: boolean;
  partyId?: number | null;
  sort: AgingSort;
  page: number;
  limit: number;
}

/**
 * - party: طرف حساب جدول طرف حساب‌ها (با شناسه، یا ردیف قدیمیِ بی‌شناسه با نام دقیق او)
 * - name: ردیف با نام تفصیلی که به هیچ طرف حسابی نمی‌رسد
 * - none: ردیف بی تفصیلی روی همین حساب
 */
export type AgingPartyKind = 'party' | 'name' | 'none';

export interface AgingParty {
  id: number | null;
  name: string;
  kind: AgingPartyKind;
  /** طرف حساب حذف‌شده‌ای که هنوز مانده دارد */
  deleted: boolean;
}

export interface AgingAmounts {
  /** مانده خالص؛ مثبت یعنی طلب ما (مطالبات) یا بدهی ما (بدهی‌ها) */
  balance: string;
  /** مانده مثبت به تفکیک سن؛ جمع بازه‌ها همان مانده است */
  buckets: AgingBuckets;
  /** مانده سوی دیگر، مثبت؛ سن ندارد */
  advance: string;
  /** سهم سندهای پیش‌نویس در مانده؛ با «فقط تأییدشده» null */
  draft: string | null;
  /** چک‌های وصول‌نشده (دریافتی برای مطالبات، پرداختی برای بدهی‌ها)؛ در نمای یک ارز خارجی null */
  pendingCheques: string | null;
  /** چک دریافتی برگشت‌خورده و عودت‌نشده؛ فقط مطالبات */
  bouncedCheques: string | null;
}

export interface AgingLastSettlement {
  date: string;
  amount: string;
  /** با چک یا وجه نقد و بانک */
  byCheque: boolean;
}

export interface AgingRow extends AgingAmounts {
  key: string;
  party: AgingParty;
  lastSettlement: AgingLastSettlement | null;
}

export interface AgingTotals extends AgingAmounts {
  partyCount: number;
}

export interface AgingReport {
  kind: AgingKind;
  asOf: string;
  currency: string;
  approvedOnly: boolean;
  sort: AgingSort;
  rows: AgingRow[];
  total: number;
  page: number;
  limit: number;
  totals: AgingTotals;
  /** سهم هر بازه از جمع مانده‌های سن‌دار، درصد با یک رقم اعشار؛ بی مانده null */
  bucketPercents: Record<AgingBucketKey, number | null>;
  /** حساب دفتر کل گزارش (همراه زیرحساب‌هایش) */
  account: { code: string; name: string };
  /** ستون‌های چک (چک‌ها فقط ریالی‌اند، TD-275) */
  chequesApply: boolean;
}

/** پیش‌فرض زبانه، همان پیش‌فرض کارساز: مطالبات تا امروز، همه ارزها به ریال، با پیش‌نویس، بیشترین مانده نخست */
export function defaultAgingParams(todayIso: string): AgingReportParams {
  return {
    kind: 'receivable',
    asOf: todayIso,
    currency: 'all',
    approvedOnly: false,
    partyId: null,
    sort: 'balance',
    page: 1,
    limit: AGING_REPORT_DEFAULT_LIMIT,
  };
}

/** رشته پرسش نشانی گزارش؛ مقدار خالی و `false` فرستاده نمی‌شود */
export function agingReportSearch(params: Partial<AgingReportParams> & { export?: boolean }): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  return query.toString();
}

const num = (value: string | null | undefined): number => Number(value ?? 0);

/** سهم هر بازه از جمع بازه‌ها؛ جمع صفر ← null */
export function agingBucketPercents(buckets: AgingBuckets): Record<AgingBucketKey, number | null> {
  const sum = AGING_BUCKETS.reduce((acc, b) => acc + num(buckets[b.key]), 0);
  const out = {} as Record<AgingBucketKey, number | null>;
  for (const b of AGING_BUCKETS) out[b.key] = sum > 0 ? Math.round(num(buckets[b.key]) / sum * 1000) / 10 : null;
  return out;
}

/** مانده بالای ۹۰ روز */
export function agingOverdue(buckets: AgingBuckets): number {
  return AGING_OVERDUE_BUCKETS.reduce((acc, key) => acc + num(buckets[key]), 0);
}

export function agingCurrencyLabel(currency: string): string {
  return currency === 'all' ? 'همه ارزها به ریال' : formatCurrencyLabel(currency);
}

/** «فلان (حذف‌شده)»، نام تفصیلی بی طرف حساب، یا «بی تفصیلی» */
export function agingPartyTitle(party: AgingParty): string {
  if (party.kind === 'none') return 'بی تفصیلی';
  if (party.kind === 'name') return `${party.name} (بی طرف حساب)`;
  return party.deleted ? `${party.name} (حذف‌شده)` : party.name;
}

/** نشانی صورت‌حساب طرف حساب در «گزارش‌های مالی» حسابداری؛ فقط برای طرف حساب جدول طرف حساب‌ها */
export function agingStatementPath(kind: AgingKind, party: AgingParty): string | null {
  if (party.kind !== 'party' || !party.id) return null;
  const partyType = kind === 'receivable' ? 'customer' : 'supplier';
  return `/accounting/reports?subTab=party_ledger&partyType=${partyType}&partyId=${party.id}`;
}

/** سطرهای مشخصات گزارش برای سربرگ چاپ و برگه اکسل */
export function agingReportMeta(report: AgingReport, partyLabel?: string): Array<[string, string]> {
  const meta: Array<[string, string]> = [
    ['تاریخ گزارش', toPersianDigits(isoToJalaliDate(report.asOf))],
    ['حساب دفتر کل', `${report.account.name} (${toPersianDigits(report.account.code)})`],
    ['ارز', agingCurrencyLabel(report.currency)],
    ['سندها', report.approvedOnly ? 'فقط سندهای تأییدشده و دائم' : 'همه سندها، همراه پیش‌نویس'],
  ];
  if (partyLabel) meta.push([AGING_PARTY_LABELS[report.kind], partyLabel]);
  return meta;
}

/** واحد ستون‌های مبلغ اکسل: ریال در نمای همه ارزها، وگرنه همان ارز */
function amountUnit(currency: string): string {
  return currency === 'all' ? 'ریال' : formatCurrencyLabel(currency);
}

const cell = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

/** برگه خروجی اکسل، با همان ستون‌های جدول صفحه و یک سطر سهم بازه‌ها زیر جمع */
export function agingReportSheet(report: AgingReport, partyLabel?: string): ReportSheet {
  const unit = amountUnit(report.currency);
  const withDraft = !report.approvedOnly;
  const withBounced = report.chequesApply && report.kind === 'receivable';
  const columns = [
    AGING_PARTY_LABELS[report.kind],
    `مانده (${unit})`,
    ...AGING_BUCKETS.map(b => `${b.label} (${unit})`),
    `${AGING_ADVANCE_LABELS[report.kind]} (${unit})`,
    ...(withDraft ? [`از سندهای پیش‌نویس (${unit})`] : []),
    ...(report.chequesApply ? ['چک وصول‌نشده (ریال)'] : []),
    ...(withBounced ? ['چک برگشتی (ریال)'] : []),
    `تاریخ ${AGING_SETTLEMENT_LABELS[report.kind]}`,
    `مبلغ ${AGING_SETTLEMENT_LABELS[report.kind]} (${unit})`,
  ];
  const amountCells = (a: AgingAmounts): ReportCell[] => [
    cell(a.balance),
    ...AGING_BUCKETS.map(b => cell(a.buckets[b.key])),
    cell(a.advance),
    ...(withDraft ? [cell(a.draft)] : []),
    ...(report.chequesApply ? [cell(a.pendingCheques)] : []),
    ...(withBounced ? [cell(a.bouncedCheques)] : []),
  ];
  const rows = report.rows.map(row => [
    agingPartyTitle(row.party),
    ...amountCells(row),
    row.lastSettlement ? toPersianDigits(isoToJalaliDate(row.lastSettlement.date)) : '',
    row.lastSettlement ? cell(row.lastSettlement.amount) : null,
  ]);
  const totals: ReportCell[] = [`جمع (${toPersianDigits(String(report.totals.partyCount))} طرف حساب)`, ...amountCells(report.totals), '', null];
  const percentRow: ReportCell[] = ['سهم از مانده سن‌دار (درصد)', null, ...AGING_BUCKETS.map(b => report.bucketPercents[b.key])];
  const title = AGING_REPORT_TITLES[report.kind];
  return {
    name: title,
    title,
    meta: agingReportMeta(report, partyLabel),
    columns,
    rows,
    totals,
    footer: [percentRow],
  };
}

/** «سن-مطالبات-۱۴۰۵-۰۷-۲۳.xlsx» */
export function agingReportFileName(kind: AgingKind, asOf: string): string {
  return reportDayFileName(AGING_REPORT_TITLES[kind], asOf);
}
