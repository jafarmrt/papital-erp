import { sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { pieceworkPayrolls, type personnel } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { daysInclusive, eidiFromAccrual, suggestEidiPayslip, EIDI_OVERRIDE_REASON_MAX, type EidiPayslipSuggestion } from '../../lib/payroll/eidi.js';
import { serviceEndOf, serviceStartOf } from '../../lib/payroll/payrollPeriod.js';
import { isoToJalaliDate, jalaliYearBounds } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { auditPayrollIssued } from './pieceworkAudit.js';
import { eidiPersonnel, eidiRatesOf, eidiRatesOfYear, eidiYearTotals, type EidiYearTotals } from './payrollEidi.js';

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸، ت۱۵ الف): «فیش عیدی» عیدی یک سال یک پرسنل را می‌پردازد: پایان سال، یا پیش از آن برای
 * پرسنلی که همکاری‌اش پایان یافته است. همان گام تأیید و تفکیک وظایف فیش حقوق را دارد و با «ثبت پرداخت» عادی (`piecework.pay`)
 * پرداخت می‌شود. کسورات قانونی، کارکرد و حقوق ثابت ندارد؛ دوره‌اش روزهای همکاری در آن سال است و قاعده «دوره آینده» آن را
 * رد نمی‌کند. مبلغی جز پیشنهاد سرور فقط با شرح (۴۲۲ `PAYROLL_EIDI_OVERRIDE_REASON_REQUIRED`) پذیرفته می‌شود.
 */

type PersonnelRow = typeof personnel.$inferSelect;

export interface EidiServicePeriod {
  startIso: string;
  endIso: string;
  workedDays: number;
  yearDays: number;
}

/** روزهای همکاری پرسنل در سال جلالی؛ پایان همکاری بی تاریخ و همکاری بیرون از سال ۴۲۲ */
export function eidiServicePeriod(person: Pick<PersonnelRow, 'fullName' | 'startDate' | 'endDate' | 'employmentStatus'>, year: number): EidiServicePeriod {
  const bounds = jalaliYearBounds(year);
  if (!bounds) throw new ValidationError('سال جلالی عیدی معتبر نیست.', undefined, 'PAYROLL_EIDI_YEAR_INVALID');
  const serviceStart = serviceStartOf(person);
  const serviceEnd = serviceEndOf(person);
  if (serviceEnd.kind === 'unknown') {
    throw new ValidationError(`${person.fullName} «قطع همکاری» است ولی تاریخ پایان همکاری معتبری ندارد؛ نخست آن را در پرونده پرسنل وارد کنید.`, undefined, 'PAYROLL_SERVICE_END_DATE_REQUIRED');
  }
  const startIso = serviceStart && serviceStart > bounds.firstDay ? serviceStart : bounds.firstDay;
  const endIso = serviceEnd.kind === 'ended' && serviceEnd.endIso < bounds.lastDay ? serviceEnd.endIso : bounds.lastDay;
  if (startIso > endIso) {
    throw new ValidationError(`${person.fullName} در سال ${toPersianDigits(year)} همکاری نداشته است.`, undefined, 'PAYROLL_EIDI_NO_SERVICE');
  }
  return { startIso, endIso, workedDays: daysInclusive(startIso, endIso), yearDays: daysInclusive(bounds.firstDay, bounds.lastDay) };
}

export interface EidiPayslipPreview {
  personnelId: number;
  fullName: string;
  jalaliYear: number;
  period: EidiServicePeriod;
  totals: EidiYearTotals;
  suggestion: EidiPayslipSuggestion;
  /** فیش‌های عادی پیش‌نویس سال با سهم عیدی که هنوز در عیدی انباشته شمرده نمی‌شوند */
  draftWarning: string | null;
}

async function previewWith(db: DbExecutor, person: PersonnelRow, year: number): Promise<EidiPayslipPreview> {
  const rates = await eidiRatesOfYear(year, db);
  if (!rates) {
    throw new ValidationError(`روش و نرخ عیدی سال ${toPersianDigits(year)} ثبت نشده است؛ دارنده «نرخ‌های بیمه و مالیات حقوق» آن را در تنظیمات وارد کند.`, undefined, 'PAYROLL_EIDI_RATES_MISSING');
  }
  const period = eidiServicePeriod(person, year);
  const totals = await eidiYearTotals(db, person.id, year);
  const suggestion = suggestEidiPayslip({
    rates: eidiRatesOf(rates),
    accruedApproved: totals.accruedApproved,
    issuedFromAccrual: totals.issuedFromAccrual,
    issuedTotal: totals.issuedTotal,
    monthlySalary: person.monthlySalary ?? 0,
    workedDays: period.workedDays,
    yearDays: period.yearDays,
  });
  const draftWarning = totals.draftPayslips > 0
    ? `${toPersianDigits(totals.draftPayslips)} فیش پیش‌نویس این سال سهم عیدی دارد که تا تأیید فیش در عیدی انباشته شمرده نمی‌شود.`
    : null;
  return { personnelId: person.id, fullName: person.fullName, jalaliYear: year, period, totals, suggestion, draftWarning };
}

export async function previewEidiPayslip(personnelId: number, year: number): Promise<EidiPayslipPreview> {
  const person = await eidiPersonnel(orm, personnelId, false);
  return previewWith(orm, person, year);
}

export interface IssueEidiPayslipInput {
  personnelId: number;
  year: number;
  amount?: DecimalValue;
  overrideReason?: string;
  notes?: string;
  userId?: number;
  username: string;
  req?: unknown;
}

/** صدور فیش عیدی پیش‌نویس با سندش، زیر قفل ردیف پرسنل (همان قفل صدور فیش عادی) */
export async function issueEidiPayslip(input: IssueEidiPayslipInput) {
  return orm.transaction(async (tx) => {
    const person = await eidiPersonnel(tx, input.personnelId, true);
    const preview = await previewWith(tx, person, input.year);
    const suggested = preview.suggestion.amount;
    const entered = input.amount === undefined || input.amount === null || String(input.amount).trim() === '' ? null : fin(input.amount).round(0);
    const amount = entered ?? fin(suggested);
    if (amount.isNegative()) throw new ValidationError('مبلغ عیدی نمی‌تواند منفی باشد.', undefined, 'PAYROLL_NEGATIVE_COMPONENT');
    const reason = String(input.overrideReason ?? '').trim().slice(0, EIDI_OVERRIDE_REASON_MAX);
    const overridden = amount.subtract(suggested).abs().greaterThanOrEqual(1);
    if (overridden && !reason) {
      throw new ValidationError(
        `مبلغ عیدی با مبلغ محاسبه‌شده (${toPersianDigits(fin(suggested).toNumber().toLocaleString('fa-IR'))} ریال) فرق دارد؛ شرح تغییر را بنویسید.`,
        { suggestion: preview.suggestion },
        'PAYROLL_EIDI_OVERRIDE_REASON_REQUIRED',
      );
    }
    if (!amount.isPositive()) {
      throw new ValidationError(`عیدی سال ${toPersianDigits(input.year)} برای ${person.fullName} مبلغی ندارد که پرداخت شود.`, undefined, 'PAYROLL_EIDI_AMOUNT_ZERO');
    }
    const fromAccrual = eidiFromAccrual(amount.toString(), preview.suggestion.remainingAccrual);
    const seqResult = await tx.execute(sql`SELECT nextval('piecework_payroll_number_seq') AS num`);
    const payrollNumber = `PAY-${Number(seqResult.rows?.[0]?.num)}`;
    const { startIso, endIso } = preview.period;
    const notes = [
      `فیش عیدی سال ${input.year}`,
      overridden ? `مبلغ دستی: ${reason}` : '',
      input.notes ? String(input.notes).trim() : '',
    ].filter(Boolean).join(' | ');
    const [row] = await tx.insert(pieceworkPayrolls).values({
      payrollNumber,
      personnelId: person.id,
      startDate: startIso,
      endDate: endIso,
      title: `فیش عیدی سال ${input.year} ${person.fullName} (${isoToJalaliDate(startIso)} تا ${isoToJalaliDate(endIso)})`,
      totalPieceworkAmount: money(0),
      totalFixedAmount: money(0),
      totalBonuses: money(0),
      totalDeductions: money(0),
      advanceDeduction: money(0),
      netPayable: money(amount.toString()),
      status: 'draft',
      isEidi: 1,
      eidiYear: input.year,
      eidiAmount: money(amount.toString()),
      eidiFromAccrual: money(fromAccrual),
      isStatutorySplit: 1,
      notes,
      createdById: input.userId,
      isDeleted: 0,
    }).returning();
    const voucher = await VoucherSyncService.autoCreateVoucherForPayroll(row.id, input.userId, input.username, tx, { strict: true });
    await auditPayrollIssued(tx, row, {
      personnelName: person.fullName,
      logIds: [],
      voucher,
      eidi: { jalaliYear: input.year, suggestion: preview.suggestion, entered: amount.toString(), fromAccrual, overrideReason: overridden ? reason : '' },
    }, { req: input.req, userId: input.userId, username: input.username });
    return { payroll: row, personnelName: person.fullName, voucher };
  });
}
