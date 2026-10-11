import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { journalVouchers, personnel, pieceworkPayrolls } from '../../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { fin } from '../../lib/financialDecimal.js';
import { money } from '../../lib/money.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { PayrollPaymentService } from '../accounting/payrollPayment.service.js';
import { payrollVouchersWhere } from '../accounting/payrollVoucherLink.js';
import { VoucherService } from '../accounting/voucher.service.js';
import { VoucherSyncService } from '../accounting/voucherSync.service.js';
import { auditPayrollUpdated } from './pieceworkAudit.js';
import { resolvePayrollStatutory, statutoryAuditInfo, statutoryPayrollColumns } from './payrollStatutory.js';

type AmountInput = number | string;

export interface EditDraftPayrollInput {
  title?: string;
  bonuses?: AmountInput;
  deductions?: AmountInput;
  /** شرح «سایر کسورات»؛ با کسورات بالای صفر الزامی (TD-861) */
  deductionsDescription?: string;
  advanceDeduction?: AmountInput;
  /** v10.0.210 (TD-1087): کسورات قانونی؛ نفرستاده = مبلغ ذخیره‌شده اگر پیش‌تر با شرح تغییر کرده، وگرنه پیشنهاد سرور */
  employeeInsurance?: AmountInput;
  employerInsurance?: AmountInput;
  incomeTax?: AmountInput;
  statutoryOverrideReason?: string;
  userId?: number;
  username: string;
  req?: unknown;
}

const faAmount = (v: AmountInput) => fin(v).toNumber().toLocaleString('fa-IR');

/**
 * v10.0.200 (TD-1242، طرح حقوق §۳.۱ بند ۳ و ۴): فیش پیش‌نویس ویرایش می‌شود (عنوان، پاداش، کسورات و شرحش، کسر مساعده) و
 * سند پیش‌نویس آن با همان تراکنش دوباره ساخته می‌شود. پیش‌تر برای اصلاح یک رقم فیش باید باطل و دوباره صادر می‌شد. فیش
 * تأییدشده فقط پس از بازگشت به پیش‌نویس ویرایش می‌شود (۴۰۹ `PAYROLL_NOT_DRAFT`) و فیشی که سندش تأیید شده ویرایش نمی‌شود
 * (۴۰۹ `PAYROLL_VOUCHER_NOT_DRAFT`). کارکرد و حقوق ثابت فیش همان صدور می‌ماند؛ قاعده‌های پاداش، کسورات و مساعده همان صدورند.
 */
export async function editDraftPayroll(id: number, input: EditDraftPayrollInput) {
  return orm.transaction(async (tx) => {
    const [head] = await tx.select({ personnelId: pieceworkPayrolls.personnelId }).from(pieceworkPayrolls)
      .where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0)));
    if (!head) throw new NotFoundError('فیش حقوقی یافت نشد');
    // ترتیب قفل همان صدور فیش: پرسنل، سپس فیش
    const [person] = await tx.select({ fullName: personnel.fullName, isInsuranceCovered: personnel.isInsuranceCovered, isTaxCovered: personnel.isTaxCovered }).from(personnel).where(eq(personnel.id, head.personnelId)).for('update');
    const [before] = await tx.select().from(pieceworkPayrolls)
      .where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0))).for('update');
    if (!before) throw new NotFoundError('فیش حقوقی یافت نشد');
    // v10.0.222 (TD-1089): فیش عیدی ویرایش نمی‌شود؛ باطل و دوباره صادر می‌شود
    if (before.isEidi === 1) {
      throw new ConflictError(`فیش ${before.payrollNumber} فیش عیدی است و ویرایش نمی‌شود؛ آن را باطل و دوباره صادر کنید.`, undefined, 'PAYROLL_EIDI_NOT_EDITABLE');
    }
    if (before.status !== 'draft') {
      throw new ConflictError(`فیش ${before.payrollNumber} پیش‌نویس نیست؛ برای ویرایش، دارنده «تأیید فیش حقوق» نخست آن را به پیش‌نویس برگرداند.`, undefined, 'PAYROLL_NOT_DRAFT');
    }

    const bonuses = fin(input.bonuses ?? before.totalBonuses ?? 0);
    const deductions = fin(input.deductions ?? before.totalDeductions ?? 0);
    const advance = fin(input.advanceDeduction ?? before.advanceDeduction ?? 0);
    const negative = [bonuses.isNegative() && 'پاداش', deductions.isNegative() && 'کسورات', advance.isNegative() && 'کسر مساعده'].filter(Boolean);
    if (negative.length > 0) {
      throw new ValidationError(`${negative.join('، ')} فیش نمی‌تواند منفی باشد؛ کاهش حقوق را در «کسورات» و افزایش را در «پاداش» وارد کنید.`, undefined, 'PAYROLL_NEGATIVE_COMPONENT');
    }
    const description = deductions.isPositive() ? String(input.deductionsDescription ?? before.deductionsDescription ?? '').trim() : '';
    if (deductions.isPositive() && !description) {
      throw new ValidationError('برای «سایر کسورات» شرح بنویسید، مثلاً بابت چه چیزی کسر می‌شود.', undefined, 'PAYROLL_DEDUCTIONS_DESCRIPTION_REQUIRED');
    }
    // مانده مساعده از دفتر کل (TD-807) کسر همین فیش را در سند پیش‌نویسش شمرده است؛ پس سقف = مانده + کسر کنونی این فیش
    if (advance.isPositive()) {
      const { outstandingAdvance } = await PayrollPaymentService.getPersonnelAdvanceBalance(before.personnelId, tx);
      const ceiling = fin(outstandingAdvance).add(before.advanceDeduction ?? 0);
      if (advance.greaterThan(ceiling)) {
        throw new ValidationError(`کسر مساعده (${faAmount(advance.toString())} ریال) از مانده مساعده تسویه‌نشده ${person?.fullName ?? ''} (${faAmount(ceiling.toString())} ریال) بیشتر است.`, undefined, 'PAYROLL_ADVANCE_EXCEEDS_BALANCE');
      }
    }
    // v10.0.210 (TD-1087): کسورات قانونی با ناخالص تازه؛ مبلغی که پیش‌تر با شرح تغییر کرده می‌ماند مگر دوباره فرستاده شود
    const gross = fin(before.totalPieceworkAmount ?? 0).add(before.totalFixedAmount ?? 0).add(bonuses);
    const keptOverride = (before.statutoryOverrideReason ?? '').trim() !== '';
    const statutory = await resolvePayrollStatutory(tx, {
      person: person ?? {},
      startIso: before.startDate,
      endIso: before.endDate,
      gross,
      entered: {
        employeeInsurance: input.employeeInsurance ?? (keptOverride ? before.employeeInsurance.toString() : undefined),
        employerInsurance: input.employerInsurance ?? (keptOverride ? before.employerInsurance.toString() : undefined),
        incomeTax: input.incomeTax ?? (keptOverride ? before.incomeTax.toString() : undefined),
      },
      overrideReason: input.statutoryOverrideReason ?? before.statutoryOverrideReason ?? '',
    });
    const net = gross.subtract(statutory.amounts.employeeInsurance).subtract(statutory.amounts.incomeTax)
      .subtract(deductions).subtract(advance).round(4);
    if (net.isNegative()) {
      throw new ValidationError('جمع بیمه، مالیات، کسورات و کسر مساعده از اجزای فیش بیشتر است؛ مقادیر را اصلاح کنید.', undefined, 'PAYROLL_NET_NEGATIVE');
    }

    // سند فیش پیش‌نویس با همان تراکنش کنار می‌رود و از روی فیش ویرایش‌شده دوباره ساخته می‌شود
    const vouchers = await tx.select({ id: journalVouchers.id, status: journalVouchers.status, voucherNumber: journalVouchers.voucherNumber })
      .from(journalVouchers).where(payrollVouchersWhere(before.id, before.payrollNumber)).for('update');
    const locked = vouchers.find(v => v.status !== 'draft');
    if (locked) {
      throw new ConflictError(`سند حسابداری ${toPersianDigits(locked.voucherNumber)} فیش ${before.payrollNumber} تأیید شده است؛ فیش پیش‌نویس با سند تأییدشده ویرایش نمی‌شود. فیش را باطل و دوباره صادر کنید.`, undefined, 'PAYROLL_VOUCHER_NOT_DRAFT');
    }

    const title = input.title !== undefined && String(input.title).trim() ? String(input.title).trim() : before.title;
    const [after] = await tx.update(pieceworkPayrolls).set({
      title,
      totalBonuses: money(bonuses.round(4)),
      totalDeductions: money(deductions.round(4)),
      deductionsDescription: description,
      advanceDeduction: money(advance.round(4)),
      ...statutoryPayrollColumns(statutory),
      netPayable: money(net),
    }).where(eq(pieceworkPayrolls.id, id)).returning();

    for (const v of vouchers) {
      await VoucherService.voidSourceVoucher({ voucherId: v.id, reason: `ویرایش فیش پیش‌نویس ${before.payrollNumber}`, userId: input.userId, username: input.username, externalTx: tx });
    }
    const voucher = await VoucherSyncService.autoCreateVoucherForPayroll(id, input.userId, input.username, tx, { strict: true });
    await auditPayrollUpdated(tx, before, after, voucher, { req: input.req, userId: input.userId, username: input.username },
      statutoryAuditInfo(statutory));
    return { payroll: after, voucher, statutoryWarning: statutory.warning };
  });
}
