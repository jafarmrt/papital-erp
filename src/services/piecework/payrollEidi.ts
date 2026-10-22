import { and, asc, eq, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { payrollEidiRates, personnel, pieceworkPayrolls } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { fin, type DecimalValue } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { eidiRatesError, isEidiMethod, payslipEidiShare, type EidiMethod, type EidiRates } from '../../lib/payroll/eidi.js';
import { payrollStatutoryYear } from '../../lib/payroll/statutoryDeductions.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { idempotentTransaction } from '../../middleware/idempotency.js';

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸، تصمیم‌های ت۱۴ تا ت۱۶ الف): روش و نرخ عیدی هر سال جلالی، سهم عیدی فیش عادی در صدور
 * و جمع‌های عیدی یک پرسنل در یک سال. نرخ‌ها را فقط دارنده `payroll.rates_manage` می‌نویسد، در یک تراکنش با ردیف ممیزی.
 */

export const EIDI_RATES_AUDIT_ENTITY = 'نرخ عیدی سالانه';

type RatesRow = typeof payrollEidiRates.$inferSelect;

export interface EidiRatesView {
  jalaliYear: number;
  method: EidiMethod;
  percent: string;
  yearlyCap: string;
  laborDays: string;
  laborCapDays: string;
  minDailyWage: string;
  fixedAmount: string;
  version: number;
}

function viewOf(row: RatesRow): EidiRatesView {
  return {
    jalaliYear: row.jalaliYear,
    method: isEidiMethod(row.method) ? row.method : 'percent_of_work',
    percent: fin(row.percent).toString(),
    yearlyCap: fin(row.yearlyCap).toString(),
    laborDays: fin(row.laborDays).toString(),
    laborCapDays: fin(row.laborCapDays).toString(),
    minDailyWage: fin(row.minDailyWage).toString(),
    fixedAmount: fin(row.fixedAmount).toString(),
    version: row.version,
  };
}

export const eidiRatesOf = (view: EidiRatesView): EidiRates => ({ ...view });

export async function listEidiRates(): Promise<EidiRatesView[]> {
  const rows = await orm.select().from(payrollEidiRates).orderBy(asc(payrollEidiRates.jalaliYear));
  return rows.map(viewOf);
}

export async function eidiRatesOfYear(year: number, db: DbExecutor): Promise<EidiRatesView | null> {
  const [row] = await db.select().from(payrollEidiRates).where(eq(payrollEidiRates.jalaliYear, year));
  return row ? viewOf(row) : null;
}

export interface SaveEidiRatesInput {
  jalaliYear: number;
  method: string;
  percent?: DecimalValue;
  yearlyCap?: DecimalValue;
  laborDays?: DecimalValue;
  laborCapDays?: DecimalValue;
  minDailyWage?: DecimalValue;
  fixedAmount?: DecimalValue;
  /** نسخه نرخ موجود همان سال؛ برای سال تازه خالی */
  version?: number;
  req?: unknown;
}

const decimalText = (v: DecimalValue) => fin(v ?? 0).toString();

/** روش و نرخ عیدی یک سال را می‌سازد یا ویرایش می‌کند (قفل ردیف سال، نسخه، ردیف ممیزی با همان تراکنش). */
export async function saveEidiRates(input: SaveEidiRatesInput): Promise<EidiRatesView> {
  const rates: EidiRates = {
    jalaliYear: Number(input.jalaliYear),
    method: input.method as EidiMethod,
    percent: decimalText(input.percent),
    yearlyCap: decimalText(input.yearlyCap),
    laborDays: decimalText(input.laborDays),
    laborCapDays: decimalText(input.laborCapDays),
    minDailyWage: decimalText(input.minDailyWage),
    fixedAmount: decimalText(input.fixedAmount),
  };
  const refusal = eidiRatesError(rates);
  if (refusal) throw new ValidationError(refusal, undefined, 'PAYROLL_EIDI_RATES_INVALID');
  const values = {
    jalaliYear: rates.jalaliYear,
    method: rates.method,
    percent: String(rates.percent),
    yearlyCap: money(String(rates.yearlyCap)),
    laborDays: String(rates.laborDays),
    laborCapDays: String(rates.laborCapDays),
    minDailyWage: money(String(rates.minDailyWage)),
    fixedAmount: money(String(rates.fixedAmount)),
  };
  return idempotentTransaction(async (tx) => {
    const [before] = await tx.select().from(payrollEidiRates).where(eq(payrollEidiRates.jalaliYear, rates.jalaliYear)).for('update');
    let after: RatesRow;
    if (before) {
      if (input.version === undefined || Number(input.version) !== before.version) {
        throw new ConflictError(`نرخ عیدی سال ${toPersianDigits(rates.jalaliYear)} را کاربر دیگری تغییر داده است؛ صفحه را دوباره باز کنید.`, undefined, 'OCC_CONFLICT');
      }
      [after] = await tx.update(payrollEidiRates)
        .set({ ...values, version: before.version + 1, updatedAt: new Date().toISOString() })
        .where(eq(payrollEidiRates.id, before.id)).returning();
    } else {
      [after] = await tx.insert(payrollEidiRates).values(values).returning();
    }
    await logActivity({
      tx,
      req: input.req,
      action: before ? 'UPDATE' : 'CREATE',
      entity: EIDI_RATES_AUDIT_ENTITY,
      entityId: after.id,
      description: `${before ? 'ویرایش' : 'ثبت'} روش و نرخ عیدی سال ${toPersianDigits(rates.jalaliYear)}`,
      details: { before: before ? viewOf(before) : null, after: viewOf(after) },
    });
    return viewOf(after);
  });
}

export interface EidiYearTotals {
  /** سهم فیش‌های عادی تأییدشده یا پرداخت‌شده */
  accruedApproved: string;
  /** سهم فیش‌های عادی پیش‌نویس */
  accruedDraft: string;
  draftPayslips: number;
  /** جمع فیش‌های عیدی زنده */
  issuedTotal: string;
  /** بخشی از فیش‌های عیدی که از عیدی انباشته پرداخت شده است */
  issuedFromAccrual: string;
  /** پرداخت‌شده فیش‌های عیدی */
  paidTotal: string;
}

/** جمع‌های عیدی یک پرسنل در یک سال روی فیش‌های زنده (جمع در SQL، §1.8) */
export async function eidiYearTotals(db: DbExecutor, personnelId: number, year: number, excludePayrollId?: number): Promise<EidiYearTotals> {
  const exclude = excludePayrollId ? sql`AND p.id <> ${excludePayrollId}` : sql``;
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN p.is_eidi = 0 AND p.status <> 'draft' THEN p.eidi_amount END), 0)::text AS accrued_approved,
           COALESCE(SUM(CASE WHEN p.is_eidi = 0 AND p.status = 'draft' THEN p.eidi_amount END), 0)::text AS accrued_draft,
           COUNT(*) FILTER (WHERE p.is_eidi = 0 AND p.status = 'draft' AND p.eidi_amount > 0)::int AS draft_payslips,
           COALESCE(SUM(CASE WHEN p.is_eidi = 1 THEN p.eidi_amount END), 0)::text AS issued_total,
           COALESCE(SUM(CASE WHEN p.is_eidi = 1 THEN p.eidi_from_accrual END), 0)::text AS issued_from_accrual,
           COALESCE(SUM(CASE WHEN p.is_eidi = 1 THEN p.paid_amount END), 0)::text AS paid_total
      FROM piecework_payrolls p
     WHERE p.is_deleted = 0 AND p.personnel_id = ${personnelId} AND p.eidi_year = ${year} ${exclude}`);
  const r = (res.rows as Array<Record<string, unknown>>)[0] ?? {};
  const t = (k: string) => fin(String(r[k] ?? '0')).toString();
  return {
    accruedApproved: t('accrued_approved'),
    accruedDraft: t('accrued_draft'),
    draftPayslips: Number(r.draft_payslips ?? 0),
    issuedTotal: t('issued_total'),
    issuedFromAccrual: t('issued_from_accrual'),
    paidTotal: t('paid_total'),
  };
}

export interface PayslipEidiResolution {
  jalaliYear: number | null;
  share: string;
  warning: string | null;
}

/**
 * سهم عیدی فیش عادی که صادر می‌شود (زیر قفل ردیف پرسنل که صدور فیش گرفته است): در روش درصدی گرد(پایه × درصد ÷ ۱۰۰) تا
 * سقف سال منهای سهم فیش‌های زنده دیگر همان سال؛ روش دیگر صفر. سال بی نرخ عیدی هشدار دارد و فیش بی سهم صادر می‌شود.
 * v10.1.35 (TD-1282، تصمیم ت۳۴ الف): فیش پرسنلی که «مشمول عیدی» نیست سهم، سال عیدی و هشدار ندارد.
 */
export async function resolvePayslipEidiShare(tx: DbExecutor, input: { personnelId: number; endIso: string; base: DecimalValue; eidiCovered: boolean }): Promise<PayslipEidiResolution> {
  if (!input.eidiCovered) return { jalaliYear: null, share: '0', warning: null };
  const jalaliYear = payrollStatutoryYear(input.endIso);
  if (jalaliYear === null) return { jalaliYear: null, share: '0', warning: null };
  const rates = await eidiRatesOfYear(jalaliYear, tx);
  if (!rates) {
    return {
      jalaliYear,
      share: '0',
      warning: `روش و نرخ عیدی سال ${toPersianDigits(jalaliYear)} ثبت نشده است؛ سهم عیدی این فیش حساب نشد.`,
    };
  }
  if (rates.method !== 'percent_of_work') return { jalaliYear, share: '0', warning: null };
  const totals = await eidiYearTotals(tx, input.personnelId, jalaliYear);
  const otherShares = fin(totals.accruedApproved).add(totals.accruedDraft);
  return { jalaliYear, share: payslipEidiShare({ base: input.base, rates: eidiRatesOf(rates), otherShares }), warning: null };
}

/** ستون‌های عیدی فیش عادی */
export function payslipEidiColumns(r: PayslipEidiResolution) {
  return { eidiAmount: money(r.share), eidiFromAccrual: money(0), eidiYear: r.jalaliYear, isEidi: 0 };
}

/**
 * قفل ردیف پرسنل فیش پیش از قفل خود فیش (ترتیب قفل صدور فیش و فیش عیدی)، تا جمع عیدی سال میان بررسی و نوشتن عوض نشود.
 */
export async function lockPayrollPersonnel(tx: DbExecutor, payrollId: number): Promise<void> {
  const [head] = await tx.select({ personnelId: pieceworkPayrolls.personnelId }).from(pieceworkPayrolls).where(eq(pieceworkPayrolls.id, payrollId));
  if (!head) return;
  await tx.select({ id: personnel.id }).from(personnel).where(eq(personnel.id, head.personnelId)).for('update');
}

/**
 * فیش عادی تأییدشده‌ای که سهم عیدی‌اش در فیش عیدی همان سال پرداخت شده است حذف یا به پیش‌نویس برگردانده نمی‌شود
 * (۴۰۹ `PAYROLL_EIDI_ALREADY_SETTLED`)؛ نخست فیش عیدی سال باطل می‌شود.
 */
export async function assertEidiShareNotSettled(tx: DbExecutor, pay: typeof pieceworkPayrolls.$inferSelect): Promise<void> {
  if (pay.isEidi === 1 || pay.status === 'draft' || pay.eidiYear === null || !fin(pay.eidiAmount ?? 0).isPositive()) return;
  const totals = await eidiYearTotals(tx, pay.personnelId, pay.eidiYear);
  const after = fin(totals.accruedApproved).subtract(pay.eidiAmount ?? 0);
  if (after.lessThan(fin(totals.issuedFromAccrual).subtract(0.01))) {
    throw new ConflictError(
      `سهم عیدی فیش ${pay.payrollNumber} در فیش عیدی سال ${toPersianDigits(pay.eidiYear)} پرداخت شده است؛ نخست فیش عیدی آن سال را باطل کنید.`,
      undefined,
      'PAYROLL_EIDI_ALREADY_SETTLED',
    );
  }
}

/** پرسنل زنده برای پیش‌نمایش و صدور فیش عیدی */
export async function eidiPersonnel(db: DbExecutor, personnelId: number, lock: boolean) {
  const query = db.select().from(personnel).where(and(eq(personnel.id, personnelId), eq(personnel.isDeleted, 0)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new NotFoundError('پرسنل انتخاب‌شده یافت نشد');
  return row;
}
