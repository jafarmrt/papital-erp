import { fin, type DecimalValue, type FinancialDecimal } from '../financialDecimal.js';

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸، تصمیم‌های ت۱۴ تا ت۱۶ الف): عیدی و پاداش سالانه. روش و نرخ هر سال جلالی را دارنده
 * «نرخ‌های بیمه و مالیات حقوق» در تنظیمات وارد می‌کند؛ کد هیچ نرخ یا سقفی ندارد. این فایل بی‌وابستگی به پایگاه‌داده است و
 * سرور، فرم نرخ‌ها، فرم فیش عیدی و گزارش «عیدی سال» همه از آن می‌خوانند.
 *
 * روش‌ها:
 *   «درصدی از کارکرد تا سقف سال» (`percent_of_work`): هر فیش عادی سهمی برابر گرد(پایه × درصد ÷ ۱۰۰) می‌گیرد، تا جایی که جمع
 *     سهم فیش‌های زنده آن پرسنل در آن سال از سقف سال بیشتر نشود. پایه = کارکرد + حقوق ثابت فیش، بی پاداش و کسورات (ت۱۴).
 *     سهم با صدور فیش در خود فیش ذخیره و در سند آن «هزینه عیدی» به «عیدی پرداختنی» ثبت می‌شود (ت۱۵)؛ حذف فیش آزادش می‌کند.
 *   «قانون کار» (`labor_law`): کمینه(روزهای عیدی × مزد روزانه، روزهای سقف × حداقل مزد روزانه) × روزهای کار در سال ÷ روزهای سال.
 *   «مبلغ ثابت» (`fixed_amount`): مبلغ سال × روزهای کار در سال ÷ روزهای سال.
 *   دو روش اخیر ماهانه انباشته نمی‌شوند و کل مبلغ در سند «فیش عیدی» هزینه می‌شود.
 * سال عیدی هر فیش سال جلالی تاریخ پایان دوره آن است (ت۱۶).
 */

export const EIDI_METHODS = ['percent_of_work', 'labor_law', 'fixed_amount'] as const;
export type EidiMethod = typeof EIDI_METHODS[number];

export const EIDI_METHOD_LABELS: Record<EidiMethod, string> = {
  percent_of_work: 'درصدی از کارکرد تا سقف سال',
  labor_law: 'قانون کار',
  fixed_amount: 'مبلغ ثابت',
};

export const EIDI_OVERRIDE_REASON_MAX = 500;

export interface EidiRates {
  jalaliYear: number;
  method: EidiMethod;
  /** درصد هر فیش (روش درصدی) */
  percent: DecimalValue;
  /** سقف سالانه هر پرسنل (روش درصدی، ریال) */
  yearlyCap: DecimalValue;
  /** روزهای مزد عیدی (قانون کار) */
  laborDays: DecimalValue;
  /** روزهای سقف به حداقل مزد (قانون کار) */
  laborCapDays: DecimalValue;
  /** حداقل مزد روزانه سال (قانون کار، ریال) */
  minDailyWage: DecimalValue;
  /** مبلغ سال (روش مبلغ ثابت، ریال) */
  fixedAmount: DecimalValue;
}

export const isEidiMethod = (v: unknown): v is EidiMethod => (EIDI_METHODS as readonly string[]).includes(String(v));

/** خطای فارسی نرخ‌های عیدی یک سال، یا تهی (مشترک فرم و سرور) */
export function eidiRatesError(r: EidiRates): string | null {
  if (!Number.isInteger(r.jalaliYear) || r.jalaliYear < 1390 || r.jalaliYear > 1500) return 'سال جلالی نرخ عیدی معتبر نیست.';
  if (!isEidiMethod(r.method)) return 'روش محاسبه عیدی را انتخاب کنید.';
  const nonNegative = [r.percent, r.yearlyCap, r.laborDays, r.laborCapDays, r.minDailyWage, r.fixedAmount].every(v => !fin(v ?? 0).isNegative());
  if (!nonNegative) return 'رقم‌های عیدی نمی‌توانند منفی باشند.';
  if (r.method === 'percent_of_work') {
    const p = fin(r.percent ?? 0);
    if (!p.isPositive() || p.greaterThan(100)) return 'درصد عیدی باید بیش از صفر و تا ۱۰۰ باشد.';
    if (!fin(r.yearlyCap ?? 0).isPositive()) return 'سقف سالانه عیدی را وارد کنید.';
  }
  if (r.method === 'labor_law') {
    if (!fin(r.laborDays ?? 0).isPositive() || !fin(r.laborCapDays ?? 0).isPositive()) return 'روزهای مزد عیدی و روزهای سقف را وارد کنید.';
    if (!fin(r.minDailyWage ?? 0).isPositive()) return 'حداقل مزد روزانه سال را وارد کنید.';
  }
  if (r.method === 'fixed_amount' && !fin(r.fixedAmount ?? 0).isPositive()) return 'مبلغ عیدی سال را وارد کنید.';
  return null;
}

/** «مشمول عیدی» پرونده پرسنل (v10.1.34، TD-1282)؛ مقدار نخوانده روشن است، مثل پیش‌فرض ستون */
export const isEidiCovered = (person: { isEidiCovered?: number | null }): boolean => Number(person.isEidiCovered ?? 1) === 1;

export const EIDI_NOT_COVERED_NOTE = 'این نفر «مشمول عیدی» نیست؛ فقط عیدی انباشته‌ای که پیش‌تر برایش ثبت شده پیشنهاد می‌شود و مبلغ دیگر شرح می‌خواهد.';

/**
 * سهم عیدی یک فیش عادی در روش درصدی: گرد(پایه × درصد ÷ ۱۰۰)، کمینه با آنچه از سقف سال مانده است (`otherShares` جمع سهم
 * فیش‌های زنده دیگر همان پرسنل در همان سال). روش دیگر یا بی نرخ صفر است.
 */
export function payslipEidiShare(input: { base: DecimalValue; rates: EidiRates | null; otherShares: DecimalValue }): string {
  const r = input.rates;
  if (!r || r.method !== 'percent_of_work') return '0';
  const base = fin(input.base ?? 0);
  if (!base.isPositive()) return '0';
  const raw = base.multiply(fin(r.percent)).divide(100, 10).round(0);
  const room = fin(r.yearlyCap).subtract(fin(input.otherShares ?? 0));
  if (!room.isPositive()) return '0';
  return (raw.greaterThan(room) ? room : raw).round(0).toString();
}

const DAY_MS = 86_400_000;
const isoDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** شمار روزهای بازه [from, to] (هر دو سر شمرده) */
export function daysInclusive(fromIso: string, toIso: string): number {
  if (!fromIso || !toIso || fromIso > toIso) return 0;
  return Math.round((isoDay(toIso) - isoDay(fromIso)) / DAY_MS) + 1;
}

/**
 * حق عیدی سال در روش «قانون کار» و «مبلغ ثابت» به نسبت روزهای کار در سال؛ روش درصدی تهی (از سهم فیش‌ها می‌آید).
 * مزد روزانه قانون کار = حقوق ماهانه ÷ ۳۰.
 */
export function eidiEntitlement(input: { rates: EidiRates; monthlySalary: DecimalValue; workedDays: number; yearDays: number }): FinancialDecimal | null {
  const { rates } = input;
  if (rates.method === 'percent_of_work' || input.yearDays <= 0) return null;
  const share = fin(Math.max(0, input.workedDays)).divide(input.yearDays, 10);
  if (rates.method === 'fixed_amount') return fin(rates.fixedAmount).multiply(share).round(0);
  const daily = fin(input.monthlySalary ?? 0).divide(30, 10);
  const byWage = daily.multiply(fin(rates.laborDays));
  const cap = fin(rates.minDailyWage).multiply(fin(rates.laborCapDays));
  const full = byWage.greaterThan(cap) ? cap : byWage;
  return full.multiply(share).round(0);
}

export interface EidiPayslipSuggestion {
  method: EidiMethod;
  /** مبلغ پیشنهادی فیش عیدی (ریال) */
  amount: string;
  /** سهم انباشته فیش‌های تأییدشده سال که هنوز در فیش عیدی نیامده است */
  remainingAccrual: string;
  /** حق سال در روش قانون کار و مبلغ ثابت؛ در روش درصدی تهی */
  entitlement: string | null;
}

/**
 * مبلغ پیشنهادی «فیش عیدی»: در روش درصدی سهم انباشته فیش‌های تأییدشده منهای آنچه فیش‌های عیدی پیشین از انباشته پرداخته‌اند؛
 * در دو روش دیگر حق سال منهای جمع فیش‌های عیدی پیشین همان سال. پرسنلی که «مشمول عیدی» نیست (`covered: false`، v10.1.34،
 * TD-1282) حق سال ندارد و فقط عیدی انباشته‌ای که پیش‌تر برایش ثبت شده پیشنهاد می‌شود.
 */
export function suggestEidiPayslip(input: {
  rates: EidiRates;
  accruedApproved: DecimalValue;
  issuedFromAccrual: DecimalValue;
  issuedTotal: DecimalValue;
  monthlySalary: DecimalValue;
  workedDays: number;
  yearDays: number;
  covered?: boolean;
}): EidiPayslipSuggestion {
  const remaining = fin(input.accruedApproved ?? 0).subtract(fin(input.issuedFromAccrual ?? 0));
  const remainingAccrual = remaining.isPositive() ? remaining : fin(0);
  const entitlement = input.covered === false ? null : eidiEntitlement(input);
  const due = entitlement === null ? remainingAccrual : entitlement.subtract(fin(input.issuedTotal ?? 0));
  return {
    method: input.rates.method,
    amount: (due.isPositive() ? due : fin(0)).round(0).toString(),
    remainingAccrual: remainingAccrual.round(0).toString(),
    entitlement: entitlement === null ? null : entitlement.toString(),
  };
}

/** بخشی از مبلغ فیش عیدی که از «عیدی پرداختنی» انباشته پرداخت می‌شود؛ مازاد هزینه همان سند است */
export function eidiFromAccrual(amount: DecimalValue, remainingAccrual: DecimalValue): string {
  const a = fin(amount ?? 0);
  const r = fin(remainingAccrual ?? 0);
  if (!a.isPositive() || !r.isPositive()) return '0';
  return (a.greaterThan(r) ? r : a).round(4).toString();
}
