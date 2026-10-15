import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v10.0.211 (TD-1088، طرح حقوق §۳.۳ بند ۶، تصمیم ت۷ الف): قرارداد «فهرست بیمه و مالیات» ماهانه، مشترک سرور
 * (`GET /piecework/reports/statutory`) و پنجره گزارش با خروجی اکسل. از v10.1.19 (TD-1269) فقط پرسنل دارای بیمه یا مالیات
 * حقوق در آن ماه در فهرست است.
 */

export interface StatutoryReportRow {
  personnelId: number;
  fullName: string;
  personnelCode: string;
  nationalId: string;
  payslips: number;
  gross: string;
  employeeInsurance: string;
  employerInsurance: string;
  incomeTax: string;
}

export interface StatutoryReport {
  jalaliYear: number;
  jalaliMonth: number;
  from: string;
  to: string;
  rows: StatutoryReportRow[];
  totals: { gross: string; employeeInsurance: string; employerInsurance: string; incomeTax: string };
  draftPayslips: number;
  /**
   * v10.1.19 (TD-1269): پرسنلی که فیش تأییدشده این ماه را دارد ولی بیمه و مالیات حقوق ندارد (مشمول نیست یا مبلغش صفر شده)؛
   * در فهرست و اکسل نمی‌آید و فقط شمرده می‌شود
   */
  withoutStatutory: { personnel: number; payslips: number };
}

/** «۲ نفر با ۳ فیش …» یا تهی */
export function statutoryReportWithoutNote(report: Pick<StatutoryReport, 'withoutStatutory'>): string | null {
  const w = report.withoutStatutory;
  if (!w || w.personnel <= 0) return null;
  return `${toPersianDigits(String(w.personnel))} نفر با ${toPersianDigits(String(w.payslips))} فیش تأییدشده در این ماه بیمه و مالیات حقوق ندارند و در این فهرست و خروجی اکسل نیامده‌اند.`;
}

export const STATUTORY_REPORT_COLUMNS = ['نام پرسنل', 'کد پرسنلی', 'کد ملی', 'تعداد فیش', 'حقوق و مزایا (ریال)', 'بیمه سهم کارگر (ریال)', 'بیمه سهم کارفرما (ریال)', 'مالیات حقوق (ریال)'] as const;

/** ردیف‌های اکسل: هر پرسنل یک ردیف و ردیف جمع در پایان؛ مبلغ‌ها عدد (ریال) تا در اکسل جمع‌پذیر باشند */
export function statutoryReportSheetRows(report: StatutoryReport): Array<Record<string, string | number>> {
  const row = (r: StatutoryReportRow) => ({
    [STATUTORY_REPORT_COLUMNS[0]]: r.fullName,
    [STATUTORY_REPORT_COLUMNS[1]]: r.personnelCode,
    [STATUTORY_REPORT_COLUMNS[2]]: r.nationalId,
    [STATUTORY_REPORT_COLUMNS[3]]: r.payslips,
    [STATUTORY_REPORT_COLUMNS[4]]: Number(r.gross),
    [STATUTORY_REPORT_COLUMNS[5]]: Number(r.employeeInsurance),
    [STATUTORY_REPORT_COLUMNS[6]]: Number(r.employerInsurance),
    [STATUTORY_REPORT_COLUMNS[7]]: Number(r.incomeTax),
  });
  return [
    ...report.rows.map(row),
    {
      [STATUTORY_REPORT_COLUMNS[0]]: 'جمع',
      [STATUTORY_REPORT_COLUMNS[1]]: '',
      [STATUTORY_REPORT_COLUMNS[2]]: '',
      [STATUTORY_REPORT_COLUMNS[3]]: report.rows.reduce((n, r) => n + r.payslips, 0),
      [STATUTORY_REPORT_COLUMNS[4]]: Number(report.totals.gross),
      [STATUTORY_REPORT_COLUMNS[5]]: Number(report.totals.employeeInsurance),
      [STATUTORY_REPORT_COLUMNS[6]]: Number(report.totals.employerInsurance),
      [STATUTORY_REPORT_COLUMNS[7]]: Number(report.totals.incomeTax),
    },
  ];
}

/** «فهرست-بیمه-و-مالیات-۱۴۰۵-۰۷.xlsx» */
export function statutoryReportFileName(jalaliYear: number, jalaliMonth: number): string {
  return `فهرست-بیمه-و-مالیات-${toPersianDigits(String(jalaliYear))}-${toPersianDigits(String(jalaliMonth).padStart(2, '0'))}.xlsx`;
}
