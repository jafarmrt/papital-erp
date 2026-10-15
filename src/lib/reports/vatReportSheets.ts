import { reportFileName, type ReportCell, type ReportSheet } from './reportExport.js';
import {
  VAT_DIFFERENCE_KIND_LABELS, VAT_DOCUMENT_KIND_LABELS, VAT_LEDGER_SOURCES, VAT_LEDGER_SOURCE_LABELS, VAT_REPORT_TITLE,
  VAT_WARNINGS, VAT_WARNING_LABELS, vatCurrencyText, vatDay, vatDocumentTitle, vatRateLabel, vatReportMeta, vatVoucherList,
  type VatAmounts, type VatReport,
} from './vatReport.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v10.1.11 (D-03، طرح گزارش‌های مدیریتی §۴): برگه‌های خروجی اکسل «مالیات بر ارزش افزوده»: خلاصه به تفکیک درصد با
 * هشدارها، دفتر کل حساب مالیات با هم‌خوانی، فهرست تفاوت‌ها و فهرست سندها. مبلغ‌ها عدد ریالی‌اند تا جمع‌پذیر باشند.
 */

const cell = (value: string | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

const AMOUNT_COLUMNS = [
  'شمار فاکتور', 'مبلغ خالص فروش (ریال)', 'مالیات فروش (ریال)',
  'شمار برگشت', 'مبلغ خالص برگشت (ریال)', 'مالیات برگشت (ریال)', 'خالص مالیات (ریال)',
];

const amountCells = (a: VatAmounts): ReportCell[] => [
  a.invoiceCount, cell(a.salesBase), cell(a.salesVat), a.returnCount, cell(a.returnBase), cell(a.returnVat), cell(a.netVat),
];

function ratesSheet(report: VatReport): ReportSheet {
  const warnings: ReportCell[][] = VAT_WARNINGS
    .filter(w => report.warnings[w] > 0)
    .map(w => [`هشدار: ${VAT_WARNING_LABELS[w]}`, report.warnings[w]]);
  return {
    name: 'به تفکیک درصد',
    title: `${VAT_REPORT_TITLE}: بخش ۱، از سندها`,
    meta: vatReportMeta(report),
    columns: ['درصد مالیات', ...AMOUNT_COLUMNS],
    rows: report.rates.map(r => [vatRateLabel(r.percent), ...amountCells(r)]),
    totals: ['جمع', ...amountCells(report.totals)],
    footer: warnings.length > 0 ? [[], ...warnings] : undefined,
  };
}

function ledgerSheet(report: VatReport): ReportSheet | null {
  const { ledger, comparison } = report;
  if (!ledger) return null;
  const rows: ReportCell[][] = [
    ['مانده اول دوره (بستانکار)', cell(ledger.opening.total), cell(ledger.opening.draft)],
    ['بستانکار دوره', cell(ledger.credit.total), cell(ledger.credit.draft)],
    ['بدهکار دوره', cell(ledger.debit.total), cell(ledger.debit.draft)],
    ['مانده پایان دوره (بستانکار)', cell(ledger.closing.total), cell(ledger.closing.draft)],
    [],
    ...VAT_LEDGER_SOURCES.flatMap(s => [
      [`بستانکار از ${VAT_LEDGER_SOURCE_LABELS[s]}`, cell(ledger.bySource[s].credit), null],
      [`بدهکار از ${VAT_LEDGER_SOURCE_LABELS[s]}`, cell(ledger.bySource[s].debit), null],
    ] as ReportCell[][]),
  ];
  if (comparison) {
    rows.push(
      [],
      ['خالص مالیات بخش ۱ (از سندها)', cell(comparison.documentsNet), null],
      ['گردش خالص دفتر در دوره', cell(comparison.ledgerNet), null],
      ['تفاوت (دفتر منهای سندها)', cell(comparison.difference), null],
    );
  }
  return {
    name: 'دفتر کل',
    title: `${VAT_REPORT_TITLE}: بخش ۲، از دفتر کل`,
    meta: vatReportMeta(report),
    columns: ['شرح', 'مبلغ (ریال)', 'از سندهای پیش‌نویس (ریال)'],
    rows,
  };
}

function differencesSheet(report: VatReport): ReportSheet | null {
  const { comparison } = report;
  if (!comparison) return null;
  return {
    name: 'تفاوت‌ها',
    title: `${VAT_REPORT_TITLE}: سندهای سازنده تفاوت`,
    meta: vatReportMeta(report),
    columns: ['علت', 'سند', 'تاریخ سند', 'سند حسابداری', 'مالیات سند (ریال)', 'دفتر (ریال)', 'تفاوت (ریال)'],
    rows: comparison.rows.map(r => [
      VAT_DIFFERENCE_KIND_LABELS[r.kind],
      r.document ? vatDocumentTitle(r.document.kind, r.document.refNumber) : '',
      r.document ? vatDay(r.document.date) : '',
      vatVoucherList(r.vouchers),
      cell(r.expected),
      cell(r.ledger),
      cell(r.difference),
    ]),
    totals: [`جمع (${toPersianDigits(String(comparison.rowCount))} ردیف)`, '', '', '', null, null, cell(comparison.difference)],
  };
}

function documentsSheet(report: VatReport): ReportSheet {
  return {
    name: 'فهرست سندها',
    title: `${VAT_REPORT_TITLE}: فهرست سندها`,
    meta: vatReportMeta(report),
    columns: ['نوع', 'شماره', 'تاریخ', 'مشتری', 'ارز', 'مبلغ خالص (ریال)', 'درصد مالیات', 'مالیات (ریال)', 'هشدار'],
    rows: report.documents.map(d => [
      VAT_DOCUMENT_KIND_LABELS[d.kind],
      toPersianDigits(d.refNumber),
      vatDay(d.date),
      d.party ?? '',
      vatCurrencyText(d),
      cell(d.net),
      vatRateLabel(d.percent),
      cell(d.vat),
      d.warning ? VAT_WARNING_LABELS[d.warning] : '',
    ]),
  };
}

/** برگه‌های خروجی؛ گزارش باید با همه سندها (`export=true`) خوانده شده باشد */
export function vatReportSheets(report: VatReport): ReportSheet[] {
  return [ratesSheet(report), ledgerSheet(report), differencesSheet(report), documentsSheet(report)]
    .filter((s): s is ReportSheet => s !== null);
}

/** «مالیات-بر-ارزش-افزوده-۱۴۰۵-پاییز.xlsx» */
export function vatReportFileName(report: Pick<VatReport, 'range'>): string {
  return reportFileName(VAT_REPORT_TITLE, report.range);
}
