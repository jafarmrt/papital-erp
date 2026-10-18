import { asc, inArray } from 'drizzle-orm';
import { orm } from '../../../db/drizzle.js';
import { personnel, statutoryRemittanceLines } from '../../../db/schema.js';
import { ConflictError, ValidationError } from '../../../errors/customErrors.js';
import { fin, type DecimalValue, type FinancialDecimal } from '../../../lib/financialDecimal.js';
import { money } from '../../../lib/money.js';
import { LockHierarchyLevel, validateLockOrder } from '../../../lib/lockOrder.js';
import {
  STATUTORY_REMITTANCE_TEXT, statutoryMonthLeft, statutoryRemittanceDescription, type StatutoryRemittanceKind,
} from '../../../lib/treasury/statutoryRemittance.js';
import { formatPersianNumber, toPersianDigits } from '../../../utils/persianNumber.js';
import type { TreasuryTransaction } from '../../../types.js';
import { requireChoosableContraAccount } from './partyContraAccount.js';
import { monthFigures, monthRange, personnelBalances, remittanceAccount, unassignedPayments } from './statutoryRemittanceOptions.js';
import { auditTreasuryTransactionCreated, type TreasuryAuditActor } from './treasuryAudit.js';
import { resolveTreasuryWriteDate } from './treasuryDate.js';
import { TreasuryTransactionService } from './treasuryTransaction.service.js';
import { lockTreasuryBank, postTreasuryRow } from './treasuryPosting.js';

/**
 * v10.1.36 (TD-1243، تصمیم مالک محصول ت۳۳ الف): «پرداخت به تأمین اجتماعی» و «پرداخت به امور مالیاتی» از «فهرست بیمه و
 * مالیات ماهانه». یک پرداخت خزانه (همان یک واریز بانکی) با یک سند: بدهکار حساب نگاشت‌شده (بیمه پرداختنی ۳۲۰۴ یا مالیات
 * حقوق پرداختنی ۳۲۰۶) برای هر نفر با تفصیلی خود او، بدهکار جریمه دیرکرد اختیاری روی سرفصلی که کاربر انتخاب می‌کند، و
 * بستانکار بانک. پیش‌تر پرداخت «متفرقه» با طرف حساب ۳۲۰۴ تفصیلی پرسنل نداشت و صورت‌حساب هر نفر و نگهبان حذف پرسنل مانده
 * پرداخت‌شده را بدهی می‌دیدند. مبلغ هر نفر از آنچه فهرست همان ماه پس از پرداخت‌های زنده پیشین مانده و از مانده بستانکار او
 * روی همان حساب بیشتر نیست، هر دو پس از قفل ردیف پرسنل خوانده می‌شوند تا همان ماه دو بار پرداخت نشود؛ ابطال همان ابطال خزانه است.
 */

/** مبلغ ریالی با رقم و جداکننده هزارگان فارسی (§6) */
const faAmount = (v: DecimalValue) => formatPersianNumber(fin(v).toString(), 4);

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
  /** پرداخت‌های بی نام پرسنل این حساب را دیده و تأیید کرده است («بررسی کردم») */
  acknowledgeUnassignedPayments?: boolean;
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
    if (penaltyAccount) {
      // جریمه هزینه است، نه بدهی پرسنل: روی ۳۲۰۴ یا ۳۲۰۶ مانده بی نام پرسنل می‌ساخت. سرفصل هر حساب خزانه را
      // `requireChoosableContraAccount` پیش‌تر رد کرده است
      const statutoryIds = new Set<number>();
      for (const k of ['insurance', 'tax'] as const) {
        const statutory = await TreasuryTransactionService.payrollStatutoryPayableAccount(k, tx);
        if (statutory) statutoryIds.add(statutory.id);
      }
      if (statutoryIds.has(penaltyAccount.id)) {
        throw new ValidationError('سرفصل جریمه دیرکرد نمی‌تواند «بیمه پرداختنی» یا «مالیات حقوق پرداختنی» باشد؛ یک حساب هزینه انتخاب کنید.', undefined, 'STATUTORY_REMITTANCE_PENALTY_ACCOUNT_INVALID');
      }
    }

    const bank = await lockTreasuryBank(tx, input.bankAccountId);
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

    // سقف ماه: مانده حساب همه ماه‌ها را دارد، پس بی این سقف ماهی که پرداخت شده با بدهی ماه بعد دوباره پرداخت می‌شد
    const figures = await monthFigures(tx, kind, input.jalaliYear, input.jalaliMonth, ids);
    const overMonth = lines
      .map(l => ({ ...l, left: statutoryMonthLeft(figures.get(l.personnelId) ?? { monthAmount: '0', remitted: '0' }) }))
      .filter(l => l.amount.greaterThan(l.left));
    if (overMonth.length > 0) {
      const names = overMonth.map(l => `${nameOf.get(l.personnelId) ?? ''} (مانده فهرست این ماه ${faAmount(l.left)} ریال)`).join('، ');
      throw new ValidationError(
        `مبلغ پرداخت از ${text.subject} پرداخت‌نشده فهرست این ماه برای این افراد بیشتر است: ${names}. فهرست را دوباره باز کنید.`,
        { personnel: overMonth.map(l => ({ personnelId: l.personnelId, amount: l.amount.toString(), monthLeft: l.left.toString() })) },
        'STATUTORY_REMITTANCE_EXCEEDS_MONTH',
      );
    }

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

    const unassigned = await unassignedPayments(tx, account.id);
    if (fin(unassigned.amount).isPositive() && input.acknowledgeUnassignedPayments !== true) {
      const numbers = unassigned.vouchers.slice(0, 5).map(v => toPersianDigits(v.voucherNumber)).join('، ');
      throw new ConflictError(
        `پیش‌تر ${faAmount(unassigned.amount)} ریال بی نام پرسنل به «${account.name}» پرداخت شده است${numbers ? ` (سند ${numbers})` : ''}. اگر بخشی از آن برای همین فهرست است، دوباره نپردازید؛ وگرنه «بررسی کردم» را بزنید.`,
        { unassignedPayments: unassigned },
        'STATUTORY_REMITTANCE_UNASSIGNED_PAYMENTS',
      );
    }

    const linesTotal = lines.reduce((t, l) => t.add(l.amount), fin(0));
    const total = linesTotal.add(penalty?.amount ?? 0).round(4);
    const description = input.description?.trim() || statutoryRemittanceDescription(kind, input.jalaliYear, input.jalaliMonth);
    // v10.2.2 (OBS-R2-52): از راه مشترک خزانه (`postTreasuryRow`): مانده حساب (هرگز منفی، `TREASURY_BALANCE_INSUFFICIENT`)،
    // شماره، سند پیش‌نویس، ردیف و رویداد آن؛ ردیف‌های هر نفر پس از آن با شناسه ردیف خزانه نوشته می‌شوند
    const { row } = await postTreasuryRow(tx, bank, {
      type: 'payment',
      date,
      method,
      amount: total,
      currency: 'IRR',
      exchangeRate: 1,
      partyType: 'other',
      partyId: null,
      partyName: text.payee,
      purpose: null,
      contraAccountId: account.id,
      trackingNumber: input.trackingNumber?.trim() || '',
      documentId: null,
      description,
      createdById: input.userId || null,
      voucher: (txNum) => TreasuryTransactionService.createTreasuryVoucher({
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
            accountId: bank.accountId as number,
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
      }, tx),
      event: (rowId) => ({ transactionId: rowId, type: 'withdrawal', amount: total.toNumber(), currency: 'IRR', accountId: bank.id, accountName: bank.title, description }),
      actor: { userId: input.userId, username: input.username },
    });
    await tx.insert(statutoryRemittanceLines).values(lines.map(l => ({
      treasuryTransactionId: row.id,
      kind,
      jalaliYear: input.jalaliYear,
      jalaliMonth: input.jalaliMonth,
      personnelId: l.personnelId,
      amount: money(l.amount),
    })));

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
      statutoryRemittance: {
        kind, jalaliYear: input.jalaliYear, jalaliMonth: input.jalaliMonth, accountCode: account.code, penaltyAccountId: penaltyAccount?.id ?? null,
        ...(fin(unassigned.amount).isPositive() ? { acknowledgedUnassignedPayments: unassigned.amount } : {}),
      },
    });
    return created;
  });
}
