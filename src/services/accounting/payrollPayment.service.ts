import { orm } from '../../db/drizzle.js';
import {
  bankAccounts,
  treasuryTransactions,
  pieceworkPayrolls,
  pieceworkLogs,
  personnel
} from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { VoucherService } from './voucher.service.js';
import { AccountMappingService } from './accountMapping.service.js';
import { TreasuryTransactionService } from './treasury/treasuryTransaction.service.js';
import { validateLockOrder, LockHierarchyLevel } from '../../lib/lockOrder.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { fin } from '../../lib/financialDecimal.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';

// V10-4.4: سرویس واحد ثبت پرداخت حقوق — منبع یگانه گذار status='paid'
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
  payroll: any;
  transactionNumber: string;
  transactionId: number;
  voucherId: number | null;
  voucherNumber: number | string | null;
}

function toJalaliToday(): string {
  try {
    const formatted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    return formatted.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

export class PayrollPaymentService {
  static async registerPayrollPayment(input: RegisterPayrollPaymentInput): Promise<RegisterPayrollPaymentResult> {
    return await orm.transaction(async (tx) => {
      // V1.4.0: ترتیب واقعی قفل مطابق سلسله‌مراتب — بانک (سطح ۱۰) اول، سپس فیش حقوقی
      validateLockOrder([
        { name: 'bank_account', hierarchyLevel: LockHierarchyLevel.BANK_ACCOUNTS },
        { name: 'piecework_payrolls', hierarchyLevel: LockHierarchyLevel.PARTIES }
      ]);

      // 1. قفل انحصاری حساب خزانه (سطح ۱۰) — همیشه قبل از فیش
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.isDeleted, 0)))
        .for('update');
      if (!bank) throw new NotFoundError('حساب بانکی یا صندوق انتخاب‌شده یافت نشد');
      if (!bank.accountId) {
        throw new ValidationError('برای این حساب بانکی/صندوق، حساب معین در چارت حساب‌ها تعریف نشده است؛ ابتدا آن را در بخش کدینگ متصل کنید.');
      }

      // V1.4.0: گارد هم‌ارزی — تسویه حقوق در این نسخه فقط با حساب ریالی
      if (bank.currency && bank.currency !== 'IRR') {
        throw new ValidationError(`تسویه حقوق فقط با حساب ریالی امکان‌پذیر است (حساب انتخاب‌شده «${bank.title}» ارز ${bank.currency} دارد).`);
      }

      // 2. قفل انحصاری فیش (سطح ۳۰) — جلوگیری از پرداخت همزمان/دوبل
      const [payroll] = await tx
        .select()
        .from(pieceworkPayrolls)
        .where(and(eq(pieceworkPayrolls.id, input.payrollId), eq(pieceworkPayrolls.isDeleted, 0)))
        .for('update');

      if (!payroll) throw new NotFoundError('فیش حقوقی یافت نشد');
      if (payroll.status === 'paid') {
        throw new ConflictError(
          `فیش ${payroll.payrollNumber} قبلاً در تاریخ «${payroll.paymentDate || '—'}» با روش ${payroll.paymentMethod || 'نامشخص'} و مرجع ${payroll.paymentReference || '—'} تسویه شده است. ثبت پرداخت دوباره مجاز نیست.`
        );
      }
      if (!['approved', 'draft'].includes(payroll.status)) {
        throw new ConflictError(`وضعیت فعلی فیش (${payroll.status}) اجازه ثبت پرداخت ندارد.`);
      }

      // 3. پرسنل (طرف حساب) — خواندن ساده بدون قفل
      const [pers] = await tx
        .select({ id: personnel.id, fullName: personnel.fullName })
        .from(personnel)
        .where(eq(personnel.id, payroll.personnelId));

      const netAmount = Number(input.amount ?? payroll.netPayable) || 0;
      if (netAmount <= 0) throw new ValidationError('مبلغ قابل پرداخت باید بزرگ‌تر از صفر باشد');

      const currentBal = Number(bank.currentBalance) || 0;
      const newBal = fin(currentBal).subtract(netAmount).round(4).toNumber();
      // V1.4.0: سیاست مانده منفی ممنوع
      if (newBal < 0) {
        throw new ValidationError(`مانده حساب «${bank.title}» برای این پرداخت کافی نیست (مانده فعلی: ${currentBal.toLocaleString('fa-IR')})`);
      }
      await tx.update(bankAccounts).set({ currentBalance: newBal }).where(eq(bankAccounts.id, bank.id));

      // 4. شماره تراکنش اتمیک (PostgreSQL SEQUENCE — نه MAX/COUNT)
      const txNum = await TreasuryTransactionService.generateTransactionNumber('payment', tx);

      // 5. voucher تسویه: بدهکار «حقوق پرداختنی» / بستانکار حساب بانکی
      const payableAcc = await AccountMappingService.getWagesPayableAccount(tx);
      if (!payableAcc) {
        throw new NotFoundError('حساب مفهومی «حقوق و دستمزد پرداختنی» (3201) در چارت حساب‌ها یافت نشد');
      }

      const payDate = (input.paymentDate && input.paymentDate.trim()) || toJalaliToday();
      const descText = `تسویه ${input.method === 'cash' ? 'نقدی' : input.method === 'pos' ? 'کارتخوان' : 'بانکی'} حقوق ${pers?.fullName || ''} فیش ${payroll.payrollNumber}`;

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
            debit: netAmount,
            credit: 0,
            currency: 'IRR',
            description: `تسویه مطالبات ${pers?.fullName || ''} بابت فیش ${payroll.payrollNumber}`
          },
          {
            accountId: bank.accountId,
            detailedType: 'bank_account',
            detailedId: bank.id,
            detailedName: bank.title,
            debit: 0,
            credit: netAmount,
            currency: 'IRR',
            description: `خروج وجه از ${bank.title} بابت پرداخت فیش ${payroll.payrollNumber}`
          }
        ]
      }, tx);

      // 6. درج تراکنش خزانه با لینک رسمی به فیش
      const [tr] = await tx.insert(treasuryTransactions).values({
        transactionNumber: txNum,
        type: 'payment',
        date: payDate.trim(),
        method: input.method || 'bank_transfer',
        amount: netAmount,
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

      // 7. رویداد دامنه اتمیک (Transactional Outbox)
      const evt = domainEventBus.createEvent(
        DomainEventType.TREASURY_TRANSACTION_APPROVED,
        'Treasury',
        String(tr.id),
        {
          transactionId: tr.id,
          type: 'withdrawal',
          amount: netAmount,
          currency: 'IRR',
          accountId: bank.id,
          accountName: bank.title,
          payrollId: payroll.id,
          payrollNumber: payroll.payrollNumber,
          description: input.notes || descText
        },
        { userId: input.userId, userName: input.username }
      );
      await OutboxService.saveToOutbox(tx, evt);

      // 8. گذار وضعیت در همان تراکنش + همگام‌سازی لاگ‌های فرزند
      await tx.update(pieceworkPayrolls).set({
        status: 'paid',
        paymentDate: payDate,
        paymentMethod: input.method || 'bank_transfer',
        paymentReference: input.paymentReference?.trim() || ''
      }).where(eq(pieceworkPayrolls.id, payroll.id));

      await tx.update(pieceworkLogs)
        .set({ status: 'paid' })
        .where(eq(pieceworkLogs.payrollId, payroll.id));

      return {
        payroll: { ...payroll, status: 'paid' as const },
        transactionNumber: txNum,
        transactionId: tr.id,
        voucherId: voucher?.id ?? null,
        voucherNumber: voucher?.voucherNumber ?? null
      };
    });
  }
}
