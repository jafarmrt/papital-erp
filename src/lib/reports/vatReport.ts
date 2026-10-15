import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { formatCurrencyLabel } from '../../utils/formatters.js';
import { formatPersianNumber, toPersianDigits } from '../../utils/persianNumber.js';
import { rangeLabel, type ReportRange } from './reportPeriods.js';

/**
 * v10.1.14 (D-03، طرح گزارش‌های مدیریتی §۴، تصمیم‌های ت۱۲ و ت۱۳): قرارداد «مالیات بر ارزش افزوده»، مشترک کارساز
 * (`GET /reports/vat`) و زبانه همین نام در صفحه «گزارش‌های مدیریتی».
 *
 * - بخش ۱، از سندها: فاکتورهای فروش و برگشت از فروش قطعی و باطل‌نشده بازه، به تاریخ خود سند، به تفکیک درصد مالیات. سند
 *   ارزی با نرخ خودش به ریال می‌آید (هر سند جدا گرد به ریال، همان قاعده ردیف سند حسابداری، TD-260) و سند ارزی بی نرخ کنار
 *   می‌ماند و شمرده می‌شود. مالیات برگشت کاهنده است.
 * - بخش ۲، از دفتر کل: حساب «مالیات بر ارزش افزوده» نگاشت حساب‌ها (پیش‌فرض 3203) و زیرحساب‌هایش: مانده اول دوره،
 *   بستانکار و بدهکار دوره به تفکیک منبع، مانده پایان دوره؛ سند پیش‌نویس شمرده می‌شود و سهمش جداست (همان قاعده سطر
 *   هم‌خوانی گزارش فروش، ت۲۸). اسناد بستن سال و افتتاحیه پس از آن شمرده نمی‌شوند.
 * - هم‌خوانی: تفاوت گردش خالص دفتر با خالص بخش ۱، با فهرست سندهایی که تفاوت را می‌سازند.
 * - مالیات خرید (اعتبار مالیاتی) در برنامه ثبت نمی‌شود (ت۱۳)؛ گزارش جای آن را خالی نشان می‌دهد. این گزارش کمک
 *   حسابدار است و فرم اظهارنامه نیست. مبلغ‌ها رشته دهدهی و همه به ریال‌اند.
 */

export const VAT_REPORT_TITLE = 'مالیات بر ارزش افزوده';

export const VAT_LIST_FILTERS = ['all', 'warnings'] as const;
export type VatListFilter = typeof VAT_LIST_FILTERS[number];
export const VAT_LIST_FILTER_LABELS: Record<VatListFilter, string> = { all: 'همه سندها', warnings: 'فقط سندهای دارای هشدار' };

export const VAT_REPORT_DEFAULT_LIMIT = 50;
export const VAT_REPORT_MAX_LIMIT = 200;
/** بیشترین ردیف خروجی اکسل (فهرست سندها و فهرست تفاوت‌ها) */
export const VAT_REPORT_EXPORT_LIMIT = 5000;
/** بیشترین ردیف فهرست تفاوت‌ها در صفحه؛ بزرگ‌ترین تفاوت‌ها نخست */
export const VAT_DIFFERENCE_PAGE_LIMIT = 100;

export type VatDocumentKind = 'sale' | 'return';
export const VAT_DOCUMENT_KIND_LABELS: Record<VatDocumentKind, string> = { sale: 'فاکتور فروش', return: 'برگشت از فروش' };

/**
 * هشدار یک سند:
 * - no_vat: فاکتور فروش ریالی با مبلغ خالص و بی مالیات (شاید فراموش شده باشد)
 * - rate_missing: فاکتور فروش با مالیات و بی درصد (مثل مالیات سفارش برخط که درصدی آن را نمی‌سازد، TD-936)
 * - rate_mismatch: فاکتور فروش که مالیاتش با درصد خودش از مبلغ خالص یکی نیست
 * - unconverted: سند ارزی بی نرخ تبدیل که در جمع‌ها نیامده
 */
export const VAT_WARNINGS = ['unconverted', 'rate_mismatch', 'rate_missing', 'no_vat'] as const;
export type VatWarning = typeof VAT_WARNINGS[number];
export const VAT_WARNING_LABELS: Record<VatWarning, string> = {
  unconverted: 'سند ارزی بی نرخ تبدیل؛ در جمع‌ها نیامده',
  rate_mismatch: 'مالیات با درصد سند یکی نیست',
  rate_missing: 'مالیات دارد ولی درصد ندارد',
  no_vat: 'فاکتور ریالی بی مالیات',
};

export const VAT_LEDGER_SOURCES = ['document', 'treasury', 'other'] as const;
export type VatLedgerSource = typeof VAT_LEDGER_SOURCES[number];
export const VAT_LEDGER_SOURCE_LABELS: Record<VatLedgerSource, string> = {
  document: 'سندهای فروش و برگشت',
  treasury: 'دریافت و پرداخت (خزانه و چک)',
  other: 'سندهای دستی و دیگر',
};

/**
 * چرا یک ردیف در فهرست تفاوت‌هاست:
 * - document_missing: سند بخش ۱ که در دفتر این دوره ردیف مالیات ندارد
 * - document_differs: ردیف مالیات دفتر با مالیات سند یکی نیست
 * - document_voided: سند باطل‌شده‌ای که ردیف یا برگشت ردیفش در این دوره است
 * - document_outside: ردیف سندی که بیرون از بخش ۱ این دوره است (تاریخ سند و سند حسابداری در دو دوره)
 * - document_unconverted: سند ارزی بی نرخ که در بخش ۱ نیامده ولی در دفتر ردیف دارد
 * - treasury / other: سند حسابداری بی سند فروش (پرداخت به اداره مالیات، سند دستی و…)
 */
export const VAT_DIFFERENCE_KINDS = [
  'document_missing', 'document_differs', 'document_voided', 'document_outside', 'document_unconverted', 'treasury', 'other',
] as const;
export type VatDifferenceKind = typeof VAT_DIFFERENCE_KINDS[number];
export const VAT_DIFFERENCE_KIND_LABELS: Record<VatDifferenceKind, string> = {
  document_missing: 'سند فروش بی ردیف مالیات در دفتر این دوره',
  document_differs: 'ردیف مالیات دفتر با مالیات سند یکی نیست',
  document_voided: 'سند باطل‌شده',
  document_outside: 'سند حسابداری این دوره برای سندی از دوره دیگر',
  document_unconverted: 'سند ارزی بی نرخ که در بخش ۱ نیامده',
  treasury: VAT_LEDGER_SOURCE_LABELS.treasury,
  other: VAT_LEDGER_SOURCE_LABELS.other,
};

export const VAT_VOUCHER_STATUS_LABELS: Record<string, string> = { draft: 'پیش‌نویس', approved: 'تأییدشده', permanent: 'دائم' };

export interface VatReportParams {
  /** نخستین روز، ISO */
  from: string;
  /** آخرین روز (شامل)، ISO */
  to: string;
  list: VatListFilter;
  page: number;
  limit: number;
}

/** جمع‌های بخش ۱؛ مبلغ‌ها به ریال، مالیات و مبلغ برگشت مثبت‌اند و خالص = فروش − برگشت */
export interface VatAmounts {
  invoiceCount: number;
  salesBase: string;
  salesVat: string;
  returnCount: number;
  returnBase: string;
  returnVat: string;
  netVat: string;
}

export interface VatRateRow extends VatAmounts {
  /** درصد با رقم لاتین («10»، «0»)، یا «unknown» برای سند با مالیات و بی درصد */
  key: string;
  /** درصد؛ null یعنی نامشخص */
  percent: number | null;
}

export interface VatDocumentRow {
  id: number;
  kind: VatDocumentKind;
  refNumber: string;
  /** روز سند، ISO */
  date: string;
  party: string | null;
  currency: string;
  /** نرخ تبدیل سند ارزی؛ برای ریالی null */
  exchangeRate: string | null;
  /** مبلغ خالص اقلام و مالیات به ارز سند */
  netOwn: string;
  vatOwn: string;
  /** به ریال؛ سند ارزی بی نرخ null */
  net: string | null;
  vat: string | null;
  percent: number;
  /** مالیات درصد سند از مبلغ خالص، به ارز سند؛ فقط برای «rate_mismatch» */
  expectedVatOwn: string | null;
  warning: VatWarning | null;
}

export interface VatLedgerFigure {
  total: string;
  /** سهم سندهای پیش‌نویس */
  draft: string;
}

export interface VatLedger {
  account: { code: string; name: string };
  /** مانده بستانکار (مالیات پرداختنی) پیش از نخستین روز */
  opening: VatLedgerFigure;
  credit: VatLedgerFigure;
  debit: VatLedgerFigure;
  /** مانده بستانکار پایان آخرین روز */
  closing: VatLedgerFigure;
  bySource: Record<VatLedgerSource, { credit: string; debit: string }>;
}

export interface VatVoucherRef {
  number: number;
  status: string;
  /** ISO */
  date: string;
}

export interface VatDifferenceRow {
  key: string;
  kind: VatDifferenceKind;
  document: { id: number; kind: VatDocumentKind | null; refNumber: string; date: string } | null;
  vouchers: VatVoucherRef[];
  /** مالیات سند در بخش ۱ (برگشت منفی) */
  expected: string;
  /** بستانکار منهای بدهکار ردیف‌های همین سند یا سند حسابداری در دوره */
  ledger: string;
  /** دفتر منهای سند */
  difference: string;
}

export interface VatComparison {
  /** خالص بخش ۱ */
  documentsNet: string;
  /** بستانکار منهای بدهکار دوره در دفتر، همه منبع‌ها */
  ledgerNet: string;
  /** دفتر منهای سندها؛ جمع ستون تفاوت فهرست */
  difference: string;
  rows: VatDifferenceRow[];
  /** شمار همه ردیف‌های تفاوت؛ فهرست صفحه فقط بزرگ‌ترین‌ها را دارد */
  rowCount: number;
}

export interface VatReport {
  range: ReportRange;
  list: VatListFilter;
  rates: VatRateRow[];
  totals: VatAmounts;
  warnings: Record<VatWarning, number>;
  /** حساب مالیات در نگاشت حساب‌ها نیست ← null */
  ledger: VatLedger | null;
  comparison: VatComparison | null;
  documents: VatDocumentRow[];
  total: number;
  page: number;
  limit: number;
}

/** پیش‌فرض زبانه، همان پیش‌فرض کارساز: از آغاز فصل جاری تا امروز (ت۱۲)، همه سندها */
export function defaultVatParams(range: ReportRange): VatReportParams {
  return { from: range.from, to: range.to, list: 'all', page: 1, limit: VAT_REPORT_DEFAULT_LIMIT };
}

/** رشته پرسش نشانی گزارش؛ مقدار خالی و `false` فرستاده نمی‌شود */
export function vatReportSearch(params: Partial<VatReportParams> & { export?: boolean }): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  return query.toString();
}

/** «۱۰٪»، «۷٫۵٪» یا «نامشخص» */
export function vatRateLabel(percent: number | null): string {
  return percent === null ? 'نامشخص' : `${formatPersianNumber(percent, 2)}٪`;
}

/** «فاکتور فروش ۱۲۳» */
export function vatDocumentTitle(kind: VatDocumentKind | null, refNumber: string): string {
  return `${kind ? VAT_DOCUMENT_KIND_LABELS[kind] : 'سند'} ${toPersianDigits(refNumber)}`;
}

/** «۱۲ (پیش‌نویس)، ۱۵» */
export function vatVoucherList(vouchers: VatVoucherRef[]): string {
  return vouchers
    .map(v => `${toPersianDigits(String(v.number))}${v.status === 'draft' ? ` (${VAT_VOUCHER_STATUS_LABELS.draft})` : ''}`)
    .join('، ');
}

/** «یورو با نرخ ۵۰۰٬۰۰۰» برای سند ارزی */
export function vatCurrencyText(row: Pick<VatDocumentRow, 'currency' | 'exchangeRate'>): string {
  if (row.currency === 'IRR') return formatCurrencyLabel('IRR');
  const rate = row.exchangeRate === null ? 'بی نرخ' : `با نرخ ${formatPersianNumber(row.exchangeRate, 4)}`;
  return `${formatCurrencyLabel(row.currency)} ${rate}`;
}

/** سطرهای مشخصات گزارش برای سربرگ چاپ و برگه اکسل */
export function vatReportMeta(report: Pick<VatReport, 'range' | 'ledger'>): Array<[string, string]> {
  const meta: Array<[string, string]> = [
    ['دوره گزارش', rangeLabel(report.range)],
    ['مبلغ‌ها', 'به ریال؛ سند ارزی با نرخ خودش'],
  ];
  if (report.ledger) meta.push(['حساب دفتر کل', `${report.ledger.account.name} (${toPersianDigits(report.ledger.account.code)})`]);
  meta.push(['مالیات خرید', 'در برنامه ثبت نمی‌شود؛ این گزارش فقط مالیات فروش را دارد']);
  return meta;
}

/** نام روز سند حسابداری یا سند برای چاپ و اکسل */
export function vatDay(iso: string): string {
  return toPersianDigits(isoToJalaliDate(iso));
}
