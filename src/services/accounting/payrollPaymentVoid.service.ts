import { and, eq } from 'drizzle-orm';
import { assertPayrollDutyNotByIssuer } from '../piecework/payrollDuties.js';
import { orm } from '../../db/drizzle.js';
import { bankAccounts, pieceworkLogs, pieceworkPayrolls, treasuryTransactions } from '../../db/schema.js';
import { VoucherService } from './voucher.service.js';
import { reverseTreasuryRow } from './treasury/treasuryPosting.js';
import { LockHierarchyLevel, validateLockOrder } from '../../lib/lockOrder.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { auditPayrollPaymentVoided } from '../piecework/pieceworkAudit.js';
import { payrollTreasuryEventPayload, recordPayrollEvent } from '../piecework/payrollEvents.js';

export interface VoidPayrollPaymentInput {
  payrollId: number;
  transactionId: number;
  reason: string;
  userId?: number;
  username?: string;
  /** v10.0.259 (TD-950): درخواست، برای کاربر و IP ردیف ممیزی */
  req?: unknown;
}

export interface VoidPayrollPaymentResult {
  payroll: typeof pieceworkPayrolls.$inferSelect;
  transactionNumber: string;
  reversalTransactionNumber: string;
  reversalVoucherId: number | null;
  paidAmount: number;
  /** OBS-R2-51: the voided payment's currency, which the route's message names */
  currency: string;
}

/**
 * v8.0.31 (TD-283، تصمیم مالک محصول — گزینه الف): ابطال یک پرداخت فیش حقوق. پیش‌تر پرداخت فیش ابطال‌پذیر نبود: ابطال
 * تراکنش خزانه آن رد می‌شد و فیش پرداخت‌شده هم حذف نمی‌شد؛ پرداخت اشتباه فقط با سند دستی اصلاح می‌شد.
 *
 * همه در یک تراکنش پایگاه‌داده، با ترتیب قفل حساب بانکی (۱۰) ← فیش (۳۰) ← تراکنش خزانه (۸۰):
 *   ۱) سند پرداخت با قاعده مشترک ابطال (voidSourceVoucher) باطل می‌شود: پیش‌نویس حذف نرم، تأییدشده سند معکوس؛
 *   ۲) از راه مشترک خزانه (v10.2.1، OBS-R2-52) مانده حساب بانکی به‌اندازه پرداخت برمی‌گردد، تراکنش معکوس خزانه (دریافت،
 *      reversal_of_id) ثبت و پرداخت اصلی «voided» می‌شود؛
 *   ۳) مبلغ پرداخت‌شده فیش کم می‌شود و وضعیت آن «partially_paid» یا (بی‌پرداخت) «approved» و کارکردهای «paid» آن «approved» می‌شوند.
 * فیشی که همه پرداخت‌هایش ابطال شده، از مسیر «حذف فیش» ابطال‌پذیر است.
 */
export class PayrollPaymentVoidService {
  static async voidPayrollPayment(input: VoidPayrollPaymentInput): Promise<VoidPayrollPaymentResult> {
    const reason = (input.reason || '').trim();
    if (!reason) throw new ValidationError('دلیل ابطال پرداخت الزامی است');

    return orm.transaction(async (tx) => {
      const [located] = await tx.select().from(treasuryTransactions)
        .where(and(eq(treasuryTransactions.id, input.transactionId), eq(treasuryTransactions.isDeleted, 0)));
      if (!located || located.payrollId !== input.payrollId || located.type !== 'payment' || located.reversalOfId !== null) {
        throw new NotFoundError('پرداختی با این شناسه برای این فیش حقوق یافت نشد');
      }

      // قفل‌ها به ترتیب اعلام‌شده: حساب بانکی (۱۰، قفل راه مشترک خزانه) ← فیش (۳۰) ← تراکنش خزانه (۸۰)
      validateLockOrder([
        { name: 'bankAccount', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
        { name: 'payroll', hierarchyLevel: LockHierarchyLevel.PARTIES },
        { name: 'treasuryTransaction', hierarchyLevel: LockHierarchyLevel.TREASURY_TRANSACTIONS },
      ]);
      const [bank] = await tx.select().from(bankAccounts)
        .where(eq(bankAccounts.id, located.bankAccountId ?? 0))
        .for('update');
      if (!bank) throw new NotFoundError('حساب بانکی پرداخت یافت نشد');
      const [payroll] = await tx.select().from(pieceworkPayrolls)
        .where(and(eq(pieceworkPayrolls.id, input.payrollId), eq(pieceworkPayrolls.isDeleted, 0)))
        .for('update');
      const [payment] = await tx.select().from(treasuryTransactions)
        .where(and(eq(treasuryTransactions.id, located.id), eq(treasuryTransactions.isDeleted, 0)))
        .for('update');
      if (!payment) throw new NotFoundError('پرداختی با این شناسه برای این فیش حقوق یافت نشد');
      if (payment.status === 'voided') throw new ConflictError(`پرداخت ${payment.transactionNumber} قبلاً ابطال شده است`);

      if (!payroll) throw new NotFoundError('فیش حقوقی یافت نشد');
      // v10.0.193 (TD-1084): صادرکننده فیش پرداخت آن را ابطال هم نمی‌کند؛ مدیر سیستم مستثناست
      await assertPayrollDutyNotByIssuer(tx, payroll, input.userId, 'pay');

      const amount = fin(payment.amount);

      // ۱) سند پرداخت
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

      // ۲) v10.2.1 (OBS-R2-52): ابطال از راه مشترک خزانه (`reverseTreasuryRow`)، همان راه ابطال تراکنش خزانه: مانده حساب
      // برمی‌گردد (پرداخت قدیمی با روش «چک» هم، چون بانک را بستانکار کرده بود)، تراکنش معکوس خزانه (دریافت، reversal_of_id،
      // با پیوند همین فیش) ثبت، پرداخت اصلی «voided» و رویداد آن (v10.0.259، TD-949) در همین تراکنش در صف ارسال نوشته می‌شود.
      const reversal = await reverseTreasuryRow(tx, payment, bank, {
        reversalVoucherId,
        description: voidReason,
        createdById: input.userId || null,
        // v10.1.66: no amount and no reason text (a salary is for payroll readers only)
        event: (row) => payrollTreasuryEventPayload({
          transactionId: row.id, type: 'deposit', currency: payment.currency || 'IRR', bank, payroll,
          voided: { transactionId: payment.id, transactionNumber: payment.transactionNumber },
        }),
        actor: { userId: input.userId, username: input.username },
      });
      const reversalNumber = reversal.transactionNumber;

      // ۳) فیش و کارکردها
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
      // v10.0.259 (TD-950): ممیزی ابطال در همین تراکنش، با کاربر و IP و مبلغ
      await auditPayrollPaymentVoided(tx, updated, {
        transactionId: payment.id, transactionNumber: payment.transactionNumber, reversalTransactionNumber: reversalNumber,
        amount: amount.toString(), reason, reversalVoucherId, paidBefore: String(payroll.paidAmount ?? 0),
      }, { req: input.req, userId: input.userId, username: input.username });
      // v10.1.66 (ت۴۰): a subscriber that saw `PayrollPaid` hears the payment was voided, in the same transaction
      await recordPayrollEvent(tx, 'payment_voided', updated, { userId: input.userId, username: input.username }, {
        transactionId: reversal.id, voidedTransactionId: payment.id,
      });

      return {
        payroll: updated,
        transactionNumber: payment.transactionNumber,
        reversalTransactionNumber: reversalNumber,
        reversalVoucherId,
        paidAmount: paidAmount.toNumber(),
        currency: payment.currency || 'IRR',
      };
    });
  }
}
