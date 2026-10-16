import { sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { ValidationError } from '../../../errors/customErrors.js';
import { fin, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import {
  STATUTORY_REMITTANCE_TEXT, statutoryLineCap,
  type StatutoryRemittanceKind, type StatutoryRemittanceOptionRow, type StatutoryRemittanceOptions, type StatutoryUnassignedPayments,
} from '../../../lib/treasury/statutoryRemittance.js';
import { jalaliMonthLength } from '../../../utils/calendarDate.js';
import { jalaliToGregorian } from '../../../utils/dateUtils.js';
import type { Account } from '../../../types.js';
import { TreasuryTransactionService } from './treasuryTransaction.service.js';

/**
 * v10.1.36 (TD-1243، تصمیم ت۳۳ الف): خواندن «فهرست بیمه و مالیات ماهانه» برای پنجره پرداخت: هر نفر با مبلغ ماه، پرداخت‌شده
 * همان ماه و مانده او روی حساب نگاشت‌شده، و پرداخت‌های بی نام پرسنل همان حساب. ثبت پرداخت (`statutoryRemittance.ts`) همین
 * خواندن‌ها را پس از قفل ردیف پرسنل تکرار می‌کند.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = ([y, m, d]: [number, number, number]) => `${y}-${pad(m)}-${pad(d)}`;

/** مبلغ هر فیش: بیمه سهم کارگر و کارفرما، یا مالیات حقوق */
const MONTH_AMOUNT: Record<StatutoryRemittanceKind, SQL> = {
  insurance: sql.raw('COALESCE(p.employee_insurance, 0) + COALESCE(p.employer_insurance, 0)'),
  tax: sql.raw('COALESCE(p.income_tax, 0)'),
};

export function monthRange(jalaliYear: number, jalaliMonth: number): { from: string; to: string } {
  if (!Number.isInteger(jalaliYear) || jalaliYear < 1390 || jalaliYear > 1500 || !Number.isInteger(jalaliMonth) || jalaliMonth < 1 || jalaliMonth > 12) {
    throw new ValidationError('سال و ماه جلالی فهرست معتبر نیست.', undefined, 'PAYROLL_REPORT_MONTH_INVALID');
  }
  return {
    from: isoOf(jalaliToGregorian(jalaliYear, jalaliMonth, 1)),
    to: isoOf(jalaliToGregorian(jalaliYear, jalaliMonth, jalaliMonthLength(jalaliYear, jalaliMonth))),
  };
}

/** فیش‌های تأییدشده (نه پیش‌نویس، نه عیدی) که پایان دوره‌شان در ماه است؛ نام جدول `p` */
const payslipsOfMonth = (from: string, to: string) =>
  sql`p.is_deleted = 0 AND p.is_eidi = 0 AND p.status IN ('approved', 'partially_paid', 'paid') AND p.end_date >= ${from} AND p.end_date <= ${to}`;

/** ردیف‌های پرداخت زنده همین نوع و ماه: پرداخت خزانه انجام‌شده، نه باطل و نه معکوس؛ نام جدول‌ها `l` و `t` */
const liveLinesOfMonth = (kind: StatutoryRemittanceKind, jalaliYear: number, jalaliMonth: number) =>
  sql`t.is_deleted = 0 AND t.status = 'completed' AND t.reversal_of_id IS NULL
      AND l.kind = ${kind} AND l.jalali_year = ${jalaliYear} AND l.jalali_month = ${jalaliMonth}`;

/** حساب نگاشت‌شده بیمه پرداختنی یا مالیات حقوق پرداختنی؛ نبودش ۴۲۲ */
export async function remittanceAccount(kind: StatutoryRemittanceKind, db?: DbExecutor): Promise<Account> {
  const account = await TreasuryTransactionService.payrollStatutoryPayableAccount(kind, db);
  if (!account) {
    throw new ValidationError(`حساب «${STATUTORY_REMITTANCE_TEXT[kind].account}» در نگاشت حساب‌ها یافت نشد؛ آن را در تنظیمات حسابداری مشخص کنید.`, undefined, 'STATUTORY_REMITTANCE_ACCOUNT_MISSING');
  }
  return account;
}

/** مانده بستانکار حساب برای تفصیلی پرسنل هر نفر، روی ردیف‌های زنده سندهای زنده با هر وضعیت (جمع در SQL، §1.8) */
export async function personnelBalances(db: DbExecutor, accountId: number, personnelIds: number[]): Promise<Map<number, FinancialDecimal>> {
  const balances = new Map<number, FinancialDecimal>();
  if (personnelIds.length === 0) return balances;
  const res = await db.execute(sql`
    SELECT i.detailed_id AS personnel_id, SUM(i.credit - i.debit)::text AS balance
      FROM journal_voucher_items i
      JOIN journal_vouchers v ON v.id = i.voucher_id AND v.is_deleted = 0
     WHERE i.is_deleted = 0 AND i.account_id = ${accountId} AND i.detailed_type = 'personnel'
       AND i.detailed_id IN (${sql.join(personnelIds.map(id => sql`${id}`), sql`, `)})
     GROUP BY i.detailed_id`);
  for (const r of res.rows as Array<{ personnel_id: unknown; balance: unknown }>) {
    balances.set(Number(r.personnel_id), fin(String(r.balance ?? '0')));
  }
  return balances;
}

/**
 * مبلغ ماه و پرداخت‌شده همان ماه برای هر نفر فهرست ورودی (نفری که در ماه فیشی ندارد صفر)؛ ثبت پرداخت آن را پس از قفل
 * ردیف پرسنل می‌خواند، پس پرداخت هم‌زمان دیگری که همان افراد را دارد پیش از این خواندن نوشته شده است
 */
export async function monthFigures(
  db: DbExecutor, kind: StatutoryRemittanceKind, jalaliYear: number, jalaliMonth: number, personnelIds: number[],
): Promise<Map<number, { monthAmount: string; remitted: string }>> {
  const { from, to } = monthRange(jalaliYear, jalaliMonth);
  const ids = sql.join(personnelIds.map(id => sql`${id}`), sql`, `);
  const res = await db.execute(sql`
    SELECT pe.id,
           COALESCE((SELECT SUM(${MONTH_AMOUNT[kind]}) FROM piecework_payrolls p
                      WHERE p.personnel_id = pe.id AND ${payslipsOfMonth(from, to)}), 0)::text AS month_amount,
           COALESCE((SELECT SUM(l.amount) FROM statutory_remittance_lines l
                       JOIN treasury_transactions t ON t.id = l.treasury_transaction_id
                      WHERE l.personnel_id = pe.id AND ${liveLinesOfMonth(kind, jalaliYear, jalaliMonth)}), 0)::text AS remitted
      FROM personnel pe
     WHERE pe.id IN (${ids})`);
  return new Map((res.rows as Array<Record<string, unknown>>).map(r => [Number(r.id), {
    monthAmount: String(r.month_amount ?? '0'),
    remitted: String(r.remitted ?? '0'),
  }]));
}

/**
 * پرداخت‌های بی نام پرسنل روی حساب: بدهکار خالص ردیف‌های زنده‌ای که تفصیلی پرسنل ندارند (فرم خزانه «متفرقه» با طرف حساب
 * ۳۲۰۴ یا ۳۲۰۶، یا سند دستی)، و سندهایی که آن را ساخته‌اند (سند معکوس و سندی که معکوس زنده دارد نه). فیش هر ردیف این حساب
 * را با تفصیلی پرسنل می‌زند، پس هر مانده بی تفصیلی پرداختی است که معلوم نیست برای کدام ماه و کدام نفر بوده؛ سند اصلاحی که
 * آن را به نام افراد می‌برد خالص را صفر می‌کند. همان قاعده بررسی سلامت `statutory_payments_without_personnel`.
 */
export async function unassignedPayments(db: DbExecutor, accountId: number): Promise<StatutoryUnassignedPayments> {
  const noPersonnel = sql`(i.detailed_type IS DISTINCT FROM 'personnel' OR i.detailed_id IS NULL)`;
  const net = await db.execute(sql`
    SELECT COALESCE(SUM(i.debit - i.credit), 0)::text AS amount
      FROM journal_voucher_items i
      JOIN journal_vouchers v ON v.id = i.voucher_id AND v.is_deleted = 0
     WHERE i.is_deleted = 0 AND i.account_id = ${accountId} AND ${noPersonnel}`);
  const amount = fin(String((net.rows[0] as { amount?: unknown } | undefined)?.amount ?? '0'));
  if (!amount.isPositive()) return { amount: '0', vouchers: [] };
  const res = await db.execute(sql`
    SELECT v.id AS voucher_id, v.voucher_number::text AS voucher_number, v.date, SUM(i.debit - i.credit)::text AS amount
      FROM journal_voucher_items i
      JOIN journal_vouchers v ON v.id = i.voucher_id AND v.is_deleted = 0
     WHERE i.is_deleted = 0 AND i.account_id = ${accountId} AND ${noPersonnel}
       AND COALESCE(v.reference_number, '') NOT LIKE 'REV-V%'
       AND COALESCE(v.reference_number, '') NOT LIKE 'VOID-REPOST-V%'
       AND NOT EXISTS (
         SELECT 1 FROM journal_vouchers r
          WHERE r.is_deleted = 0 AND r.reference_id = v.id
            AND r.reference_number IN ('REV-V' || v.voucher_number::text, 'VOID-REPOST-V' || v.voucher_number::text))
     GROUP BY v.id, v.voucher_number, v.date
    HAVING SUM(i.debit - i.credit) > 0
     ORDER BY v.date DESC, v.id DESC
     LIMIT 20`);
  return {
    amount: amount.toString(),
    vouchers: (res.rows as Array<Record<string, unknown>>).map(r => ({
      voucherId: Number(r.voucher_id),
      voucherNumber: String(r.voucher_number ?? ''),
      date: String(r.date ?? ''),
      amount: fin(String(r.amount ?? '0')).toString(),
    })),
  };
}

/** پرسنل فهرست ماه با مبلغ ماه، پرداخت‌شده همان ماه، مانده و مبلغ پیشنهادی */
export async function statutoryRemittanceOptions(kind: StatutoryRemittanceKind, jalaliYear: number, jalaliMonth: number): Promise<StatutoryRemittanceOptions> {
  const { from, to } = monthRange(jalaliYear, jalaliMonth);
  const account = await remittanceAccount(kind);
  const amount = MONTH_AMOUNT[kind];
  const res = await orm.execute(sql`
    WITH month_pay AS (
      SELECT p.personnel_id, SUM(${amount}) AS month_amount
        FROM piecework_payrolls p
       WHERE ${payslipsOfMonth(from, to)}
       GROUP BY p.personnel_id
      HAVING SUM(${amount}) > 0
    ), remitted AS (
      SELECT l.personnel_id, SUM(l.amount) AS remitted
        FROM statutory_remittance_lines l
        JOIN treasury_transactions t ON t.id = l.treasury_transaction_id
       WHERE ${liveLinesOfMonth(kind, jalaliYear, jalaliMonth)}
       GROUP BY l.personnel_id
    ), bal AS (
      SELECT i.detailed_id AS personnel_id, SUM(i.credit - i.debit) AS balance
        FROM journal_voucher_items i
        JOIN journal_vouchers v ON v.id = i.voucher_id AND v.is_deleted = 0
       WHERE i.is_deleted = 0 AND i.account_id = ${account.id} AND i.detailed_type = 'personnel'
         AND i.detailed_id IN (SELECT personnel_id FROM month_pay)
       GROUP BY i.detailed_id
    )
    SELECT pe.id, pe.full_name, COALESCE(pe.personnel_code, '') AS personnel_code,
           m.month_amount::text AS month_amount, COALESCE(r.remitted, 0)::text AS remitted, COALESCE(b.balance, 0)::text AS balance
      FROM month_pay m
      JOIN personnel pe ON pe.id = m.personnel_id
      LEFT JOIN remitted r ON r.personnel_id = m.personnel_id
      LEFT JOIN bal b ON b.personnel_id = m.personnel_id
     ORDER BY pe.full_name, pe.id`);
  const totals = { monthAmount: fin(0), remitted: fin(0), suggested: fin(0) };
  const rows: StatutoryRemittanceOptionRow[] = (res.rows as Array<Record<string, unknown>>).map(r => {
    const monthAmount = fin(String(r.month_amount ?? '0'));
    const remitted = fin(String(r.remitted ?? '0'));
    const balance = fin(String(r.balance ?? '0'));
    const suggested = statutoryLineCap({ monthAmount: monthAmount.toString(), remitted: remitted.toString(), balance: balance.toString() });
    totals.monthAmount = totals.monthAmount.add(monthAmount);
    totals.remitted = totals.remitted.add(remitted);
    totals.suggested = totals.suggested.add(suggested);
    return {
      personnelId: Number(r.id),
      fullName: String(r.full_name ?? ''),
      personnelCode: String(r.personnel_code ?? ''),
      monthAmount: monthAmount.toString(),
      remitted: remitted.toString(),
      balance: balance.toString(),
      suggested: suggested.toString(),
    };
  });
  return {
    kind,
    jalaliYear,
    jalaliMonth,
    accountCode: account.code,
    accountName: account.name,
    rows,
    totals: { monthAmount: totals.monthAmount.toString(), remitted: totals.remitted.toString(), suggested: totals.suggested.toString() },
    unassignedPayments: await unassignedPayments(orm, account.id),
  };
}
