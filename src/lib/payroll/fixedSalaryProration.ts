import { gregorianToJalali, isoToJalaliDate } from '../../utils/calendarDate.js';
import { jalaliToGregorian } from '../../utils/dateUtils.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../financialDecimal.js';

/**
 * v8.0.30 (TD-284، تصمیم مالک محصول — گزینه ب): سهم حقوق ثابت فیش برای هر ماه شمسیِ بازه جدا حساب می‌شود و ماه ناقص به
 * نسبت روزها. پیش‌تر هر فیش یک ماه کامل حقوق می‌گرفت (به ماه شمسی تاریخ شروع): فیش دوماهه یک ماه و فیش نیم‌ماهه ماه کامل.
 *
 * قاعده هر ماه (روزشمار تجمعی، تا جمع فیش‌های یک ماه دقیقاً حقوق همان ماه شود):
 *   روزهای تجمعی = کمینه(روزهای ماه، روزهای فیش‌های پیشین آن ماه + روزهای این فیش در آن ماه)
 *   سهم این فیش = گرد(حقوق ماهانه × روزهای تجمعی ÷ روزهای ماه، به ریال) − سهم فیش‌های پیشین آن ماه (کف ۰، سقف باقی‌مانده ماه)
 * این فایل بی‌وابستگی به پایگاه‌داده است و سرور (صدور فیش) و مرورگر (راهنمای فرم صدور) هر دو از آن می‌خوانند.
 */

/** سهم حقوق ثابت یک ماه شمسی در یک فیش (piecework_payrolls.fixed_salary_months) */
export interface FixedSalaryMonthShare {
  /** ماه شمسی `YYYY/MM` */
  month: string;
  /** روزهای این فیش در آن ماه */
  days: number;
  /** روزهای آن ماه شمسی (۲۹ تا ۳۱) */
  monthDays: number;
  /** سهم ریالی (رشته دهدهی، گردشده به ریال) */
  amount: string;
}

export interface PriorFixedGrant {
  month: string;
  days: number;
  amount: DecimalValue;
}

/** فیش پیشین (یا ردیف فهرست فیش‌ها) برای محاسبه سهم‌های پیشین */
export interface PayrollFixedSalarySource {
  startDate?: string | null;
  totalFixedAmount?: DecimalValue;
  fixedSalaryMonths?: FixedSalaryMonthShare[] | null;
}

const DAY_MS = 86_400_000;
const pad2 = (n: number): string => String(n).padStart(2, '0');

function isoToUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function jalaliMonthStartUtc(jy: number, jm: number): number {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, 1);
  return Date.UTC(gy, gm - 1, gd);
}

function nextJalaliMonth(jy: number, jm: number): [number, number] {
  return jm === 12 ? [jy + 1, 1] : [jy, jm + 1];
}

/** تعداد روزهای ماه شمسی `YYYY/MM` */
export function jalaliMonthDays(month: string): number {
  const jy = Number(month.slice(0, 4));
  const jm = Number(month.slice(5, 7));
  const [ny, nm] = nextJalaliMonth(jy, jm);
  return Math.round((jalaliMonthStartUtc(ny, nm) - jalaliMonthStartUtc(jy, jm)) / DAY_MS);
}

/** ماه‌های شمسی بازه [startIso, endIso] (هر دو شامل) با روزهای پوشش‌داده‌شده و روزهای ماه */
export function jalaliMonthsInPeriod(startIso: string, endIso: string): Array<{ month: string; coveredDays: number; monthDays: number }> {
  const start = isoToUtc(startIso);
  const end = isoToUtc(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  let [jy, jm] = gregorianToJalali(Number(startIso.slice(0, 4)), Number(startIso.slice(5, 7)), Number(startIso.slice(8, 10)));
  const months: Array<{ month: string; coveredDays: number; monthDays: number }> = [];
  for (;;) {
    const monthStart = jalaliMonthStartUtc(jy, jm);
    if (monthStart > end) break;
    const [ny, nm] = nextJalaliMonth(jy, jm);
    const nextStart = jalaliMonthStartUtc(ny, nm);
    const from = Math.max(start, monthStart);
    const to = Math.min(end, nextStart - DAY_MS);
    months.push({
      month: `${jy}/${pad2(jm)}`,
      coveredDays: Math.round((to - from) / DAY_MS) + 1,
      monthDays: Math.round((nextStart - monthStart) / DAY_MS),
    });
    [jy, jm] = [ny, nm];
  }
  return months;
}

/**
 * سهم‌های حقوق ثابت یک فیش پیشین. فیش پیش از v8.0.30 تفکیک ماهانه ندارد: کل حقوق ثابت آن به ماه شمسی تاریخ شروعش
 * و به‌اندازه همه روزهای آن ماه نسبت داده می‌شود (همان قاعده پیشین «یک بار در ماه»).
 */
export function priorFixedGrantsOf(payroll: PayrollFixedSalarySource): PriorFixedGrant[] {
  const months = Array.isArray(payroll.fixedSalaryMonths) ? payroll.fixedSalaryMonths : [];
  if (months.length > 0) return months.map(m => ({ month: m.month, days: Number(m.days) || 0, amount: m.amount }));
  if (!fin(payroll.totalFixedAmount ?? 0).isPositive()) return [];
  const month = isoToJalaliDate(payroll.startDate ?? '').slice(0, 7);
  if (!/^\d{4}\/\d{2}$/.test(month)) return [];
  return [{ month, days: jalaliMonthDays(month), amount: payroll.totalFixedAmount }];
}

/** سهم حقوق ثابت فیش بازه [startIso, endIso] با حقوق ماهانه داده‌شده، پس از کسر سهم فیش‌های پیشین هر ماه */
export function computeFixedSalaryShares(
  monthlySalary: DecimalValue,
  startIso: string,
  endIso: string,
  prior: PriorFixedGrant[],
): { total: FinancialDecimal; months: FixedSalaryMonthShare[] } {
  const salary = fin(monthlySalary ?? 0);
  let total = fin(0);
  const months: FixedSalaryMonthShare[] = [];
  for (const { month, coveredDays, monthDays } of jalaliMonthsInPeriod(startIso, endIso)) {
    const earlier = prior.filter(p => p.month === month);
    const earlierDays = earlier.reduce((sum, p) => sum + (Number(p.days) || 0), 0);
    const earlierAmount = earlier.reduce((sum, p) => sum.add(p.amount ?? 0), fin(0));
    const cumulativeDays = Math.min(monthDays, earlierDays + coveredDays);
    const target = salary.multiply(cumulativeDays).divide(monthDays, 10).round(0);
    let share = target.subtract(earlierAmount);
    const remaining = salary.subtract(earlierAmount);
    if (share.greaterThan(remaining)) share = remaining;
    if (share.isNegative()) share = fin(0);
    share = share.round(0);
    months.push({ month, days: coveredDays, monthDays, amount: share.toString() });
    total = total.add(share);
  }
  return { total, months };
}

/** یادداشت فیش: تفکیک ماهانه حقوق ثابت، فقط وقتی سهم ماهی با حقوق کامل یک ماه برابر نیست (ماه ناقص یا کسر فیش پیشین) */
export function describeFixedSalaryShares(months: FixedSalaryMonthShare[], monthlySalary: DecimalValue): string {
  const salary = fin(monthlySalary ?? 0);
  if (months.every(m => fin(m.amount).equals(salary))) return '';
  const fa = (n: DecimalValue) => fin(n).toNumber().toLocaleString('fa-IR');
  return `حقوق ثابت به تفکیک ماه شمسی: ${months.map(m => `${m.month} — ${fa(m.days)} از ${fa(m.monthDays)} روز: ${fa(m.amount)} ریال`).join('؛ ')}`;
}
