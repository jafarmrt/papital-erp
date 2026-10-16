import { sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../lib/financialDecimal.js';
import { daysInclusive, eidiEntitlement, isEidiCovered } from '../../lib/payroll/eidi.js';
import type { EidiReport, EidiReportRow } from '../../lib/payroll/eidiReport.js';
import { serviceEndOf, serviceStartOf } from '../../lib/payroll/payrollPeriod.js';
import { jalaliYearBounds } from '../../utils/calendarDate.js';
import { eidiRatesOf, eidiRatesOfYear } from './payrollEidi.js';

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸): گزارش «عیدی سال». جمع فیش‌های هر پرسنل در SQL است (§1.8)؛ در روش‌های «قانون کار» و
 * «مبلغ ثابت» پرسنلی هم که همکاری‌اش با سال هم‌پوشانی دارد ولی فیشی ندارد آمده است.
 * v10.1.32 (TD-1282، تصمیم ت۳۴ الف): پرسنلی که «مشمول عیدی» نیست حق سال ندارد؛ بی فیش عیدی در گزارش نمی‌آید و با فیش عیدی
 * مانده‌ای ندارد.
 */
export async function payrollEidiReport(jalaliYear: number): Promise<EidiReport> {
  const bounds = Number.isInteger(jalaliYear) ? jalaliYearBounds(jalaliYear) : null;
  if (!bounds || jalaliYear < 1390 || jalaliYear > 1500) throw new ValidationError('سال جلالی گزارش معتبر نیست.', undefined, 'PAYROLL_REPORT_YEAR_INVALID');
  const rates = await eidiRatesOfYear(jalaliYear, orm);
  const accrues = !rates || rates.method === 'percent_of_work';
  const res = await orm.execute(sql`
    WITH sums AS (
      SELECT p.personnel_id,
             COALESCE(SUM(CASE WHEN p.is_eidi = 0 AND p.status <> 'draft' THEN p.eidi_amount END), 0)::text AS accrued,
             COALESCE(SUM(CASE WHEN p.is_eidi = 0 AND p.status = 'draft' THEN p.eidi_amount END), 0)::text AS draft_shares,
             COALESCE(SUM(CASE WHEN p.is_eidi = 1 THEN p.eidi_amount END), 0)::text AS issued,
             COALESCE(SUM(CASE WHEN p.is_eidi = 1 THEN p.eidi_from_accrual END), 0)::text AS issued_from_accrual,
             COALESCE(SUM(CASE WHEN p.is_eidi = 1 THEN p.paid_amount END), 0)::text AS paid
        FROM piecework_payrolls p
       WHERE p.is_deleted = 0 AND p.eidi_year = ${jalaliYear}
       GROUP BY p.personnel_id
    )
    SELECT pe.id, pe.full_name, COALESCE(pe.personnel_code, '') AS personnel_code, pe.start_date, pe.end_date, pe.employment_status,
           COALESCE(pe.monthly_salary, 0)::text AS monthly_salary, pe.is_eidi_covered,
           s.accrued, s.draft_shares, s.issued, s.issued_from_accrual, s.paid
      FROM personnel pe
      LEFT JOIN sums s ON s.personnel_id = pe.id
     WHERE s.personnel_id IS NOT NULL
        OR (${accrues ? sql`false` : sql`true`} AND pe.is_deleted = 0 AND pe.is_eidi_covered = 1)
     ORDER BY pe.full_name, pe.id`);
  const yearDays = daysInclusive(bounds.firstDay, bounds.lastDay);
  const rows: EidiReportRow[] = [];
  const total = { due: fin(0), issued: fin(0), paid: fin(0), remaining: fin(0) };
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const t = (k: string) => fin(String(r[k] ?? '0'));
    let due: FinancialDecimal = t('accrued');
    let settled = t('issued_from_accrual');
    if (rates && !accrues && !isEidiCovered({ isEidiCovered: Number(r.is_eidi_covered) })) {
      due = t('issued');
      settled = t('issued');
    } else if (rates && !accrues) {
      const start = serviceStartOf({ startDate: r.start_date as string | null });
      const end = serviceEndOf({ employmentStatus: r.employment_status as string | null, endDate: r.end_date as string | null });
      const from = start && start > bounds.firstDay ? start : bounds.firstDay;
      const to = end.kind === 'ended' && end.endIso < bounds.lastDay ? end.endIso : bounds.lastDay;
      const worked = daysInclusive(from, to);
      if (worked === 0 && t('issued').isZero()) continue;
      due = eidiEntitlement({ rates: eidiRatesOf(rates), monthlySalary: String(r.monthly_salary ?? '0'), workedDays: worked, yearDays }) ?? fin(0);
      settled = t('issued');
    }
    const left = due.subtract(settled);
    const remaining = left.isPositive() ? left : fin(0);
    rows.push({
      personnelId: Number(r.id),
      fullName: String(r.full_name ?? ''),
      personnelCode: String(r.personnel_code ?? ''),
      due: due.toString(),
      draftShares: t('draft_shares').toString(),
      cap: rates && accrues ? fin(rates.yearlyCap).toString() : null,
      issued: t('issued').toString(),
      paid: t('paid').toString(),
      remaining: remaining.toString(),
    });
    total.due = total.due.add(due);
    total.issued = total.issued.add(t('issued'));
    total.paid = total.paid.add(t('paid'));
    total.remaining = total.remaining.add(remaining);
  }
  return {
    jalaliYear,
    method: rates?.method ?? null,
    rows,
    totals: { due: total.due.toString(), issued: total.issued.toString(), paid: total.paid.toString(), remaining: total.remaining.toString() },
  };
}
