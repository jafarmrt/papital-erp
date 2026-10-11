import { toPersianDigits } from '../../utils/persianNumber.js';
import { EIDI_METHOD_LABELS, type EidiMethod } from './eidi.js';

/**
 * v10.0.212 (TD-1089، طرح حقوق §۳.۸): قرارداد گزارش «عیدی سال»، مشترک سرور (`GET /piecework/reports/eidi`) و پنجره گزارش با
 * خروجی اکسل. «حق عیدی» در روش درصدی سهم انباشته فیش‌های تأییدشده و در دو روش دیگر حق سال به نسبت روزهای همکاری است؛
 * «مانده» حق عیدی منهای آنچه فیش‌های عیدی از آن پرداخته‌اند.
 */

export interface EidiReportRow {
  personnelId: number;
  fullName: string;
  personnelCode: string;
  /** حق عیدی تا امروز (ریال) */
  due: string;
  /** سهم فیش‌های پیش‌نویس که هنوز شمرده نمی‌شود */
  draftShares: string;
  /** سقف سال (فقط روش درصدی) */
  cap: string | null;
  /** جمع فیش‌های عیدی صادرشده */
  issued: string;
  /** پرداخت‌شده فیش‌های عیدی */
  paid: string;
  remaining: string;
}

export interface EidiReport {
  jalaliYear: number;
  method: EidiMethod | null;
  rows: EidiReportRow[];
  totals: { due: string; issued: string; paid: string; remaining: string };
}

export const EIDI_REPORT_COLUMNS = ['نام پرسنل', 'کد پرسنلی', 'حق عیدی (ریال)', 'سهم فیش‌های پیش‌نویس (ریال)', 'سقف سال (ریال)', 'فیش عیدی صادرشده (ریال)', 'پرداخت‌شده (ریال)', 'مانده (ریال)'] as const;

export const eidiMethodLabel = (m: EidiMethod | null) => (m ? EIDI_METHOD_LABELS[m] : 'ثبت نشده');

/** ردیف‌های اکسل: هر پرسنل یک ردیف و ردیف جمع؛ مبلغ‌ها عدد (ریال) */
export function eidiReportSheetRows(report: EidiReport): Array<Record<string, string | number>> {
  const c = EIDI_REPORT_COLUMNS;
  const row = (r: EidiReportRow) => ({
    [c[0]]: r.fullName, [c[1]]: r.personnelCode, [c[2]]: Number(r.due), [c[3]]: Number(r.draftShares),
    [c[4]]: r.cap === null ? '' : Number(r.cap), [c[5]]: Number(r.issued), [c[6]]: Number(r.paid), [c[7]]: Number(r.remaining),
  });
  return [
    ...report.rows.map(row),
    { [c[0]]: 'جمع', [c[1]]: '', [c[2]]: Number(report.totals.due), [c[3]]: '', [c[4]]: '', [c[5]]: Number(report.totals.issued), [c[6]]: Number(report.totals.paid), [c[7]]: Number(report.totals.remaining) },
  ];
}

/** «عیدی-سال-۱۴۰۵.xlsx» */
export function eidiReportFileName(jalaliYear: number): string {
  return `عیدی-سال-${toPersianDigits(String(jalaliYear))}.xlsx`;
}
