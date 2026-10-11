import { fin, type DecimalValue, type FinancialDecimal } from '../financialDecimal.js';
import { isoToJalaliDate } from '../../utils/calendarDate.js';
import { jalaliMonthsInPeriod } from './fixedSalaryProration.js';

/**
 * v10.0.210 (TD-1087، OBS-R2-49، طرح حقوق §۳.۳، تصمیم‌های ت۴ تا ت۶ الف): کسورات قانونی فیش حقوق (بیمه سهم کارگر، بیمه سهم
 * کارفرما و مالیات حقوق) از نرخ‌های هر سال جلالی که حسابدار وارد می‌کند. کد هیچ نرخ پیش‌فرضی ندارد؛ سال بی نرخ یعنی فیش
 * کسورات قانونی را حساب نمی‌کند. مبلغ پیشنهادی را سرور حساب می‌کند و فرم صدور فیش نشان می‌دهد؛ مبلغ دیگری فقط با شرح
 * پذیرفته می‌شود. این فایل بی‌وابستگی به پایگاه‌داده است و سرور، فرم نرخ‌ها و فرم فیش هر دو از آن می‌خوانند.
 *
 * قاعده‌ها (ماهانه؛ فیش بیش یا کم از یک ماه به نسبت روزهای هر ماه جلالی دوره، `periodMonthFraction`):
 *   پایه بیمه = کمینه(ناخالص فیش، سقف ماهانه × کسر ماه)؛ سقف صفر یعنی بی سقف
 *   بیمه سهم کارگر = گرد(پایه بیمه × درصد کارگر ÷ ۱۰۰)، بیمه سهم کارفرما همین با درصد کارفرما (به ریال)
 *   پایه مالیات = ناخالص − (بیمه سهم کارگر اگر گزینه «از پایه مالیات کم شود» روشن باشد)
 *   مالیات = گرد(جمع هر پله: نرخ × (کمینه(پایه، تا × کسر ماه) − از × کسر ماه) برای بخش مثبت)
 */

export interface TaxBracket {
  /** آغاز پله ماهانه (ریال) */
  from: string;
  /** پایان پله ماهانه (ریال)؛ تهی یعنی بی‌پایان (فقط پله آخر) */
  to: string | null;
  /** نرخ پله به درصد */
  rate: string;
}

export interface StatutoryRates {
  jalaliYear: number;
  employeeInsurancePercent: DecimalValue;
  employerInsurancePercent: DecimalValue;
  /** سقف ماهانه دستمزد مشمول بیمه (ریال)؛ صفر یعنی بی سقف */
  insuranceWageCap: DecimalValue;
  taxBrackets: TaxBracket[];
  /** سهم بیمه کارگر از پایه مالیات کم شود */
  deductInsuranceFromTax: boolean;
}

export interface StatutoryCoverage {
  /** «مشمول بیمه» در پرونده پرسنل */
  insurance: boolean;
  /** «مشمول مالیات حقوق» در پرونده پرسنل */
  tax: boolean;
}

export interface StatutoryAmounts {
  employeeInsurance: string;
  employerInsurance: string;
  incomeTax: string;
}

export interface StatutorySuggestion extends StatutoryAmounts {
  insuranceBase: string;
  taxBase: string;
  monthFraction: string;
}

export const STATUTORY_OVERRIDE_REASON_MAX = 500;
export const STATUTORY_PERCENT_MAX = 100;

/** سال جلالی دوره فیش: سال تاریخ پایان دوره (`YYYY-MM-DD`) */
export function payrollStatutoryYear(endIso: string): number | null {
  const jalali = isoToJalaliDate(endIso);
  const year = Number(String(jalali).slice(0, 4));
  return Number.isInteger(year) && year > 1300 ? year : null;
}

/** چند ماه جلالی دوره فیش است: جمع (روزهای دوره در هر ماه ÷ روزهای آن ماه) */
export function periodMonthFraction(startIso: string, endIso: string): FinancialDecimal {
  return jalaliMonthsInPeriod(startIso, endIso)
    .reduce((sum, m) => sum.add(fin(m.coveredDays).divide(m.monthDays, 10)), fin(0));
}

const ZERO_AMOUNTS: StatutoryAmounts = { employeeInsurance: '0', employerInsurance: '0', incomeTax: '0' };

/** مالیات پله‌ای پایه با پله‌های ماهانه ضرب در کسر ماه (پیش از گرد کردن) */
function bracketTax(base: FinancialDecimal, brackets: TaxBracket[], fraction: FinancialDecimal): FinancialDecimal {
  let tax = fin(0);
  for (const b of brackets) {
    const from = fin(b.from).multiply(fraction);
    const to = b.to === null || String(b.to).trim() === '' ? null : fin(b.to).multiply(fraction);
    const top = to === null || base.lessThan(to) ? base : to;
    if (top.greaterThan(from)) tax = tax.add(top.subtract(from).multiply(fin(b.rate)).divide(100, 10));
  }
  return tax;
}

/** مالیات پله‌ای یک ماه کامل، گرد به ریال (مالیات مازاد عیدی بر سقف معافیت، TD-1089) */
export function monthlyBracketTax(base: DecimalValue, brackets: TaxBracket[]): FinancialDecimal {
  const b = fin(base ?? 0);
  return b.isPositive() ? bracketTax(b, brackets, fin(1)).round(0) : fin(0);
}

/**
 * کسورات قانونی پیشنهادی فیشی با ناخالص `gross` در دوره [startIso, endIso]. پرسنلی که مشمول بیمه یا مالیات نیست برای همان
 * بخش صفر می‌گیرد؛ بی نرخ (`rates` تهی) همه صفرند.
 */
export function suggestStatutoryDeductions(input: {
  gross: DecimalValue;
  startIso: string;
  endIso: string;
  rates: StatutoryRates | null;
  coverage: StatutoryCoverage;
}): StatutorySuggestion {
  const fraction = periodMonthFraction(input.startIso, input.endIso);
  const gross = fin(input.gross).isPositive() ? fin(input.gross) : fin(0);
  const base = { insuranceBase: '0', taxBase: '0', monthFraction: fraction.round(6).toString() };
  if (!input.rates) return { ...ZERO_AMOUNTS, ...base };
  const rates = input.rates;
  const cap = fin(rates.insuranceWageCap ?? 0);
  const capped = cap.isPositive() ? cap.multiply(fraction) : null;
  const insuranceBase = input.coverage.insurance ? (capped && gross.greaterThan(capped) ? capped : gross) : fin(0);
  const employeeInsurance = insuranceBase.multiply(fin(rates.employeeInsurancePercent)).divide(100, 10).round(0);
  const employerInsurance = insuranceBase.multiply(fin(rates.employerInsurancePercent)).divide(100, 10).round(0);
  const taxBaseRaw = input.coverage.tax
    ? gross.subtract(rates.deductInsuranceFromTax ? employeeInsurance : 0)
    : fin(0);
  const taxBase = taxBaseRaw.isPositive() ? taxBaseRaw : fin(0);
  const incomeTax = input.coverage.tax ? bracketTax(taxBase, rates.taxBrackets, fraction).round(0) : fin(0);
  return {
    employeeInsurance: employeeInsurance.toString(),
    employerInsurance: employerInsurance.toString(),
    incomeTax: incomeTax.toString(),
    insuranceBase: insuranceBase.round(0).toString(),
    taxBase: taxBase.round(0).toString(),
    monthFraction: base.monthFraction,
  };
}

/** مبلغ واردشده با مبلغ پیشنهادی فرق دارد؟ (هر سه کادر؛ اختلاف کمتر از یک ریال یکی است) */
export function statutoryOverridden(entered: StatutoryAmounts, suggested: StatutoryAmounts): boolean {
  return (['employeeInsurance', 'employerInsurance', 'incomeTax'] as const)
    .some(k => fin(entered[k]).subtract(fin(suggested[k])).abs().greaterThanOrEqual(1));
}

/** خطای فارسی نرخ‌های یک سال، یا تهی (مشترک فرم نرخ‌ها و سرور) */
export function statutoryRatesError(rates: StatutoryRates): string | null {
  if (!Number.isInteger(rates.jalaliYear) || rates.jalaliYear < 1390 || rates.jalaliYear > 1500) return 'سال جلالی نرخ‌ها معتبر نیست.';
  const percent = (v: DecimalValue) => { const d = fin(v); return !d.isNegative() && d.lessThanOrEqual(STATUTORY_PERCENT_MAX); };
  if (!percent(rates.employeeInsurancePercent)) return 'درصد بیمه سهم کارگر باید از ۰ تا ۱۰۰ باشد.';
  if (!percent(rates.employerInsurancePercent)) return 'درصد بیمه سهم کارفرما باید از ۰ تا ۱۰۰ باشد.';
  if (fin(rates.insuranceWageCap ?? 0).isNegative()) return 'سقف دستمزد مشمول بیمه نمی‌تواند منفی باشد.';
  let previousTo: FinancialDecimal | null = fin(0);
  for (const [i, b] of rates.taxBrackets.entries()) {
    const n = i + 1;
    const last = i === rates.taxBrackets.length - 1;
    if (!percent(b.rate)) return `نرخ پله ${n} مالیات باید از ۰ تا ۱۰۰ باشد.`;
    if (previousTo === null || !fin(b.from).equals(previousTo)) return `پله ${n} مالیات باید از پایان پله پیش از خود (یا صفر) آغاز شود.`;
    const open = b.to === null || String(b.to).trim() === '';
    if (open && !last) return `فقط پله آخر مالیات می‌تواند بی‌پایان باشد.`;
    if (!open && !fin(b.to).greaterThan(fin(b.from))) return `پایان پله ${n} مالیات باید از آغازش بیشتر باشد.`;
    previousTo = open ? null : fin(b.to);
  }
  return null;
}
