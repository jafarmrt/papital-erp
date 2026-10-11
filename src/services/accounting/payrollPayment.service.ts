import { orm, type DbExecutor } from '../../db/drizzle.js';
import { assertPayrollDutyNotByIssuer } from '../piecework/payrollDuties.js';
import {
  bankAccounts,
  treasuryTransactions,
  pieceworkPayrolls,
  pieceworkLogs,
  personnel,
  journalVouchers,
  journalVoucherItems
} from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { VoucherService } from './voucher.service.js';
import { AccountMappingService } from './accountMapping.service.js';
import { TreasuryTransactionService } from './treasury/treasuryTransaction.service.js';
import { payrollVouchersWhere, pickPayrollVoucher } from './payrollVoucherLink.js';
import { isPayablePayrollStatus } from '../../lib/payroll/payrollPayable.js';
import { LockHierarchyLevel, withOrderedLocks } from '../../lib/lockOrder.js';
import { domainEventBus } from '../events/domainEventBus.js';
import { DomainEventType } from '../events/domainEvents.js';
import { OutboxService } from '../events/outboxService.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { isoToJalaliDate } from '../../utils.js';
import { resolveTreasuryWriteDate } from './treasury/treasuryDate.js';
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
   * V4.0.33: استعلام مانده مساعده تسویه‌نشده پرسنل از دفتر کل حسابداری.
   * v9.0.267 (TD-807، B12P-04): مانده فقط از ردیف‌های «مساعده پرسنل» (نگاشت ۱۳۰۱) با تفصیلی همین پرسنل خوانده می‌شود؛ نبود
   * ردیف یعنی صفر. پیش‌تر برای پرسنل بی ردیف ۱۳۰۱ هر پرداخت خزانه‌ای بی فیش یا با شرح «مساعده» مساعده شمرده می‌شد، حتی
   * پرداخت «تسویه حقوق»، پس نگهبان TD-282 دور زده می‌شد و کسر مساعده ۱۳۰۱ را منفی می‌کرد.
   */
  static async getPersonnelAdvanceBalance(personnelId: number, tx?: DbExecutor): Promise<{
    personnelId: number;
    totalAdvances: number;
    totalDeducted: number;
    outstandingAdvance: number;
  }> {
    const executor = tx || orm;
    const advanceAcc = await AccountMappingService.getEmployeeAdvanceAccount(executor);
    let ledgerDebits = fin(0);
    let ledgerCredits = fin(0);

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
          eq(journalVouchers.isDeleted, 0),
          // v8.0.15 (TD-270): ردیف حذف نرم‌شده (ویرایش یا همگام‌سازی دوباره سند پیش‌نویس) مساعده را دو بار نمی‌شمارد
          eq(journalVoucherItems.isDeleted, 0)
        ));
      for (const item of items) {
        ledgerDebits = ledgerDebits.add(item.debit);
        ledgerCredits = ledgerCredits.add(item.credit);
      }
    }

    const outstanding = ledgerDebits.subtract(ledgerCredits);
    return {
      personnelId,
      totalAdvances: ledgerDebits.toNumber(),
      totalDeducted: ledgerCredits.toNumber(),
      outstandingAdvance: outstanding.isNegative() ? 0 : outstanding.toNumber()
    };
  }

  /**
   * V4.0.33: ثبت پرداخت حقوق — پشتیبانی کامل از پرداخت‌های چندمرحله‌ای (قسطی / جزئی)
   */
  static async registerPayrollPayment(input: RegisterPayrollPaymentInput): Promise<RegisterPayrollPaymentResult> {
    // v8.0.120 (TD-411، تصمیم مالک محصول — گزینه الف، مثل TD-278): روش «چک» در پرداخت حقوق پذیرفته نمی‌شود. پیش‌تر
    // فقط برچسب بود: بانک همان روز بستانکار می‌شد و چکی در دفتر چک ثبت نمی‌شد که سررسید، وصول یا برگشت داشته باشد.
    // پرداخت‌های چکی پیشین ابطال‌پذیرند.
    if (input.method === 'cheque') {
      throw new ValidationError('روش «چک» در پرداخت حقوق پذیرفته نمی‌شود؛ حقوق را با انتقال بانکی، نقدی یا کارتخوان پرداخت کنید.');
    }
    // v9.0.461 (TD-927، P5-W04): تاریخ پرداخت حقوق همان قاعده تاریخ نوشتن خزانه را دارد (`resolveTreasuryWriteDate`):
    // خالی ← امروز کسب‌وکار، روز ناموجود ← 422 و تاریخ پس از امروز ← 422 `TREASURY_DATE_IN_FUTURE`، پیش از هر نوشتن.
    // پیش‌تر فقط `requireStorageDate` بود و پرداخت آینده‌دار مانده بانک، ردیف خزانه و سند حسابداری را با تاریخ آینده می‌نوشت.
    const payIso = await resolveTreasuryWriteDate(input.paymentDate, 'تاریخ پرداخت');
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
          `فیش ${payroll.payrollNumber} قبلاً به‌طور کامل در تاریخ «${isoToJalaliDate(payroll.paymentDate) || payroll.paymentDate || '—'}» تسویه شده است. ثبت پرداخت مجدد مجاز نیست.`
        );
      }

      // v9.0.269 (TD-816): فیش پیش‌نویس پرداخت نمی‌شود؛ پیش‌تر «draft» هم پذیرفته می‌شد
      if (payroll.status === 'draft') {
        throw new ConflictError(`فیش ${payroll.payrollNumber} پیش‌نویس است؛ پیش از ثبت پرداخت آن را تأیید کنید.`, undefined, 'PAYROLL_NOT_APPROVED');
      }
      if (!isPayablePayrollStatus(payroll.status)) {
        throw new ConflictError(`وضعیت فعلی فیش (${payroll.status}) اجازه ثبت پرداخت ندارد.`);
      }
      // v10.0.182 (TD-1084، طرح حقوق ت۲ و ت۳ الف): صادرکننده فیش آن را پرداخت نمی‌کند؛ مدیر سیستم مستثناست
      await assertPayrollDutyNotByIssuer(tx, payroll, input.userId, 'pay');

      // v9.0.266 (TD-804): فیش بی سند حسابداری زنده پرداخت نمی‌شود. پیش‌تر پرداخت آن ۳۲۰۱ را بدهکار و بانک را بستانکار
      // می‌کرد بی آنکه هزینه یا بدهی حقوقی در دفتر باشد. فیش قدیمی بی سند ابتدا با «همگام‌سازی سند» سند می‌گیرد.
      const voucherCandidates = await tx
        .select({
          id: journalVouchers.id,
          sourcePayrollId: journalVouchers.sourcePayrollId,
          referenceId: journalVouchers.referenceId,
          referenceNumber: journalVouchers.referenceNumber,
          voucherType: journalVouchers.voucherType,
        })
        .from(journalVouchers)
        .where(payrollVouchersWhere(payroll.id, payroll.payrollNumber));
      if (!pickPayrollVoucher(voucherCandidates, payroll.id, payroll.payrollNumber)) {
        throw new ConflictError(
          `فیش ${payroll.payrollNumber} سند حسابداری ندارد؛ پیش از پرداخت، سند آن را با «همگام‌سازی سند» صادر کنید.`,
          undefined,
          'PAYROLL_WITHOUT_VOUCHER'
        );
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
      const currentBal = fin(bank.currentBalance);
      const newBal = currentBal.subtract(payAmount).round(4);
      if (newBal.isNegative()) {
        throw new ValidationError(
          `مانده حساب «${bank.title}» برای این پرداخت کافی نیست (مانده فعلی: ${currentBal.toNumber().toLocaleString('fa-IR')} ریال)`
        );
      }
      await tx.update(bankAccounts).set({ currentBalance: money(newBal) }).where(eq(bankAccounts.id, bank.id));

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
      // v7.0.134 (TD-232): تاریخ پرداخت فیش و تراکنش خزانه میلادی ISO (سند حسابداری هم تاریخ را ISO می‌کند)؛
      // از v9.0.461 (TD-927) پیش از تراکنش با `resolveTreasuryWriteDate` خوانده می‌شود.

      const descText = isFullyPaid
        ? `تسویه نهایی ${input.method === 'cash' ? 'نقدی' : input.method === 'pos' ? 'کارتخوان' : 'بانکی'} حقوق ${pers?.fullName || ''} فیش ${payroll.payrollNumber}`
        : `پرداخت مرحله‌ای (قسطی) حقوق ${pers?.fullName || ''} بابت فیش ${payroll.payrollNumber} (مانده پس از پرداخت: ${netPayable.subtract(newTotalPaid).toNumber().toLocaleString('fa-IR')} ریال)`;

      const voucher = await VoucherService.createJournalVoucher({
        date: payIso,
        voucherType: 'treasury',
        status: 'draft',
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
        // v7.0.74: تاریخ تراکنش خزانه ISO است (TD-105)؛ تاریخ پرداخت فیش شمسی می‌ماند
        date: payIso,
        method: input.method || 'bank_transfer',
        amount: money(payAmount),
        currency: 'IRR',
        exchangeRate: money(1),
        bankAccountId: bank.id,
        partyType: 'personnel',
        partyId: payroll.personnelId,
        partyName: pers?.fullName || '',
        // v9.0.82 (TD-507): هدف پرداخت پرسنل ذخیره می‌شود؛ پرداخت فیش تسویه حقوق است
        purpose: 'settlement',
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
        paidAmount: money(newTotalPaid),
        status: nextStatus,
        paymentDate: payIso,
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
        paidAmount: money(newTotalPaid),
        status: nextStatus,
        paymentDate: payIso,
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
