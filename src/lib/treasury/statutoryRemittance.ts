import { fin, type FinancialDecimal } from '../financialDecimal.js';
import { DECIMAL_PATTERN, normalizeDecimalString } from '../numericInput.js';
import { jalaliMonthLabel } from '../../utils/calendarDate.js';
import { formatPersianPrice } from '../../utils/persianNumber.js';

/**
 * v10.1.36 (TD-1243، تصمیم مالک محصول ت۳۳ الف): پرداخت یکجای بیمه یا مالیات حقوق یک ماه از خزانه. یک ردیف خزانه (همان یک
 * واریز بانکی) و یک سند: بدهکار «بیمه پرداختنی» (۳۲۰۴) یا «مالیات حقوق پرداختنی» (۳۲۰۶) برای هر نفر با تفصیلی خود او،
 * بدهکار جریمه دیرکرد اختیاری و بستانکار بانک. قرارداد مشترک سرور (`/accounting/treasury/statutory-remittance`) و پنجره
 * پرداخت در «فهرست بیمه و مالیات ماهانه». بیمه و مالیات اختیاری است: فقط پرسنلی که در فیش‌های ماه بیمه یا مالیات دارند
 * در فهرست می‌آیند و نبود آن خطا نیست.
 */

export const STATUTORY_REMITTANCE_KINDS = ['insurance', 'tax'] as const;
export type StatutoryRemittanceKind = typeof STATUTORY_REMITTANCE_KINDS[number];

export const isStatutoryRemittanceKind = (v: unknown): v is StatutoryRemittanceKind =>
  typeof v === 'string' && (STATUTORY_REMITTANCE_KINDS as readonly string[]).includes(v);

export const STATUTORY_REMITTANCE_TEXT: Record<StatutoryRemittanceKind, { button: string; payee: string; subject: string; account: string }> = {
  insurance: { button: 'پرداخت به تأمین اجتماعی', payee: 'سازمان تأمین اجتماعی', subject: 'بیمه', account: 'بیمه پرداختنی' },
  tax: { button: 'پرداخت به امور مالیاتی', payee: 'اداره امور مالیاتی', subject: 'مالیات حقوق', account: 'مالیات حقوق پرداختنی' },
};

/** کلید خزانه‌ای که پرداخت را ثبت می‌کند؛ دکمه‌ها با همین کلید نشان داده می‌شوند */
export const STATUTORY_REMITTANCE_PERMISSION = 'accounting.treasury';

export interface StatutoryRemittanceOptionRow {
  personnelId: number;
  fullName: string;
  personnelCode: string;
  /** بیمه سهم کارگر و کارفرما، یا مالیات حقوق، فیش‌های تأییدشده‌ای که پایان دوره‌شان در این ماه است */
  monthAmount: string;
  /** پرداخت‌های زنده پیشین همین نوع برای همین ماه */
  remitted: string;
  /** مانده بستانکار حساب نگاشت‌شده با تفصیلی همین نفر (همه اسناد زنده، پیش‌نویس هم) */
  balance: string;
  /** کمینه (مبلغ ماه منهای پرداخت‌شده، مانده)، نه زیر صفر */
  suggested: string;
}

export interface StatutoryRemittanceOptions {
  kind: StatutoryRemittanceKind;
  jalaliYear: number;
  jalaliMonth: number;
  accountCode: string;
  accountName: string;
  rows: StatutoryRemittanceOptionRow[];
  totals: { monthAmount: string; remitted: string; suggested: string };
}

export interface StatutoryRemittanceLineInput {
  personnelId: number;
  amount: string;
}

/** «واریز بیمه فهرست مهر ۱۴۰۵ به سازمان تأمین اجتماعی» */
export function statutoryRemittanceDescription(kind: StatutoryRemittanceKind, jalaliYear: number, jalaliMonth: number): string {
  const t = STATUTORY_REMITTANCE_TEXT[kind];
  return `واریز ${t.subject} فهرست ${jalaliMonthLabel(`${jalaliYear}/${String(jalaliMonth).padStart(2, '0')}`)} به ${t.payee}`;
}

/** روش پرداخت؛ چک در دفتر چک ثبت می‌شود، نه این‌جا (همان قاعده پرداخت فیش، TD-411) */
export const STATUTORY_REMITTANCE_METHODS = [
  { value: 'bank_transfer', label: 'انتقال بانکی' },
  { value: 'cash', label: 'نقدی / صندوق' },
  { value: 'pos', label: 'کارتخوان' },
] as const;
export type StatutoryRemittanceMethod = typeof STATUTORY_REMITTANCE_METHODS[number]['value'];

/** ماهی که کسی در آن بیمه یا مالیات حقوقِ پرداخت‌نشده ندارد؛ خطا نیست (بیمه و مالیات اختیاری است) */
export const STATUTORY_REMITTANCE_NOTHING = 'در این ماه چیزی برای پرداخت نیست.';

/** ردیف پنجره پرداخت: نفر با مبلغ پیشنهادی، که کاربر برمی‌دارد یا کمش می‌کند */
export interface StatutoryRemittanceDraftLine {
  personnelId: number;
  fullName: string;
  personnelCode: string;
  monthAmount: string;
  remitted: string;
  balance: string;
  include: boolean;
  /** متن عدد با ارقام لاتین (`DecimalInput`) */
  amount: string;
}

/** ردیف‌های آغازین: هر نفر با مبلغ پیشنهادی؛ نفری که پیشنهادی ندارد (پرداخت‌شده یا بی مانده) انتخاب نشده می‌آید */
export function statutoryRemittanceDraftLines(options: Pick<StatutoryRemittanceOptions, 'rows'>): StatutoryRemittanceDraftLine[] {
  return options.rows.map(r => {
    const suggested = fin(r.suggested);
    return {
      personnelId: r.personnelId,
      fullName: r.fullName,
      personnelCode: r.personnelCode,
      monthAmount: r.monthAmount,
      remitted: r.remitted,
      balance: r.balance,
      include: suggested.isPositive(),
      amount: suggested.isPositive() ? suggested.toString() : '',
    };
  });
}

const amountOf = (text: string) => {
  const normalized = normalizeDecimalString(text);
  return DECIMAL_PATTERN.test(normalized) ? fin(normalized) : null;
};

/** جمع ردیف‌های انتخاب‌شده و جریمه دیرکرد؛ مبلغ نامعتبر شمرده نمی‌شود */
export function statutoryRemittanceTotal(lines: StatutoryRemittanceDraftLine[], penaltyAmount = ''): FinancialDecimal {
  const linesTotal = lines.filter(l => l.include).reduce((t, l) => t.add(amountOf(l.amount) ?? 0), fin(0));
  return linesTotal.add(amountOf(penaltyAmount) ?? 0).round(4);
}

export interface StatutoryRemittanceFormInput {
  lines: StatutoryRemittanceDraftLine[];
  bankAccountId: string;
  penaltyAmount: string;
  penaltyAccountId: string;
}

/** همان قاعده‌های کارساز پیش از ارسال: دست‌کم یک نفر، مبلغ مثبت و نه بیش از مانده، حساب بانک و سرفصل جریمه */
export function statutoryRemittanceFormError(input: StatutoryRemittanceFormInput): string {
  const chosen = input.lines.filter(l => l.include);
  if (chosen.length === 0) return 'دست‌کم یک نفر را با مبلغ برای پرداخت انتخاب کنید.';
  for (const line of chosen) {
    const amount = amountOf(line.amount);
    if (!amount || !amount.isPositive()) return `مبلغ «${line.fullName}» باید بیشتر از صفر باشد.`;
    if (amount.greaterThan(fin(line.balance))) {
      return `مبلغ «${line.fullName}» از مانده او (${formatPersianPrice(fin(line.balance).toNumber(), 'IRR', 4)}) بیشتر است.`;
    }
  }
  if (!input.bankAccountId) return 'حساب بانکی یا صندوق را انتخاب کنید.';
  const penalty = amountOf(input.penaltyAmount);
  if (input.penaltyAmount.trim() !== '' && (!penalty || penalty.isNegative())) return 'جریمه دیرکرد باید عدد مثبت باشد.';
  if (penalty?.isPositive() && !input.penaltyAccountId) return 'سرفصل جریمه دیرکرد را انتخاب کنید.';
  return '';
}

export interface StatutoryRemittancePayloadInput extends StatutoryRemittanceFormInput {
  kind: StatutoryRemittanceKind;
  jalaliYear: number;
  jalaliMonth: number;
  date: string;
  method: StatutoryRemittanceMethod;
  trackingNumber: string;
  description: string;
}

/** بدنه `POST /accounting/treasury/statutory-remittance`؛ جریمه صفر یا خالی فرستاده نمی‌شود */
export function statutoryRemittancePayload(input: StatutoryRemittancePayloadInput) {
  const penalty = amountOf(input.penaltyAmount);
  return {
    kind: input.kind,
    year: input.jalaliYear,
    month: input.jalaliMonth,
    bankAccountId: Number(input.bankAccountId),
    date: input.date,
    method: input.method,
    ...(input.trackingNumber.trim() ? { trackingNumber: input.trackingNumber.trim() } : {}),
    ...(input.description.trim() ? { description: input.description.trim() } : {}),
    lines: input.lines.filter(l => l.include).map(l => ({ personnelId: l.personnelId, amount: normalizeDecimalString(l.amount) })),
    ...(penalty?.isPositive() ? { penalty: { amount: penalty.toString(), accountId: Number(input.penaltyAccountId) } } : {}),
  };
}
