import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../../db/drizzle.js';
import { bankAccounts, personnel, statutoryRemittanceLines, treasuryTransactions } from '../../../db/schema.js';
import { NotFoundError, ValidationError } from '../../../errors/customErrors.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';
import { LockHierarchyLevel, validateLockOrder } from '../../../lib/lockOrder.js';
import {
  STATUTORY_REMITTANCE_TEXT, statutoryRemittanceDescription,
  type StatutoryRemittanceKind, type StatutoryRemittanceOptionRow, type StatutoryRemittanceOptions,
} from '../../../lib/treasury/statutoryRemittance.js';
import { jalaliMonthLength } from '../../../utils/calendarDate.js';
import { jalaliToGregorian } from '../../../utils/dateUtils.js';
import { toPersianDigits } from '../../../utils/persianNumber.js';
import type { Account, TreasuryTransaction } from '../../../types.js';
import { requireChoosableContraAccount } from './partyContraAccount.js';
import { auditTreasuryTransactionCreated, type TreasuryAuditActor } from './treasuryAudit.js';
import { resolveTreasuryWriteDate } from './treasuryDate.js';
import { TreasuryTransactionService } from './treasuryTransaction.service.js';

/**
 * v10.1.36 (TD-1243، تصمیم مالک محصول ت۳۳ الف): «پرداخت به تأمین اجتماعی» و «پرداخت به امور مالیاتی» از «فهرست بیمه و
 * مالیات ماهانه». یک پرداخت خزانه (همان یک واریز بانکی) با یک سند: بدهکار حساب نگاشت‌شده (بیمه پرداختنی ۳۲۰۴ یا مالیات
 * حقوق پرداختنی ۳۲۰۶) برای هر نفر با تفصیلی خود او، بدهکار جریمه دیرکرد اختیاری روی سرفصلی که کاربر انتخاب می‌کند، و
 * بستانکار بانک. پیش‌تر پرداخت «متفرقه» با طرف حساب ۳۲۰۴ تفصیلی پرسنل نداشت و صورت‌حساب هر نفر و نگهبان حذف پرسنل مانده
 * پرداخت‌شده را بدهی می‌دیدند. مبلغ هر نفر از مانده بستانکار او روی همان حساب بیشتر نیست؛ ابطال همان ابطال خزانه است.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = ([y, m, d]: [number, number, number]) => `${y}-${pad(m)}-${pad(d)}`;
const faAmount = (v: DecimalValue) => toPersianDigits(fin(v).toNumber().toLocaleString('en-US'));

/** مبلغ هر فیش: بیمه سهم کارگر و کارفرما، یا مالیات حقوق */
const MONTH_AMOUNT: Record<StatutoryRemittanceKind, SQL> = {
  insurance: sql.raw('COALESCE(p.employee_insurance, 0) + COALESCE(p.employer_insurance, 0)'),
  tax: sql.raw('COALESCE(p.income_tax, 0)'),
};

function monthRange(jalaliYear: number, jalaliMonth: number): { from: string; to: string } {
  if (!Number.isInteger(jalaliYear) || jalaliYear < 1390 || jalaliYear > 1500 || !Number.isInteger(jalaliMonth) || jalaliMonth < 1 || jalaliMonth > 12) {
    throw new ValidationError('سال و ماه جلالی فهرست معتبر نیست.', undefined, 'PAYROLL_REPORT_MONTH_INVALID');
  }
  return {
    from: isoOf(jalaliToGregorian(jalaliYear, jalaliMonth, 1)),
    to: isoOf(jalaliToGregorian(jalaliYear, jalaliMonth, jalaliMonthLength(jalaliYear, jalaliMonth))),
  };
}

/** حساب نگاشت‌شده بیمه پرداختنی یا مالیات حقوق پرداختنی؛ نبودش ۴۲۲ */
async function remittanceAccount(kind: StatutoryRemittanceKind, db?: DbExecutor): Promise<Account> {
  const account = await TreasuryTransactionService.payrollStatutoryPayableAccount(kind, db);
  if (!account) {
    throw new ValidationError(`حساب «${STATUTORY_REMITTANCE_TEXT[kind].account}» در نگاشت حساب‌ها یافت نشد؛ آن را در تنظیمات حسابداری مشخص کنید.`, undefined, 'STATUTORY_REMITTANCE_ACCOUNT_MISSING');
  }
  return account;
}

/** مانده بستانکار حساب برای تفصیلی پرسنل هر نفر، روی ردیف‌های زنده سندهای زنده با هر وضعیت (جمع در SQL، §1.8) */
async function personnelBalances(db: DbExecutor, accountId: number, personnelIds: number[]): Promise<Map<number, FinancialDecimal>> {
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

/** پرسنل فهرست ماه با مبلغ ماه، پرداخت‌شده همان ماه، مانده و مبلغ پیشنهادی */
export async function statutoryRemittanceOptions(kind: StatutoryRemittanceKind, jalaliYear: number, jalaliMonth: number): Promise<StatutoryRemittanceOptions> {
  const { from, to } = monthRange(jalaliYear, jalaliMonth);
  const account = await remittanceAccount(kind);
  const amount = MONTH_AMOUNT[kind];
  const res = await orm.execute(sql`
    WITH month_pay AS (
      SELECT p.personnel_id, SUM(${amount}) AS month_amount
        FROM piecework_payrolls p
       WHERE p.is_deleted = 0 AND p.is_eidi = 0 AND p.status IN ('approved', 'partially_paid', 'paid')
         AND p.end_date >= ${from} AND p.end_date <= ${to}
       GROUP BY p.personnel_id
      HAVING SUM(${amount}) > 0
    ), remitted AS (
      SELECT l.personnel_id, SUM(l.amount) AS remitted
        FROM statutory_remittance_lines l
        JOIN treasury_transactions t ON t.id = l.treasury_transaction_id
       WHERE t.is_deleted = 0 AND t.status = 'completed' AND t.reversal_of_id IS NULL
         AND l.kind = ${kind} AND l.jalali_year = ${jalaliYear} AND l.jalali_month = ${jalaliMonth}
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
    const left = monthAmount.subtract(remitted);
    const cap = left.lessThan(balance) ? left : balance;
    const suggested = cap.isPositive() ? cap : fin(0);
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
  };
}

export interface CreateStatutoryRemittanceInput {
  kind: StatutoryRemittanceKind;
  jalaliYear: number;
  jalaliMonth: number;
  bankAccountId: number;
  date?: string | null;
  method?: 'cash' | 'bank_transfer' | 'pos';
  trackingNumber?: string;
  description?: string;
  lines: Array<{ personnelId: number; amount: DecimalValue }>;
  penalty?: { amount: DecimalValue; accountId: number } | null;
  userId?: number;
  username?: string;
  audit?: TreasuryAuditActor;
}

export interface StatutoryRemittanceResult extends TreasuryTransaction {
  lines: Array<{ personnelId: number; fullName: string; amount: number }>;
  penaltyAmount: number;
}

/** ردیف‌های ورودی: نفر تکراری، مبلغ صفر یا منفی و فهرست خالی ۴۲۲، پیش از هر نوشتن */
function normalizedLines(lines: CreateStatutoryRemittanceInput['lines']): Array<{ personnelId: number; amount: FinancialDecimal }> {
  const seen = new Set<number>();
  const out = lines.map(l => ({ personnelId: Number(l.personnelId), amount: fin(l.amount ?? 0).round(4) }));
  for (const l of out) {
    if (!Number.isInteger(l.personnelId) || l.personnelId <= 0 || !l.amount.isPositive()) {
      throw new ValidationError('مبلغ هر نفر باید بیشتر از صفر باشد؛ کسی را که نمی‌پردازید از فهرست بردارید.', undefined, 'STATUTORY_REMITTANCE_LINE_INVALID');
    }
    if (seen.has(l.personnelId)) throw new ValidationError('هر نفر یک بار در فهرست پرداخت می‌آید.', undefined, 'STATUTORY_REMITTANCE_LINE_INVALID');
    seen.add(l.personnelId);
  }
  if (out.length === 0) throw new ValidationError('برای پرداخت دست‌کم یک نفر با مبلغ لازم است.', undefined, 'STATUTORY_REMITTANCE_EMPTY');
  return out;
}

export async function createStatutoryRemittance(input: CreateStatutoryRemittanceInput): Promise<StatutoryRemittanceResult> {
  const kind = input.kind;
  monthRange(input.jalaliYear, input.jalaliMonth);
  const lines = normalizedLines(input.lines);
  const penalty = input.penalty && fin(input.penalty.amount ?? 0).isPositive()
    ? { amount: fin(input.penalty.amount).round(4), accountId: Number(input.penalty.accountId) }
    : null;
  const method = input.method ?? 'bank_transfer';
  const date = await resolveTreasuryWriteDate(input.date, 'تاریخ پرداخت');
  const text = STATUTORY_REMITTANCE_TEXT[kind];

  return orm.transaction(async (tx) => {
    validateLockOrder([
      { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
      { name: 'personnel', hierarchyLevel: LockHierarchyLevel.PARTIES },
      { name: 'treasuryTransaction', hierarchyLevel: LockHierarchyLevel.TREASURY_TRANSACTIONS },
    ]);
    const account = await remittanceAccount(kind, tx);
    const penaltyAccount = penalty ? await requireChoosableContraAccount(tx, penalty.accountId) : null;

    const [bank] = await tx.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.isDeleted, 0)))
      .for('update');
    if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');
    if ((bank.currency || 'IRR') !== 'IRR') {
      throw new ValidationError(`بیمه و مالیات حقوق ریالی است؛ «${bank.title}» ریالی نیست.`, undefined, 'STATUTORY_REMITTANCE_RIAL_ONLY');
    }
    if (!bank.accountId) {
      throw new ValidationError(`«${bank.title}» سرفصل حسابداری ندارد؛ ثبت پرداخت ممکن نیست.`, undefined, 'BANK_LEDGER_ACCOUNT_INVALID');
    }

    // ردیف پرسنل به ترتیب شناسه پس از بانک (قفل صدور فیش)، تا مانده هر نفر میان سنجش و نوشتن عوض نشود
    const ids = lines.map(l => l.personnelId).sort((a, b) => a - b);
    const people = await tx.select({ id: personnel.id, fullName: personnel.fullName }).from(personnel)
      .where(inArray(personnel.id, ids)).orderBy(asc(personnel.id)).for('update');
    if (people.length !== ids.length) {
      throw new ValidationError('یکی از پرسنل فهرست یافت نشد.', undefined, 'STATUTORY_REMITTANCE_PERSONNEL_INVALID');
    }
    const nameOf = new Map(people.map(p => [p.id, p.fullName]));
    const balances = await personnelBalances(tx, account.id, ids);
    const over = lines
      .map(l => ({ ...l, balance: balances.get(l.personnelId) ?? fin(0) }))
      .filter(l => l.amount.greaterThan(l.balance));
    if (over.length > 0) {
      const names = over.map(l => `${nameOf.get(l.personnelId) ?? ''} (مانده ${faAmount(l.balance.isPositive() ? l.balance : 0)} ریال)`).join('، ');
      throw new ValidationError(
        `مبلغ پرداخت از مانده ${text.account} این افراد بیشتر است: ${names}.`,
        { personnel: over.map(l => ({ personnelId: l.personnelId, amount: l.amount.toString(), balance: l.balance.toString() })) },
        'STATUTORY_REMITTANCE_EXCEEDS_BALANCE',
      );
    }

    const linesTotal = lines.reduce((t, l) => t.add(l.amount), fin(0));
    const total = linesTotal.add(penalty?.amount ?? 0).round(4);
    const newBalance = fin(bank.currentBalance).subtract(total).round(4);
    if (newBalance.isNegative()) {
      throw new ValidationError(`مانده حساب «${bank.title}» کافی نیست (مانده فعلی: ${faAmount(bank.currentBalance)})`, undefined, 'TREASURY_BALANCE_INSUFFICIENT');
    }
    await tx.update(bankAccounts).set({ currentBalance: money(newBalance) }).where(eq(bankAccounts.id, bank.id));

    const txNum = await TreasuryTransactionService.generateTransactionNumber('payment', tx);
    const description = input.description?.trim() || statutoryRemittanceDescription(kind, input.jalaliYear, input.jalaliMonth);
    const voucher = await TreasuryTransactionService.createTreasuryVoucher({
      date,
      description,
      referenceNumber: txNum,
      currency: 'IRR',
      userId: input.userId,
      username: input.username,
      items: [
        ...lines.map(l => ({
          accountId: account.id,
          detailedType: 'personnel',
          detailedId: l.personnelId,
          detailedName: nameOf.get(l.personnelId) ?? 'پرسنل',
          debit: l.amount,
          credit: 0,
          currency: 'IRR',
          exchangeRate: 1,
          description: `${description} (${nameOf.get(l.personnelId) ?? 'پرسنل'})`,
        })),
        ...(penalty && penaltyAccount ? [{
          accountId: penaltyAccount.id,
          detailedType: 'other',
          detailedId: null,
          detailedName: text.payee,
          debit: penalty.amount,
          credit: 0,
          currency: 'IRR',
          exchangeRate: 1,
          description: `جریمه دیرکرد ${description}`,
        }] : []),
        {
          accountId: bank.accountId,
          detailedType: 'bank_account',
          detailedId: bank.id,
          detailedName: bank.title,
          debit: 0,
          credit: total,
          currency: 'IRR',
          exchangeRate: 1,
          description,
        },
      ],
    }, tx);

    const [row] = await tx.insert(treasuryTransactions).values({
      transactionNumber: txNum,
      type: 'payment',
      date,
      method,
      amount: money(total),
      currency: 'IRR',
      exchangeRate: money(1),
      bankAccountId: bank.id,
      partyType: 'other',
      partyId: null,
      partyName: text.payee,
      purpose: null,
      contraAccountId: account.id,
      trackingNumber: input.trackingNumber?.trim() || '',
      voucherId: voucher.id,
      documentId: null,
      description,
      status: 'completed',
      attachments: [],
      createdById: input.userId || null,
    }).returning();
    await tx.insert(statutoryRemittanceLines).values(lines.map(l => ({
      treasuryTransactionId: row.id,
      kind,
      jalaliYear: input.jalaliYear,
      jalaliMonth: input.jalaliMonth,
      personnelId: l.personnelId,
      amount: money(l.amount),
    })));

    await TreasuryTransactionService.recordInsertedPaymentEffects(tx, row.id, {
      userId: input.userId,
      username: input.username,
      event: { transactionId: row.id, type: 'withdrawal', amount: total.toNumber(), currency: 'IRR', accountId: bank.id, accountName: bank.title, description },
    });

    const created: StatutoryRemittanceResult = {
      ...row,
      amount: row.amount.toNumber(),
      exchangeRate: row.exchangeRate?.toNumber() ?? null,
      type: 'payment',
      method: row.method as TreasuryTransaction['method'],
      partyType: 'other',
      status: row.status as TreasuryTransaction['status'],
      bankAccountTitle: bank.title,
      lines: lines.map(l => ({ personnelId: l.personnelId, fullName: nameOf.get(l.personnelId) ?? '', amount: l.amount.toNumber() })),
      penaltyAmount: penalty?.amount.toNumber() ?? 0,
    } as StatutoryRemittanceResult;
    await auditTreasuryTransactionCreated(tx, input.audit, created, {
      ...created,
      statutoryRemittance: { kind, jalaliYear: input.jalaliYear, jalaliMonth: input.jalaliMonth, accountCode: account.code, penaltyAccountId: penaltyAccount?.id ?? null },
    });
    return created;
  });
}
