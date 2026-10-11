import { and, eq, sql } from 'drizzle-orm';
import { assertPayrollDutyNotByIssuer } from '../piecework/payrollDuties.js';
import { orm } from '../../db/drizzle.js';
import { bankAccounts, pieceworkLogs, pieceworkPayrolls, treasuryTransactions } from '../../db/schema.js';
import { VoucherService } from './voucher.service.js';
import { TreasuryTransactionService } from './treasury/treasuryTransaction.service.js';
import { LockHierarchyLevel, withOrderedLocks } from '../../lib/lockOrder.js';
import { fin } from '../../lib/financialDecimal.js';
import { money, moneyOr } from '../../lib/money.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';

export interface VoidPayrollPaymentInput {
  payrollId: number;
  transactionId: number;
  reason: string;
  userId?: number;
  username?: string;
}

export interface VoidPayrollPaymentResult {
  payroll: typeof pieceworkPayrolls.$inferSelect;
  transactionNumber: string;
  reversalTransactionNumber: string;
  reversalVoucherId: number | null;
  paidAmount: number;
}

/**
 * v8.0.31 (TD-283، تصمیم مالک محصول — گزینه الف): ابطال یک پرداخت فیش حقوق. پیش‌تر پرداخت فیش ابطال‌پذیر نبود: ابطال
 * تراکنش خزانه آن رد می‌شد و فیش پرداخت‌شده هم حذف نمی‌شد؛ پرداخت اشتباه فقط با سند دستی اصلاح می‌شد.
 *
 * همه در یک تراکنش پایگاه‌داده، با ترتیب قفل حساب بانکی (۱۰) ← فیش (۳۰) ← تراکنش خزانه (۸۰):
 *   ۱) مانده حساب بانکی به‌اندازه پرداخت برمی‌گردد؛
 *   ۲) سند پرداخت با قاعده مشترک ابطال (voidSourceVoucher) باطل می‌شود: پیش‌نویس حذف نرم، تأییدشده سند معکوس؛
 *   ۳) تراکنش معکوس خزانه (دریافت، reversal_of_id) ثبت و پرداخت اصلی «voided» می‌شود؛
 *   ۴) مبلغ پرداخت‌شده فیش کم می‌شود و وضعیت آن «partially_paid» یا (بی‌پرداخت) «approved» و کارکردهای «paid» آن «approved» می‌شوند.
 * فیشی که همه پرداخت‌هایش ابطال شده، از مسیر «حذف فیش» ابطال‌پذیر است.
 */
export class PayrollPaymentVoidService {
  static async voidPayrollPayment(input: VoidPayrollPaymentInput): Promise<VoidPayrollPaymentResult> {
    const reason = (input.reason || '').trim();
    if (!reason) throw new ValidationError('دلیل ابطال پرداخت الزامی است');

    return orm.transaction(async (tx) => {
      const findPayment = async () => {
        const [row] = await tx.select().from(treasuryTransactions)
          .where(and(eq(treasuryTransactions.id, input.transactionId), eq(treasuryTransactions.isDeleted, 0)));
        return row;
      };
      const located = await findPayment();
      if (!located || located.payrollId !== input.payrollId || located.type !== 'payment' || located.reversalOfId !== null) {
        throw new NotFoundError('پرداختی با این شناسه برای این فیش حقوق یافت نشد');
      }

      await withOrderedLocks(tx, [
        { table: bankAccounts, id: located.bankAccountId ?? 0, name: 'bank_account', level: LockHierarchyLevel.BANK_ACCOUNTS },
        { table: pieceworkPayrolls, id: input.payrollId, name: 'piecework_payrolls', level: LockHierarchyLevel.PARTIES },
        { table: treasuryTransactions, id: located.id, name: 'treasury_transactions', level: LockHierarchyLevel.TREASURY_TRANSACTIONS },
      ], async () => true);

      const payment = await findPayment();
      if (!payment) throw new NotFoundError('پرداختی با این شناسه برای این فیش حقوق یافت نشد');
      if (payment.status === 'voided') throw new ConflictError(`پرداخت ${payment.transactionNumber} قبلاً ابطال شده است`);

      const [payroll] = await tx.select().from(pieceworkPayrolls)
        .where(and(eq(pieceworkPayrolls.id, input.payrollId), eq(pieceworkPayrolls.isDeleted, 0)));
      if (!payroll) throw new NotFoundError('فیش حقوقی یافت نشد');
      // v10.0.182 (TD-1084): صادرکننده فیش پرداخت آن را ابطال هم نمی‌کند؛ مدیر سیستم مستثناست
      await assertPayrollDutyNotByIssuer(tx, payroll, input.userId, 'pay');
      const [bank] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, payment.bankAccountId ?? 0));
      if (!bank) throw new NotFoundError('حساب بانکی پرداخت یافت نشد');

      const amount = fin(payment.amount);
      // ۱) مانده حساب بانکی
      await tx.update(bankAccounts).set({ currentBalance: money(fin(bank.currentBalance).add(amount)) }).where(eq(bankAccounts.id, bank.id));

      // ۲) سند پرداخت
      const voidReason = `ابطال پرداخت ${payment.transactionNumber} فیش ${payroll.payrollNumber} — ${reason}`;
      let reversalVoucherId: number | null = null;
      if (payment.voucherId) {
        const voided = await VoucherService.voidSourceVoucher({
          voucherId: payment.voucherId,
          reason: voidReason,
          userId: input.userId,
          username: input.username,
          externalTx: tx,
        });
        reversalVoucherId = voided.reversalVoucherId;
      }

      // ۳) تراکنش معکوس خزانه
      const reversalNumber = await TreasuryTransactionService.generateTransactionNumber('receipt', tx);
      await tx.insert(treasuryTransactions).values({
        transactionNumber: reversalNumber,
        type: 'receipt',
        date: await businessTodayIsoDate(),
        method: payment.method,
        amount: money(amount),
        currency: payment.currency || 'IRR',
        exchangeRate: moneyOr(payment.exchangeRate, 1),
        bankAccountId: payment.bankAccountId,
        partyType: payment.partyType,
        partyId: payment.partyId,
        partyName: payment.partyName,
        purpose: payment.purpose,
        trackingNumber: payment.trackingNumber || '',
        voucherId: reversalVoucherId,
        payrollId: payroll.id,
        reversalOfId: payment.id,
        description: `${voidReason}`,
        status: 'completed',
        createdById: input.userId || null,
      });
      await tx.update(treasuryTransactions).set({ status: 'voided', updatedAt: sql`now()` }).where(eq(treasuryTransactions.id, payment.id));

      // ۴) فیش و کارکردها
      const remainingPaid = fin(payroll.paidAmount ?? 0).subtract(amount);
      const paidAmount = remainingPaid.isNegative() ? fin(0) : remainingPaid;
      const status = paidAmount.isPositive() ? 'partially_paid' : 'approved';
      const [updated] = await tx.update(pieceworkPayrolls).set({
        paidAmount: money(paidAmount),
        status,
        ...(paidAmount.isPositive() ? {} : { paymentDate: '', paymentMethod: '', paymentReference: '' }),
      }).where(eq(pieceworkPayrolls.id, payroll.id)).returning();
      await tx.update(pieceworkLogs).set({ status: 'approved' })
        .where(and(eq(pieceworkLogs.payrollId, payroll.id), eq(pieceworkLogs.status, 'paid')));

      return {
        payroll: updated,
        transactionNumber: payment.transactionNumber,
        reversalTransactionNumber: reversalNumber,
        reversalVoucherId,
        paidAmount: paidAmount.toNumber(),
      };
    });
  }
}
