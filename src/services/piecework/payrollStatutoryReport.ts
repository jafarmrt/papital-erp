import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import type { StatutoryReport, StatutoryReportRow } from '../../lib/payroll/statutoryReport.js';
import { jalaliMonthLength } from '../../utils/calendarDate.js';
import { jalaliToGregorian } from '../../utils/dateUtils.js';

/**
 * v10.0.211 (TD-1088، طرح حقوق §۳.۳ بند ۶، تصمیم ت۷ الف): «فهرست بیمه و مالیات» یک ماه جلالی، برای پر کردن لیست بیمه و
 * فهرست مالیات: جمع هر پرسنل روی فیش‌های زنده تأییدشده یا پرداخت‌شده‌ای که پایان دوره‌شان در آن ماه است. فیش پیش‌نویس
 * شمرده نمی‌شود و فقط تعدادش گزارش می‌شود. جمع‌ها در SQL است (§1.8).
 *
 * v10.1.16 (TD-1269، قاعده مالک محصول: بیمه و مالیات اختیاری است): فقط پرسنلی که در فیش‌های آن ماه بیمه یا مالیات حقوق
 * دارند در فهرست و خروجی اکسل می‌آیند؛ پرسنل بی بیمه و مالیات (مشمول نیست یا مبلغش صفر شده) فقط شمرده می‌شود تا حقوق او
 * به لیست بیمه نرود.
 */

/** بیمه سهم کارگر و کارفرما و مالیات حقوق یک فیش */
const STATUTORY_SUM = sql.raw('COALESCE(p.employee_insurance, 0) + COALESCE(p.employer_insurance, 0) + COALESCE(p.income_tax, 0)');

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = ([y, m, d]: [number, number, number]) => `${y}-${pad(m)}-${pad(d)}`;

export async function payrollStatutoryReport(jalaliYear: number, jalaliMonth: number): Promise<StatutoryReport> {
  if (!Number.isInteger(jalaliYear) || jalaliYear < 1390 || jalaliYear > 1500 || !Number.isInteger(jalaliMonth) || jalaliMonth < 1 || jalaliMonth > 12) {
    throw new ValidationError('سال و ماه جلالی گزارش معتبر نیست.', undefined, 'PAYROLL_REPORT_MONTH_INVALID');
  }
  const from = isoOf(jalaliToGregorian(jalaliYear, jalaliMonth, 1));
  const to = isoOf(jalaliToGregorian(jalaliYear, jalaliMonth, jalaliMonthLength(jalaliYear, jalaliMonth)));
  const res = await orm.execute(sql`
    SELECT pe.id AS personnel_id, pe.full_name, COALESCE(pe.personnel_code, '') AS personnel_code, COALESCE(pe.national_id, '') AS national_id,
           COUNT(*)::int AS payslips,
           SUM(COALESCE(p.total_piecework_amount, 0) + COALESCE(p.total_fixed_amount, 0) + COALESCE(p.total_bonuses, 0))::text AS gross,
           SUM(p.employee_insurance)::text AS employee_insurance,
           SUM(p.employer_insurance)::text AS employer_insurance,
           SUM(p.income_tax)::text AS income_tax
      FROM piecework_payrolls p
      JOIN personnel pe ON pe.id = p.personnel_id
     WHERE p.is_deleted = 0 AND p.is_eidi = 0 AND p.status IN ('approved', 'partially_paid', 'paid')
       AND p.end_date >= ${from} AND p.end_date <= ${to}
     GROUP BY pe.id, pe.full_name, pe.personnel_code, pe.national_id
    HAVING SUM(${STATUTORY_SUM}) > 0
     ORDER BY pe.full_name, pe.id`);
  const rows: StatutoryReportRow[] = (res.rows as Array<Record<string, unknown>>).map(r => ({
    personnelId: Number(r.personnel_id),
    fullName: String(r.full_name ?? ''),
    personnelCode: String(r.personnel_code ?? ''),
    nationalId: String(r.national_id ?? ''),
    payslips: Number(r.payslips ?? 0),
    gross: fin(String(r.gross ?? '0')).toString(),
    employeeInsurance: fin(String(r.employee_insurance ?? '0')).toString(),
    employerInsurance: fin(String(r.employer_insurance ?? '0')).toString(),
    incomeTax: fin(String(r.income_tax ?? '0')).toString(),
  }));
  const without = await orm.execute(sql`
    SELECT COUNT(*)::int AS personnel, COALESCE(SUM(w.payslips), 0)::int AS payslips
      FROM (SELECT p.personnel_id, COUNT(*) AS payslips
              FROM piecework_payrolls p
             WHERE p.is_deleted = 0 AND p.is_eidi = 0 AND p.status IN ('approved', 'partially_paid', 'paid')
               AND p.end_date >= ${from} AND p.end_date <= ${to}
             GROUP BY p.personnel_id
            HAVING SUM(${STATUTORY_SUM}) = 0) w`);
  const withoutRow = (without.rows as Array<{ personnel?: unknown; payslips?: unknown }>)[0];
  const drafts = await orm.execute(sql`
    SELECT COUNT(*)::int AS n FROM piecework_payrolls p
     WHERE p.is_deleted = 0 AND p.is_eidi = 0 AND p.status = 'draft' AND p.end_date >= ${from} AND p.end_date <= ${to}`);
  const sum = (key: 'gross' | 'employeeInsurance' | 'employerInsurance' | 'incomeTax') => rows.reduce((t, r) => t.add(r[key]), fin(0)).toString();
  return {
    jalaliYear,
    jalaliMonth,
    from,
    to,
    rows,
    totals: { gross: sum('gross'), employeeInsurance: sum('employeeInsurance'), employerInsurance: sum('employerInsurance'), incomeTax: sum('incomeTax') },
    draftPayslips: Number((drafts.rows as Array<{ n?: unknown }>)[0]?.n ?? 0),
    withoutStatutory: { personnel: Number(withoutRow?.personnel ?? 0), payslips: Number(withoutRow?.payslips ?? 0) },
  };
}
