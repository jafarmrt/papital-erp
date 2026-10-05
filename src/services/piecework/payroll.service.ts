import { eq, and, sql, inArray, asc } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { pieceworkLogs, pieceworkPayrolls, personnel, journalVouchers } from '../../db/schema.js';
import { NotFoundError, BadRequestError, ConflictError, ValidationError } from '../../errors/customErrors.js';
import { isoToJalaliDate, toStorageDate } from '../../utils.js';
import { requireStorageDate } from '../../lib/storageDate.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { PayrollPaymentService } from '../accounting/payrollPayment.service.js';
import { computeFixedSalaryShares, describeFixedSalaryShares, priorFixedGrantsOf, type FixedSalaryMonthShare } from '../../lib/payroll/fixedSalaryProration.js';
import { isLegacyPayrollVoucher, payrollVouchersWhere } from '../accounting/payrollVoucherLink.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { workLogFreeOfLivePayroll } from './workLogPayrollLink.js';

/**
 * چرخه عمر فیش حقوقی پرکیسی: صدور، تغییر وضعیت، همگام‌سازی سند و ابطال.
 * هر متد تراکنش، قفل‌ها و پاسخ‌های خطای { status, error } پیشین روت را بدون تغییر نگه می‌دارد.
 */

type AmountInput = number | string;

/**
 * v8.0.28 (TD-281): تنها وضعیت‌هایی که دستی روی فیش تنظیم می‌شوند. «پرداخت‌شده» و «نیمه‌پرداخت» فقط از «ثبت پرداخت» و
 * ابطال فقط از «حذف فیش» است. پیش‌تر هر رشته‌ای پذیرفته می‌شد: «pending» کارکردهای فیش را دوباره در فیش بعدی می‌شمرد و
 * برگرداندن فیش پرداخت‌شده به «approved» ابطال آن را با پرداخت باقی‌مانده ممکن می‌کرد.
 */
const MANUAL_PAYROLL_STATUSES = new Set(['draft', 'approved']);

export interface GeneratePayrollInput {
  personnelId: AmountInput;
  startDate: string;
  endDate: string;
  title?: string;
  bonuses?: AmountInput;
  totalBonuses?: AmountInput;
  deductions?: AmountInput;
  totalDeductions?: AmountInput;
  advanceDeduction?: AmountInput;
  notes?: string;
  userId?: number;
  username: string;
}

export interface UpdatePayrollStatusInput {
  status?: string;
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  userId?: number;
  username: string;
}

export class PieceworkPayrollService {
  /** صدور فیش حقوقی جدید برای یک پرسنل در بازه تاریخ. */
  static async generatePayroll(input: GeneratePayrollInput) {
    const { personnelId, startDate, endDate, title, bonuses, totalBonuses, deductions, totalDeductions, advanceDeduction: reqAdvanceDeduction, notes } = input;
    const currentUserId = input.userId;
    const currentUsername = input.username;

    const pId = Number(personnelId);
    // v7.0.134 (TD-232): بازه فیش میلادی ISO ذخیره و مقایسه می‌شود؛ ورودی شمسی تبدیل و نامعتبر 422
    const sDate = requireStorageDate(startDate, 'تاریخ شروع دوره فیش');
    const eDate = requireStorageDate(endDate, 'تاریخ پایان دوره فیش');
    if (!sDate || !eDate || sDate > eDate) {
      throw new BadRequestError('بازه فیش معتبر نیست: تاریخ شروع و پایان الزامی است و شروع نباید بعد از پایان باشد');
    }

    // V4.0.4 (TD-091 / Subphase 3.1): کل چرخه صدور فیش، قفل ردیفی کارکردها، محاسبه مالی و سند دوبل داخل یک تراکنش واحد اتمیک
    return orm.transaction(async (tx) => {
      const [pInfo] = await tx.select().from(personnel).where(and(eq(personnel.id, pId), eq(personnel.isDeleted, 0))).for('update');
      if (!pInfo) {
        return { status: 404, error: 'پرسنل انتخاب شده یافت نشد' };
      }

      // 1. Find pending work logs in this date range WITH ROW LOCKING (.for('update'))
      // v8.0.28 (TD-281): کارکرد فقط وقتی آزاد است که به فیش زنده‌ای پیوند نداشته باشد (بی‌فیش، یا فیشش حذف‌شده). پیش‌تر
      // کارکرد «pending» با پیوند به فیش زنده هم شمرده می‌شد ولی دوباره پیوند نمی‌خورد و در هر فیش بعدی تکرار می‌شد.
      const unlinkedOrOrphan = workLogFreeOfLivePayroll();
      const allPersonnelLogs = await tx.select()
        .from(pieceworkLogs)
        .where(and(
          eq(pieceworkLogs.personnelId, pId),
          eq(pieceworkLogs.isDeleted, 0),
          unlinkedOrOrphan
        ))
        .for('update');

      const eligibleLogs = allPersonnelLogs.filter(log => {
        const d = toStorageDate(log.date);
        return !!d && d >= sDate && d <= eDate;
      });

      // 2. Fixed salary deduction & dedup within transaction
      // v8.0.30 (TD-284، تصمیم مالک محصول — گزینه ب): سهم حقوق ثابت برای هر ماه شمسیِ بازه، ماه ناقص به نسبت روزها، پس از
      // کسر سهم فیش‌های پیشین همان ماه (computeFixedSalaryShares). پیش‌تر هر فیش یک ماه کامل به ماه شمسی تاریخ شروعش
      // می‌گرفت: فیش دوماهه یک ماه و فیش نیم‌ماهه ماه کامل.
      const salaryType = String(pInfo.salaryType || 'none');
      const fixedIncluded = salaryType === 'monthly_fixed' || salaryType === 'mixed';
      let fixedPortionFin = fin(0);
      let fixedSalaryMonths: FixedSalaryMonthShare[] = [];
      let fixedDedupNote = '';
      if (fixedIncluded && fin(pInfo.monthlySalary || 0).greaterThan(0)) {
        const priorFixedPayrolls = await tx.select({
          startDate: pieceworkPayrolls.startDate,
          totalFixedAmount: pieceworkPayrolls.totalFixedAmount,
          fixedSalaryMonths: pieceworkPayrolls.fixedSalaryMonths,
        })
        .from(pieceworkPayrolls)
        .where(and(
          eq(pieceworkPayrolls.personnelId, pId),
          eq(pieceworkPayrolls.isDeleted, 0)
        ))
        .for('update');

        const shares = computeFixedSalaryShares(pInfo.monthlySalary, sDate, eDate, priorFixedPayrolls.flatMap(priorFixedGrantsOf));
        fixedPortionFin = shares.total;
        fixedSalaryMonths = shares.months;
        fixedDedupNote = describeFixedSalaryShares(shares.months, pInfo.monthlySalary);
      }

      if (eligibleLogs.length === 0 && fixedPortionFin.lessThanOrEqual(0)) {
        return { status: 400, error: 'هیچ کارکرد معوقی در این بازه زمانی برای پرسنل انتخاب‌شده پیدا نشد.' };
      }

      // 3. Financial calculations with financialDecimal (TD-091)
      let pieceworkTotalFin = fin(0);
      for (const log of eligibleLogs) {
        pieceworkTotalFin = pieceworkTotalFin.add(log.totalAmount || 0);
      }
      const totBonusesFin = fin(bonuses !== undefined ? bonuses : (totalBonuses !== undefined ? totalBonuses : 0));
      const totDeductionsFin = fin(deductions !== undefined ? deductions : (totalDeductions !== undefined ? totalDeductions : 0));
      // v8.0.108 (TD-385): با fin (ارقام فارسی نرمال می‌شوند)؛ پیش‌تر Number('۵۰۰') NaN و کسر مساعده نادیده گرفته می‌شد
      const requestedAdvance = fin(reqAdvanceDeduction ?? 0);
      const advanceDeductionFin = requestedAdvance.isNegative() ? fin(0) : requestedAdvance;

      // v8.0.29 (TD-282، تصمیم مالک محصول — گزینه الف): کسر مساعده بیش از مانده مساعده تسویه‌نشده پرسنل (از دفتر کل) رد
      // می‌شود. پیش‌تر پذیرفته می‌شد؛ حساب مساعده پرسنل بستانکار (منفی) و خالص پرداختنی او بی‌دلیل کم می‌شد.
      if (advanceDeductionFin.isPositive()) {
        const { outstandingAdvance } = await PayrollPaymentService.getPersonnelAdvanceBalance(pId, tx);
        if (advanceDeductionFin.greaterThan(outstandingAdvance)) {
          return {
            status: 400,
            error: `کسر مساعده (${advanceDeductionFin.toNumber().toLocaleString('fa-IR')} ریال) از مانده مساعده تسویه‌نشده ${pInfo.fullName} (${fin(outstandingAdvance).toNumber().toLocaleString('fa-IR')} ریال) بیشتر است؛ حداکثر همان مانده کسر می‌شود.`,
          };
        }
      }

      const netFin = pieceworkTotalFin
        .add(fixedPortionFin)
        .add(totBonusesFin)
        .subtract(totDeductionsFin)
        .subtract(advanceDeductionFin)
        .round(4);

      if (netFin.isNegative()) {
        return { status: 400, error: 'جمع کسورات و کسر مساعده از اجزای فیش بیشتر است — مقادیر را اصلاح کنید.' };
      }

      const pieceworkTotal = money(pieceworkTotalFin.round(4));
      const fixedPortion = money(fixedPortionFin.round(4));
      const totBonuses = money(totBonusesFin.round(4));
      const totDeductions = money(totDeductionsFin.round(4));
      const advanceDeduction = money(advanceDeductionFin.round(4));
      const net = money(netFin);

      // 4. Atomic Sequence Numbering from piecework_payroll_number_seq
      const seqResult = await tx.execute(sql`SELECT nextval('piecework_payroll_number_seq') AS num`);
      const seq = Number(seqResult.rows?.[0]?.num);
      const payrollNumber = `PAY-${seq}`;

      const defaultTitle = title && String(title).trim() ? String(title).trim() : `فیش کارکرد ${pInfo.fullName} (${isoToJalaliDate(sDate)} تا ${isoToJalaliDate(eDate)})`;
      const finalNotes = [notes ? String(notes).trim() : '', fixedDedupNote].filter(Boolean).join(' | ');

      // 5. Insert payroll record
      const [newPayroll] = await tx.insert(pieceworkPayrolls).values({
        payrollNumber,
        personnelId: pId,
        startDate: sDate,
        endDate: eDate,
        title: defaultTitle,
        totalPieceworkAmount: pieceworkTotal,
        totalFixedAmount: fixedPortion,
        totalBonuses: totBonuses,
        totalDeductions: totDeductions,
        advanceDeduction,
        netPayable: net,
        fixedSalaryMonths,
        status: 'approved',
        notes: finalNotes,
        createdById: currentUserId,
        isDeleted: 0
      }).returning();

      // 6. Link logs to payroll with atomic WHERE payrollId IS NULL guard
      const logIds = eligibleLogs.map(l => l.id);
      if (logIds.length > 0) {
        await tx.update(pieceworkLogs)
          .set({ payrollId: newPayroll.id, status: 'approved' })
          .where(and(
            inArray(pieceworkLogs.id, logIds),
            unlinkedOrOrphan
          ));
      }

      // 7. Synchronize double-entry journal voucher inside the same transaction
      // V4.0.5 (F-3 / TD-093): صدور الزامی سند دوبل حسابداری در حالت strict — جلوگیری از ایجاد فیش‌های معلق بدون سند
      const autoVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(
        newPayroll.id,
        currentUserId,
        currentUsername,
        tx,
        { strict: true }
      );

      return {
        status: 201,
        payroll: newPayroll,
        personnelName: pInfo.fullName,
        voucher: autoVoucher
      };
    });
  }

  /** تغییر وضعیت فیش (به‌جز «paid» که فقط از مسیر خزانه‌داری مجاز است) و صدور/بررسی سند. */
  static async updatePayrollStatus(id: number, input: UpdatePayrollStatusInput) {
    const { status, paymentDate, paymentMethod, paymentReference, notes } = input;

    // V10-4.4: گذار وضعیت به «paid» دیگر مستقیم مجاز نیست — فقط از مسیر خزانه‌داری
    if (status && String(status).trim().toLowerCase() === 'paid') {
      throw new ConflictError(
        'علامت‌گذاری دستی «پرداخت‌شده» مجاز نیست. پرداخت حقوق باید از طریق دکمه «ثبت پرداخت» با انتخاب حساب خزانه/بانک انجام شود تا تراکنش مالی و سند تسویه اتمیک صادر گردد.'
      );
    }

    const targetStatus = status ? String(status).trim().toLowerCase() : '';
    if (targetStatus && !MANUAL_PAYROLL_STATUSES.has(targetStatus)) {
      throw new ValidationError(
        `وضعیت «${status}» برای فیش حقوقی مجاز نیست؛ فقط «پیش‌نویس» (draft) و «تأییدشده» (approved) دستی تنظیم می‌شوند. پرداخت از «ثبت پرداخت» و ابطال از «حذف فیش» انجام می‌شود.`
      );
    }

    const currentUserId = input.userId;
    const currentUsername = input.username;

    return orm.transaction(async (tx) => {
      const [pay] = await tx.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0))).for('update');
      if (!pay) {
        return { status: 404, error: 'فیش حقوقی یافت نشد' };
      }
      // v8.0.28 (TD-281): وضعیت فیشی که پرداخت دارد دستی عوض نمی‌شود (برگرداندنش به «approved» حذف آن را با پرداخت باقی‌مانده ممکن می‌کرد)
      if (targetStatus && (['paid', 'partially_paid'].includes(pay.status || '') || fin(pay.paidAmount ?? 0).isPositive())) {
        throw new ConflictError(`فیش ${pay.payrollNumber} پرداخت ثبت‌شده دارد؛ وضعیت آن فقط از مسیر پرداخت تغییر می‌کند.`);
      }

      const updates: Partial<typeof pieceworkPayrolls.$inferInsert> = {};
      if (targetStatus) updates.status = targetStatus;
      if (paymentDate !== undefined) updates.paymentDate = requireStorageDate(paymentDate, 'تاریخ پرداخت فیش');
      if (paymentMethod !== undefined) updates.paymentMethod = String(paymentMethod).trim();
      if (paymentReference !== undefined) updates.paymentReference = String(paymentReference).trim();
      if (notes !== undefined) updates.notes = String(notes).trim();

      await tx.update(pieceworkPayrolls).set(updates).where(eq(pieceworkPayrolls.id, id));

      // Also update attached logs status
      if (targetStatus) {
        await tx.update(pieceworkLogs)
          .set({ status: targetStatus })
          .where(eq(pieceworkLogs.payrollId, id));
      }

      // Trigger or verify journal voucher inside transaction
      let autoVoucher: { id: number; voucherNumber: number } | null = null;
      if (targetStatus === 'approved') {
        autoVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(
          id,
          currentUserId,
          currentUsername,
          tx,
          { strict: true }
        );
      }

      return {
        status: 200,
        payroll: pay,
        voucher: autoVoucher
      };
    });
  }

  /** ثبت یا همگام‌سازی صریح سند حسابداری فیش. */
  static async syncPayrollVoucher(id: number, audit: { userId?: number; username: string }) {
    return orm.transaction(async (tx) => {
      const [pay] = await tx.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0))).for('update');
      if (!pay) {
        return { status: 404, error: 'فیش حقوقی یافت نشد' };
      }

      const voucher = await VoucherSyncService.autoCreateVoucherForPayroll(
        id,
        audit.userId,
        audit.username,
        tx,
        { strict: true }
      );

      if (!voucher) {
        return { status: 400, error: 'ایجاد سند حسابداری برای این فیش حقوقی ناموفق بود یا سرفصل‌های معین دستمزد تعریف نشده‌اند.' };
      }

      return { status: 200, payroll: pay, voucher };
    });
  }

  /**
   * Cancels and soft-deletes a piecework payroll, reverses its financial voucher,
   * and unlinks its logs back to pending state (RULE 01 & RULE 09).
   */
  static async deletePayroll(
    payrollId: number,
    options?: {
      userId?: number;
      username?: string;
      reason?: string;
      externalTx?: DbExecutor;
    }
  ): Promise<typeof pieceworkPayrolls.$inferSelect> {
    const operatorName = options?.username || 'سیستم';
    const operatorId = options?.userId ?? null;
    const reason = options?.reason || `ابطال و حذف فیش حقوقی`;

    const executeDelete = async (tx: DbExecutor) => {
      const [pay] = await tx
        .select()
        .from(pieceworkPayrolls)
        .where(and(eq(pieceworkPayrolls.id, payrollId), eq(pieceworkPayrolls.isDeleted, 0)))
        .for('update');

      if (!pay) {
        throw new NotFoundError('فیش حقوقی یافت نشد');
      }

      // V4.0.33: Guard against deleting payrolls with treasury payment records
      if (['paid', 'partially_paid'].includes(pay.status || '')) {
        throw new BadRequestError(
          'این فیش حقوقی دارای تراکنش پرداخت خزانه‌ای ثبت‌شده است؛ ابطال آن مجاز نیست مگر اینکه ابتدا تراکنش‌های پرداخت آن در بخش خزانه ابطال گردند.'
        );
      }

      // Check linked voucher
      // TD-242: سند فیش فقط از پیوند صریح source_payroll_id (یا سند قدیمی بدون پیوند با الگوی دقیق VoucherSync)؛
      // پیش‌تر (reference_module = 'payroll', reference_id = شناسه فیش) سند معکوس/اصلاحیِ سند فیش دیگری را — که
      // reference_id آن شناسه «سند حسابداری مبدأ» است — برمی‌گرداند و ابطال فیش آن را معکوس یا حذف می‌کرد.
      const voucherCandidates = await tx
        .select()
        .from(journalVouchers)
        .where(payrollVouchersWhere(payrollId, pay.payrollNumber))
        .orderBy(asc(journalVouchers.id))
        .for('update');

      const linkedVouchers: typeof voucherCandidates = [];
      for (const v of voucherCandidates) {
        if (v.sourcePayrollId === payrollId) {
          linkedVouchers.push(v);
          continue;
        }
        if (!isLegacyPayrollVoucher(v, payrollId, pay.payrollNumber)) continue;
        // سند قدیمی بدون پیوند که حسابدار قبلاً معکوسش کرده است دوباره معکوس نمی‌شود (همان رفتار TD-193 برای اسناد انبار)
        const [alreadyReversed] = await tx.select({ id: journalVouchers.id }).from(journalVouchers)
          .where(and(
            eq(journalVouchers.referenceId, v.id),
            eq(journalVouchers.referenceNumber, `REV-V${v.voucherNumber}`),
            eq(journalVouchers.isDeleted, 0)
          ));
        if (!alreadyReversed) linkedVouchers.push(v);
      }

      const permanentVoucher = linkedVouchers.find(v => v.status === 'permanent');
      if (permanentVoucher) {
        throw new BadRequestError(
          `سند حسابداری شماره #${permanentVoucher.voucherNumber} قطعی شده است و امکان ابطال فیش حقوقی وجود ندارد.`
        );
      }

      // تأییدشده: سند معکوس؛ پیش‌نویس: حذف نرم با کنترل سال مالی باز — v8.0.2 (TD-251) همان قاعده مشترک همه ابطال‌ها
      for (const linkedVoucher of linkedVouchers) {
        await VoucherService.voidSourceVoucher({
          voucherId: linkedVoucher.id,
          reason: `${reason} #${pay.payrollNumber || payrollId}`,
          userId: operatorId ?? undefined,
          username: operatorName,
          externalTx: tx,
          allowReversalOfReversal: true
        });
      }

      // Unlink logs back to pending
      await tx
        .update(pieceworkLogs)
        .set({ payrollId: null, status: 'pending' })
        .where(eq(pieceworkLogs.payrollId, payrollId));

      // Soft delete payroll
      const [updatedPay] = await tx
        .update(pieceworkPayrolls)
        .set({ isDeleted: 1 })
        .where(eq(pieceworkPayrolls.id, payrollId))
        .returning();

      return updatedPay || pay;
    };

    if (options?.externalTx) {
      return await executeDelete(options.externalTx);
    }
    return await orm.transaction(executeDelete);
  }
}
