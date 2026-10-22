import { asc, eq } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { payrollStatutoryRates, personnel } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { logActivity } from '../../lib/auditLogger.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import {
  payrollStatutoryYear, statutoryOverridden, statutoryRatesError, suggestStatutoryDeductions,
  STATUTORY_OVERRIDE_REASON_MAX, type StatutoryAmounts, type StatutoryRates, type StatutorySuggestion, type TaxBracket,
} from '../../lib/payroll/statutoryDeductions.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { idempotentTransaction } from '../../middleware/idempotency.js';

/**
 * v10.0.210 (TD-1087، OBS-R2-49، طرح حقوق §۳.۳، تصمیم‌های ت۴ تا ت۶ الف): نرخ‌های سالانه بیمه و مالیات حقوق و کسورات
 * قانونی هر فیش. نرخ‌ها را فقط دارنده `payroll.rates_manage` می‌نویسد، در یک تراکنش با ردیف ممیزی؛ فیش مبلغ پیشنهادی را از
 * نرخ‌های سال پایان دوره می‌گیرد و مبلغ دیگری فقط با شرح (`statutoryOverrideReason`) می‌پذیرد.
 */

export const STATUTORY_RATES_AUDIT_ENTITY = 'نرخ بیمه و مالیات حقوق';

type RatesRow = typeof payrollStatutoryRates.$inferSelect;

export interface StatutoryRatesView {
  jalaliYear: number;
  employeeInsurancePercent: string;
  employerInsurancePercent: string;
  insuranceWageCap: string;
  taxBrackets: TaxBracket[];
  deductInsuranceFromTax: boolean;
  version: number;
}

function viewOf(row: RatesRow): StatutoryRatesView {
  return {
    jalaliYear: row.jalaliYear,
    employeeInsurancePercent: fin(row.employeeInsurancePercent).toString(),
    employerInsurancePercent: fin(row.employerInsurancePercent).toString(),
    insuranceWageCap: fin(row.insuranceWageCap).toString(),
    taxBrackets: Array.isArray(row.taxBrackets) ? row.taxBrackets : [],
    deductInsuranceFromTax: row.isInsuranceDeductedFromTax === 1,
    version: row.version,
  };
}

const ratesOf = (view: StatutoryRatesView): StatutoryRates => ({ ...view });

export async function listStatutoryRates(): Promise<StatutoryRatesView[]> {
  const rows = await orm.select().from(payrollStatutoryRates).orderBy(asc(payrollStatutoryRates.jalaliYear));
  return rows.map(viewOf);
}

export async function statutoryRatesOfYear(year: number, db: DbExecutor): Promise<StatutoryRatesView | null> {
  const [row] = await db.select().from(payrollStatutoryRates).where(eq(payrollStatutoryRates.jalaliYear, year));
  return row ? viewOf(row) : null;
}

export interface SaveStatutoryRatesInput {
  jalaliYear: number;
  employeeInsurancePercent: DecimalValue;
  employerInsurancePercent: DecimalValue;
  insuranceWageCap?: DecimalValue;
  taxBrackets: Array<{ from: DecimalValue; to?: DecimalValue | null; rate: DecimalValue }>;
  deductInsuranceFromTax?: boolean;
  /** نسخه نرخ‌های موجود همان سال؛ برای سال تازه خالی */
  version?: number;
  req?: unknown;
}

const decimalText = (v: DecimalValue) => fin(v ?? 0).toString();

/** نرخ‌های یک سال را می‌سازد یا ویرایش می‌کند (قفل ردیف سال، نسخه، ردیف ممیزی با همان تراکنش). */
export async function saveStatutoryRates(input: SaveStatutoryRatesInput): Promise<StatutoryRatesView> {
  const brackets: TaxBracket[] = input.taxBrackets.map(b => ({
    from: decimalText(b.from),
    to: b.to === null || b.to === undefined || String(b.to).trim() === '' ? null : decimalText(b.to),
    rate: decimalText(b.rate),
  }));
  const rates: StatutoryRates = {
    jalaliYear: Number(input.jalaliYear),
    employeeInsurancePercent: decimalText(input.employeeInsurancePercent),
    employerInsurancePercent: decimalText(input.employerInsurancePercent),
    insuranceWageCap: decimalText(input.insuranceWageCap ?? 0),
    taxBrackets: brackets,
    deductInsuranceFromTax: input.deductInsuranceFromTax === true,
  };
  const refusal = statutoryRatesError(rates);
  if (refusal) throw new ValidationError(refusal, undefined, 'PAYROLL_RATES_INVALID');
  const values = {
    jalaliYear: rates.jalaliYear,
    employeeInsurancePercent: String(rates.employeeInsurancePercent),
    employerInsurancePercent: String(rates.employerInsurancePercent),
    insuranceWageCap: money(String(rates.insuranceWageCap)),
    taxBrackets: brackets,
    isInsuranceDeductedFromTax: rates.deductInsuranceFromTax ? 1 : 0,
  };
  return idempotentTransaction(async (tx) => {
    const [before] = await tx.select().from(payrollStatutoryRates).where(eq(payrollStatutoryRates.jalaliYear, rates.jalaliYear)).for('update');
    let after: RatesRow;
    if (before) {
      if (input.version === undefined || Number(input.version) !== before.version) {
        throw new ConflictError(`نرخ‌های سال ${toPersianDigits(rates.jalaliYear)} را کاربر دیگری تغییر داده است؛ صفحه را دوباره باز کنید.`, undefined, 'OCC_CONFLICT');
      }
      [after] = await tx.update(payrollStatutoryRates)
        .set({ ...values, version: before.version + 1, updatedAt: new Date().toISOString() })
        .where(eq(payrollStatutoryRates.id, before.id)).returning();
    } else {
      [after] = await tx.insert(payrollStatutoryRates).values(values).returning();
    }
    await logActivity({
      tx,
      req: input.req,
      action: before ? 'UPDATE' : 'CREATE',
      entity: STATUTORY_RATES_AUDIT_ENTITY,
      entityId: after.id,
      description: `${before ? 'ویرایش' : 'ثبت'} نرخ‌های بیمه و مالیات حقوق سال ${toPersianDigits(rates.jalaliYear)}`,
      details: { before: before ? viewOf(before) : null, after: viewOf(after) },
    });
    return viewOf(after);
  });
}

export interface StatutoryPersonnel {
  isInsuranceCovered?: number | null;
  isTaxCovered?: number | null;
}

/** کسورات قانونی فرستاده‌شده در صدور یا ویرایش فیش؛ نفرستاده = مبلغ پیشنهادی سرور، مبلغ دیگر با شرح */
export interface StatutoryEntryInput {
  employeeInsurance?: DecimalValue;
  employerInsurance?: DecimalValue;
  incomeTax?: DecimalValue;
  statutoryOverrideReason?: string;
}

/** ستون‌های کسورات قانونی ردیف فیش (صدور و ویرایش پیش‌نویس) */
export function statutoryPayrollColumns(r: StatutoryResolution) {
  return {
    employeeInsurance: money(r.amounts.employeeInsurance),
    employerInsurance: money(r.amounts.employerInsurance),
    incomeTax: money(r.amounts.incomeTax),
    statutoryOverrideReason: r.overrideReason,
    isStatutorySplit: 1,
  };
}

/** جزئیات ممیزی کسورات قانونی */
export function statutoryAuditInfo(r: StatutoryResolution) {
  return { jalaliYear: r.jalaliYear, suggested: r.suggestion, entered: r.amounts, overrideReason: r.overrideReason, warning: r.warning };
}

export interface StatutoryResolution {
  amounts: StatutoryAmounts;
  overrideReason: string;
  suggestion: StatutorySuggestion;
  jalaliYear: number | null;
  /** سال بی نرخ برای پرسنل مشمول: پیام فارسی (فیش صادر می‌شود، کسورات قانونی حساب نمی‌شود) */
  warning: string | null;
}

/** مبلغ پیشنهادی کسورات قانونی یک فیش، بی نوشتن هیچ چیز */
export async function suggestPayrollStatutory(
  person: StatutoryPersonnel, period: { startIso: string; endIso: string }, gross: DecimalValue, db: DbExecutor,
): Promise<{ suggestion: StatutorySuggestion; jalaliYear: number | null; warning: string | null; covered: { insurance: boolean; tax: boolean } }> {
  const covered = { insurance: Number(person.isInsuranceCovered ?? 0) === 1, tax: Number(person.isTaxCovered ?? 0) === 1 };
  const jalaliYear = payrollStatutoryYear(period.endIso);
  const rates = jalaliYear !== null && (covered.insurance || covered.tax) ? await statutoryRatesOfYear(jalaliYear, db) : null;
  const warning = (covered.insurance || covered.tax) && !rates
    ? `نرخ‌های بیمه و مالیات حقوق سال ${toPersianDigits(jalaliYear ?? '')} ثبت نشده است؛ کسورات قانونی این فیش حساب نشد. دارنده «نرخ‌های بیمه و مالیات حقوق» آن را در تنظیمات وارد کند.`
    : null;
  const suggestion = suggestStatutoryDeductions({ gross, startIso: period.startIso, endIso: period.endIso, rates: rates ? ratesOf(rates) : null, coverage: covered });
  return { suggestion, jalaliYear, warning, covered };
}

/**
 * کسورات قانونی فیشی که صادر یا ویرایش می‌شود: مبلغ نفرستاده همان پیشنهاد است؛ مبلغ دیگر (منفی ۴۲۲) فقط با شرح
 * (۴۲۲ `PAYROLL_STATUTORY_OVERRIDE_REASON_REQUIRED`).
 */
export async function resolvePayrollStatutory(
  tx: DbExecutor,
  input: {
    person: StatutoryPersonnel;
    startIso: string;
    endIso: string;
    gross: DecimalValue;
    entered: Partial<Record<keyof StatutoryAmounts, DecimalValue>>;
    overrideReason?: string;
  },
): Promise<StatutoryResolution> {
  const { suggestion, jalaliYear, warning } = await suggestPayrollStatutory(input.person, { startIso: input.startIso, endIso: input.endIso }, input.gross, tx);
  const pick = (key: keyof StatutoryAmounts) => {
    const v = input.entered[key];
    return v === undefined || v === null || String(v).trim() === '' ? suggestion[key] : fin(v).round(4).toString();
  };
  const amounts: StatutoryAmounts = { employeeInsurance: pick('employeeInsurance'), employerInsurance: pick('employerInsurance'), incomeTax: pick('incomeTax') };
  if (Object.values(amounts).some(v => fin(v).isNegative())) {
    throw new ValidationError('بیمه و مالیات فیش نمی‌تواند منفی باشد.', undefined, 'PAYROLL_NEGATIVE_COMPONENT');
  }
  const reason = String(input.overrideReason ?? '').trim().slice(0, STATUTORY_OVERRIDE_REASON_MAX);
  const overridden = statutoryOverridden(amounts, suggestion);
  if (overridden && !reason) {
    throw new ValidationError(
      `بیمه یا مالیات فیش با مبلغ محاسبه‌شده (بیمه سهم کارگر ${toPersianDigits(suggestion.employeeInsurance)}، سهم کارفرما ${toPersianDigits(suggestion.employerInsurance)}، مالیات ${toPersianDigits(suggestion.incomeTax)} ریال) فرق دارد؛ شرح تغییر را بنویسید.`,
      { suggestion },
      'PAYROLL_STATUTORY_OVERRIDE_REASON_REQUIRED',
    );
  }
  return { amounts, overrideReason: overridden ? reason : '', suggestion, jalaliYear, warning };
}

/** پرسنل برای پیش‌نمایش (بی قفل) */
export async function statutoryPersonnel(personnelId: number): Promise<(StatutoryPersonnel & { fullName: string }) | null> {
  const [row] = await orm.select({ fullName: personnel.fullName, isInsuranceCovered: personnel.isInsuranceCovered, isTaxCovered: personnel.isTaxCovered })
    .from(personnel).where(eq(personnel.id, personnelId));
  return row ?? null;
}

/**
 * پیش‌نمایش فرم صدور فیش: مبلغ پیشنهادی بیمه و مالیات برای ناخالصی که فرم حساب کرده است. فرم مبلغ را فقط وقتی کاربر
 * تغییرش داده می‌فرستد، پس صدور همیشه پیشنهاد خود سرور را روی ناخالص واقعی فیش می‌گیرد.
 */
export async function previewPayrollStatutory(input: { personnelId: number; startDate: string; endDate: string; gross: DecimalValue }) {
  const startIso = requireStorageDate(input.startDate, 'تاریخ شروع دوره فیش');
  const endIso = requireStorageDate(input.endDate, 'تاریخ پایان دوره فیش');
  if (!startIso || !endIso || startIso > endIso) {
    throw new ValidationError('بازه فیش معتبر نیست: تاریخ شروع نباید بعد از پایان باشد.', undefined, 'PAYROLL_PERIOD_INVALID');
  }
  const person = await statutoryPersonnel(input.personnelId);
  if (!person) throw new NotFoundError('پرسنل انتخاب‌شده یافت نشد');
  return suggestPayrollStatutory(person, { startIso, endIso }, input.gross, orm);
}
