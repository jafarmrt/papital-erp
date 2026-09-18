import { orm, type DbExecutor } from '../../db/drizzle.js';
import {
  bankAccounts,
  treasuryTransactions,
  pieceworkPayrolls,
  pieceworkLogs,
  personnel,
  journalVouchers,
  journalVoucherItems
} from '../../db/schema.js';
import { eq, and, inArray, or, like, isNull } from 'drizzle-orm';
import { VoucherService } from './voucher.service.js';
import { AccountMappingService } from './accountMapping.service.js';
import { TreasuryTransactionService } from './treasury/treasuryTransaction.service.js';
import { LockHierarchyLevel, withOrderedLocks } from '../../lib/lockOrder.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { fin } from '../../lib/financialDecimal.js';
import { businessTodayJalaliDash } from '../../lib/businessClock.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';

// V4.0.33: سرویس جامع و واحد ثبت پرداخت حقوق — پشتیبانی کامل از پرداخت‌های چندمرحله‌ای (قسطی / جزئی)
// قواعد DB-008: کل زنجیره (قفل فیش + tx خزانه + voucher تسویه + بروزرسانی وضعیت) داخل یک database transaction است.
export interface RegisterPayrollPaymentInput {
  payrollId: number;
  bankAccountId: number;
  method?: 'cash' | 'bank_transfer' | 'pos' | 'cheque';
  amount?: number;
  paymentDate?: string;
  paymentReference?: string;
  notes?: string;
  userId?: number;
  username?: string;
}

export interface RegisterPayrollPaymentResult {
  payroll: typeof pieceworkPayrolls.$inferSelect;
  transactionNumber: string;
  transactionId: number;
  voucherId: number | null;
  voucherNumber: number | string | null;
  paidAmount: number;
  remainingAmount: number;
  isFullyPaid: boolean;
}

export class PayrollPaymentService {
  /**
   * V4.0.33: استعلام مانده مساعده تسویه‌نشده پرسنل از دفتر کل حسابداری و تراکنش‌های خزانه
   */
  static async getPersonnelAdvanceBalance(personnelId: number, tx?: DbExecutor): Promise<{
    personnelId: number;
    totalAdvances: number;
    totalDeducted: number;
    outstandingAdvance: number;
  }> {
    const executor = tx || orm;

    // ۱. بررسی اقلام ثبت‌شده در حساب معین مساعده پرسنلی (1301)
    const advanceAcc = await AccountMappingService.getEmployeeAdvanceAccount(executor);
    let ledgerDebits = 0;
    let ledgerCredits = 0;
    let hasLedgerEntries = false;

    if (advanceAcc) {
      const items = await executor
        .select({
          debit: journalVoucherItems.debit,
          credit: journalVoucherItems.credit
        })
        .from(journalVoucherItems)
        .innerJoin(journalVouchers, eq(journalVoucherItems.voucherId, journalVouchers.id))
        .where(and(
          eq(journalVoucherItems.accountId, advanceAcc.id),
          eq(journalVoucherItems.detailedType, 'personnel'),
          eq(journalVoucherItems.detailedId, personnelId),
          eq(journalVouchers.isDeleted, 0)
        ));

      if (items.length > 0) {
        hasLedgerEntries = true;
        for (const item of items) {
          ledgerDebits += Number(item.debit) || 0;
          ledgerCredits += Number(item.credit) || 0;
        }
      }
    }

    if (hasLedgerEntries) {
      const outstanding = Math.max(0, ledgerDebits - ledgerCredits);
      return {
        personnelId,
        totalAdvances: ledgerDebits,
        totalDeducted: ledgerCredits,
        outstandingAdvance: outstanding
      };
    }

    // ۲. در صورت نبود سند در دفتر، استفاده از تراکنش‌های خزانه‌ای مساعده منهای کسورات ثبت‌شده در فیش‌ها
    const treasuryAdvances = await executor
      .select({ amount: treasuryTransactions.amount })
      .from(treasuryTransactions)
      .where(and(
        eq(treasuryTransactions.type, 'payment'),
        eq(treasuryTransactions.partyType, 'personnel'),
        eq(treasuryTransactions.partyId, personnelId),
        eq(treasuryTransactions.isDeleted, 0),
        eq(treasuryTransactions.status, 'completed'),
        or(
          isNull(treasuryTransactions.payrollId),
          like(treasuryTransactions.description, '%مساعده%')
        )
      ));

    const totalAdv = treasuryAdvances.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    const pastPayrolls = await executor
      .select({ advanceDeduction: pieceworkPayrolls.advanceDeduction })
      .from(pieceworkPayrolls)
      .where(and(
        eq(pieceworkPayrolls.personnelId, personnelId),
        eq(pieceworkPayrolls.isDeleted, 0),
        inArray(pieceworkPayrolls.status, ['approved', 'partially_paid', 'paid'])
      ));

    const totalDed = pastPayrolls.reduce((sum, p) => sum + (Number(p.advanceDeduction) || 0), 0);
    const outstanding = Math.max(0, totalAdv - totalDed);

    return {
      personnelId,
      totalAdvances: totalAdv,
      totalDeducted: totalDed,
      outstandingAdvance: outstanding
    };
  }

  /**
   * V4.0.33: ثبت پرداخت حقوق — پشتیبانی کامل از پرداخت‌های چندمرحله‌ای (قسطی / جزئی)
   */
  static async registerPayrollPayment(input: RegisterPayrollPaymentInput): Promise<RegisterPayrollPaymentResult> {
    return await orm.transaction(async (tx) => {
      // V1.4.0: ترتیب واقعی قفل: بانک (سطح ۱۰) اول، سپس فیش حقوقی (سطح ۳۰)
      await withOrderedLocks(tx, [
        { table: bankAccounts, id: input.bankAccountId, name: 'bank_account', level: LockHierarchyLevel.BANK_ACCOUNTS },
        { table: pieceworkPayrolls, id: input.payrollId, name: 'piecework_payrolls', level: LockHierarchyLevel.PARTIES }
      ], async () => true);

      // ۱. حساب بانکی / صندوق
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.isDeleted, 0)));
      if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');
      if (!bank.accountId) {
        throw new ValidationError('برای این حساب بانکی/صندوق، حساب معین در چارت حساب‌ها تعریف نشده است؛ ابتدا آن را در بخش کدینگ متصل کنید.');
      }

      if (bank.currency && bank.currency !== 'IRR') {
        throw new ValidationError(`پرداخت حقوق فقط با حساب ریالی امکان‌پذیر است (حساب انتخاب‌شده «${bank.title}» ارز ${bank.currency} دارد).`);
      }

      // ۲. فیش حقوقی
      const [payroll] = await tx
        .select()
        .from(pieceworkPayrolls)
        .where(and(eq(pieceworkPayrolls.id, input.payrollId), eq(pieceworkPayrolls.isDeleted, 0)));

      if (!payroll) throw new NotFoundError('فیش حقوقی یافت نشد');

      if (payroll.status === 'paid') {
        throw new ConflictError(
          `فیش ${payroll.payrollNumber} قبلاً به‌طور کامل در تاریخ «${payroll.paymentDate || '—'}» تسویه شده است. ثبت پرداخت مجدد مجاز نیست.`
        );
      }

      if (!['approved', 'partially_paid', 'draft'].includes(payroll.status)) {
        throw new ConflictError(`وضعیت فعلی فیش (${payroll.status}) اجازه ثبت پرداخت ندارد.`);
      }

      // ۳. پرسنل
      const [pers] = await tx
        .select({ id: personnel.id, fullName: personnel.fullName })
        .from(personnel)
        .where(eq(personnel.id, payroll.personnelId));

      // ۴. محاسبات مبالغ با دقت اعشاری و اعتبارسنجی
      const netPayable = fin(Number(payroll.netPayable) || 0);
      const alreadyPaid = fin(Number(payroll.paidAmount) || 0);
      const remainingAmount = netPayable.subtract(alreadyPaid).round(4);

      if (remainingAmount.lessThanOrEqual(0)) {
        throw new ConflictError(`فیش ${payroll.payrollNumber} مانده قابل پرداختی ندارد و قبلاً تسویه شده است.`);
      }

      const payAmount = input.amount !== undefined ? fin(input.amount).round(4) : remainingAmount;

      if (payAmount.lessThanOrEqual(0)) {
        throw new ValidationError('مبلغ پرداختی باید بزرگ‌تر از صفر باشد.');
      }

      if (payAmount.greaterThan(remainingAmount)) {
        throw new ValidationError(
          `مبلغ پرداختی (${payAmount.toNumber().toLocaleString('fa-IR')} ریال) نمی‌تواند از مانده قابل پرداخت فیش (${remainingAmount.toNumber().toLocaleString('fa-IR')} ریال) بیشتر باشد.`
        );
      }

      // ۵. کنترل موجودی حساب بانکی
      const currentBal = fin(Number(bank.currentBalance) || 0);
      const newBal = currentBal.subtract(payAmount).round(4);
      if (newBal.isNegative()) {
        throw new ValidationError(
          `مانده حساب «${bank.title}» برای این پرداخت کافی نیست (مانده فعلی: ${currentBal.toNumber().toLocaleString('fa-IR')} ریال)`
        );
      }
      await tx.update(bankAccounts).set({ currentBalance: newBal.toNumber() }).where(eq(bankAccounts.id, bank.id));

      // ۶. شماره تراکنش اتمیک
      const txNum = await TreasuryTransactionService.generateTransactionNumber('payment', tx);

      // ۷. سند حسابداری دوبل پرداخت حقوق:
      // بدهکار: حقوق و دستمزد پرداختنی (3201) معادل مبلغ پرداختی (payAmount)
      // بستانکار: حساب بانکی / صندوق معادل مبلغ پرداختی (payAmount)
      const payableAcc = await AccountMappingService.getWagesPayableAccount(tx);
      if (!payableAcc) {
        throw new NotFoundError('حساب معین «حقوق و دستمزد پرداختنی» (3201) در چارت حساب‌ها یافت نشد');
      }

      const newTotalPaid = alreadyPaid.add(payAmount).round(4);
      const isFullyPaid = newTotalPaid.greaterThanOrEqual(netPayable);
      const nextStatus = isFullyPaid ? 'paid' : 'partially_paid';
      const payDate = (input.paymentDate && input.paymentDate.trim()) || await businessTodayJalaliDash();

      const descText = isFullyPaid
        ? `تسویه نهایی ${input.method === 'cash' ? 'نقدی' : input.method === 'pos' ? 'کارتخوان' : 'بانکی'} حقوق ${pers?.fullName || ''} فیش ${payroll.payrollNumber}`
        : `پرداخت مرحله‌ای (قسطی) حقوق ${pers?.fullName || ''} بابت فیش ${payroll.payrollNumber} (مانده پس از پرداخت: ${netPayable.subtract(newTotalPaid).toNumber().toLocaleString('fa-IR')} ریال)`;

      const voucher = await VoucherService.createJournalVoucher({
        date: payDate,
        voucherType: 'treasury',
        description: descText,
        referenceModule: 'payroll_payment',
        referenceId: payroll.id,
        referenceNumber: txNum,
        currency: 'IRR',
        userId: input.userId,
        username: input.username,
        items: [
          {
            accountId: payableAcc.id,
            detailedType: 'personnel',
            detailedId: payroll.personnelId,
            detailedName: pers?.fullName || 'پرسنل',
            debit: payAmount.toNumber(),
            credit: 0,
            currency: 'IRR',
            description: `کاهش تعهد پرداخت حقوق به ${pers?.fullName || ''} بابت فیش ${payroll.payrollNumber}`
          },
          {
            accountId: bank.accountId,
            detailedType: 'bank_account',
            detailedId: bank.id,
            detailedName: bank.title,
            debit: 0,
            credit: payAmount.toNumber(),
            currency: 'IRR',
            description: `خروج وجه از ${bank.title} بابت پرداخت فیش ${payroll.payrollNumber}`
          }
        ]
      }, tx);

      // ۸. درج تراکنش خزانه
      const [tr] = await tx.insert(treasuryTransactions).values({
        transactionNumber: txNum,
        type: 'payment',
        date: payDate.trim(),
        method: input.method || 'bank_transfer',
        amount: payAmount.toNumber(),
        currency: 'IRR',
        exchangeRate: 1,
        bankAccountId: bank.id,
        partyType: 'personnel',
        partyId: payroll.personnelId,
        partyName: pers?.fullName || '',
        trackingNumber: input.paymentReference?.trim() || '',
        voucherId: voucher?.id ?? null,
        payrollId: payroll.id,
        description: input.notes?.trim() || descText,
        status: 'completed',
        createdById: input.userId || null
      }).returning();

      // ۹. رویداد دامنه اتمیک (Outbox)
      const evt = domainEventBus.createEvent(
        DomainEventType.TREASURY_TRANSACTION_APPROVED,
        'Treasury',
        String(tr.id),
        {
          transactionId: tr.id,
          type: 'withdrawal',
          amount: payAmount.toNumber(),
          currency: 'IRR',
          accountId: bank.id,
          accountName: bank.title,
          payrollId: payroll.id,
          payrollNumber: payroll.payrollNumber,
          isFullyPaid,
          remainingAmount: netPayable.subtract(newTotalPaid).toNumber(),
          description: input.notes || descText
        },
        { userId: input.userId, userName: input.username }
      );
      await OutboxService.saveToOutbox(tx, evt);

      // ۱۰. بروزرسانی فیش حقوقی
      await tx.update(pieceworkPayrolls).set({
        paidAmount: newTotalPaid.toNumber(),
        status: nextStatus,
        paymentDate: payDate,
        paymentMethod: input.method || 'bank_transfer',
        paymentReference: input.paymentReference?.trim() || payroll.paymentReference
      }).where(eq(pieceworkPayrolls.id, payroll.id));

      // ۱۱. فقط در صورت تسویه کامل، لاگ‌های پرکیسی علامت paid می‌گیرند
      if (isFullyPaid) {
        await tx.update(pieceworkLogs)
          .set({ status: 'paid' })
          .where(eq(pieceworkLogs.payrollId, payroll.id));
      }

      const updatedPayroll = {
        ...payroll,
        paidAmount: newTotalPaid.toNumber(),
        status: nextStatus,
        paymentDate: payDate,
        paymentMethod: input.method || 'bank_transfer',
        paymentReference: input.paymentReference?.trim() || payroll.paymentReference
      };

      return {
        payroll: updatedPayroll,
        transactionNumber: txNum,
        transactionId: tr.id,
        voucherId: voucher?.id ?? null,
        voucherNumber: voucher?.voucherNumber ?? null,
        paidAmount: payAmount.toNumber(),
        remainingAmount: netPayable.subtract(newTotalPaid).toNumber(),
        isFullyPaid
      };
    });
  }
}
