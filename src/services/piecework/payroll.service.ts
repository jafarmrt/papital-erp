import { eq, and, or, sql, inArray, asc } from 'drizzle-orm';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { pieceworkLogs, pieceworkPayrolls, personnel, journalVouchers } from '../../db/schema.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../errors/customErrors.js';
import { normalizePersianDate } from '../../utils.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { isLegacyPayrollVoucher, payrollVouchersWhere } from '../accounting/payrollVoucherLink.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';

/**
 * چرخه عمر فیش حقوقی پرکیسی: صدور، تغییر وضعیت، همگام‌سازی سند و ابطال.
 * هر متد تراکنش، قفل‌ها و پاسخ‌های خطای { status, error } پیشین روت را بدون تغییر نگه می‌دارد.
 */

type AmountInput = number | string;

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
    const sDate = normalizePersianDate(String(startDate));
    const eDate = normalizePersianDate(String(endDate));

    // V4.0.4 (TD-091 / Subphase 3.1): کل چرخه صدور فیش، قفل ردیفی کارکردها، محاسبه مالی و سند دوبل داخل یک تراکنش واحد اتمیک
    return orm.transaction(async (tx) => {
      const [pInfo] = await tx.select().from(personnel).where(and(eq(personnel.id, pId), eq(personnel.isDeleted, 0))).for('update');
      if (!pInfo) {
        return { status: 404, error: 'پرسنل انتخاب شده یافت نشد' };
      }

      // 1. Find pending work logs in this date range WITH ROW LOCKING (.for('update'))
      const allPersonnelLogs = await tx.select()
        .from(pieceworkLogs)
        .where(and(
          eq(pieceworkLogs.personnelId, pId),
          eq(pieceworkLogs.isDeleted, 0),
          or(eq(pieceworkLogs.status, 'pending'), sql`${pieceworkLogs.payrollId} IS NULL`)
        ))
        .for('update');

      const eligibleLogs = allPersonnelLogs.filter(log => {
        const d = normalizePersianDate(log.date);
        return d >= sDate && d <= eDate;
      });

      // 2. Fixed salary deduction & dedup within transaction
      const salaryType = String(pInfo.salaryType || 'none');
      const fixedIncluded = salaryType === 'monthly_fixed' || salaryType === 'mixed';
      let fixedPortionFin = fixedIncluded ? fin(pInfo.monthlySalary || 0) : fin(0);

      let fixedDedupNote = '';
      if (fixedIncluded && fixedPortionFin.greaterThan(0)) {
        const targetMonthKey = sDate.slice(0, 7); // '1405/06'
        const priorFixedPayrolls = await tx.select({
          id: pieceworkPayrolls.id,
          payrollNumber: pieceworkPayrolls.payrollNumber,
          startDate: pieceworkPayrolls.startDate,
          totalFixedAmount: pieceworkPayrolls.totalFixedAmount
        })
        .from(pieceworkPayrolls)
        .where(and(
          eq(pieceworkPayrolls.personnelId, pId),
          eq(pieceworkPayrolls.isDeleted, 0)
        ))
        .for('update');

        const sameMonthFixed = priorFixedPayrolls.filter(pr => String(pr.startDate || '').slice(0, 7) === targetMonthKey);
        const alreadyGranted = sameMonthFixed.reduce((sum, pr) => sum.add(pr.totalFixedAmount || 0), fin(0));
        if (alreadyGranted.greaterThan(0)) {
          fixedPortionFin = fixedPortionFin.subtract(alreadyGranted);
          if (fixedPortionFin.isNegative()) {
            fixedPortionFin = fin(0);
          }
          const refs = sameMonthFixed.map(pr => pr.payrollNumber).join('، ');
          fixedDedupNote = alreadyGranted.greaterThanOrEqual(pInfo.monthlySalary || 0)
            ? `سهم حقوق ثابت ماه ${targetMonthKey} قبلاً به‌طور کامل در فیش(های) ${refs} محاسبه شده است؛ این فیش فقط کارکرد پرکیسی را پوشش می‌دهد.`
            : `سهم حقوق ثابت این ماه با کسر مبلغ قبلی (فیش ${refs}) محاسبه شد.`;
        }
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
      const advanceDeductionFin = fin(Math.max(0, Number(reqAdvanceDeduction) || 0));

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

      const defaultTitle = title && String(title).trim() ? String(title).trim() : `فیش کارکرد ${pInfo.fullName} (${sDate} تا ${eDate})`;
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
            sql`${pieceworkLogs.payrollId} IS NULL`
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

    const currentUserId = input.userId;
    const currentUsername = input.username;

    return orm.transaction(async (tx) => {
      const [pay] = await tx.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0))).for('update');
      if (!pay) {
        return { status: 404, error: 'فیش حقوقی یافت نشد' };
      }

      const updates: Partial<typeof pieceworkPayrolls.$inferInsert> = {};
      if (status) updates.status = String(status);
      if (paymentDate !== undefined) updates.paymentDate = String(paymentDate).trim();
      if (paymentMethod !== undefined) updates.paymentMethod = String(paymentMethod).trim();
      if (paymentReference !== undefined) updates.paymentReference = String(paymentReference).trim();
      if (notes !== undefined) updates.notes = String(notes).trim();

      await tx.update(pieceworkPayrolls).set(updates).where(eq(pieceworkPayrolls.id, id));

      // Also update attached logs status
      if (status) {
        await tx.update(pieceworkLogs)
          .set({ status: String(status) })
          .where(eq(pieceworkLogs.payrollId, id));
      }

      // Trigger or verify journal voucher inside transaction
      let autoVoucher: { id: number; voucherNumber: number } | null = null;
      if (status === 'approved' || status === 'paid') {
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

      for (const linkedVoucher of linkedVouchers) {
        if (linkedVoucher.status === 'approved') {
          // If approved, reverse the voucher formally
          await VoucherService.reverseVoucher({
            voucherId: linkedVoucher.id,
            reason: `${reason} #${pay.payrollNumber || payrollId}`,
            userId: operatorId ?? undefined,
            username: operatorName,
            externalTx: tx,
            allowReversalOfReversal: true
          });
        } else {
          // If draft, soft-delete it — v7.0.49 (audit P2-5): نه در سال مالی بسته‌شده
          await VoucherService.checkFiscalPeriodOpen(linkedVoucher.date, tx);
          await tx.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.id, linkedVoucher.id));
        }
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
