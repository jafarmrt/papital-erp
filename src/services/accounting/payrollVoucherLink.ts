import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { journalVouchers } from '../../db/schema.js';

/**
 * TD-242: یافتن سند حسابداری یک فیش حقوقی پرکیسی.
 *
 * سند فیش فقط از پیوند صریح journal_vouchers.source_payroll_id یافته می‌شود (مهاجرت 0035، همان الگوی
 * source_document_id در TD-193). اسناد معکوس/اصلاحی (REV-V…، CORR-V…، VOID-REPOST-V…، REPOST-V…) ماژول
 * مرجع 'payroll' را نگه می‌دارند ولی reference_id آن‌ها شناسه «سند حسابداری مبدأ» است؛ پس جست‌وجو با
 * (reference_module = 'payroll', reference_id = شناسه فیش) سند فیش دیگری را برمی‌گرداند.
 *
 * «سند قدیمی بدون پیوند»: سندی که پیش از مهاجرت 0035 دقیقاً با الگوی VoucherSync صادر شده
 * (voucher_type = 'payroll'، reference_module = 'payroll'، reference_id = شناسه فیش و reference_number = شماره فیش)
 * ولی مهاجرت آن را پیوند نداد چون فیش بیش از یک سند این‌چنینی داشت. این اسناد هرگز سند معکوس/اصلاحی نیستند
 * (شماره عطف آن‌ها پیشوند REV-V/CORR-V/… دارد) و همچنان سند همان فیش شمرده می‌شوند تا سند دوم صادر نشود و
 * ابطال فیش آن‌ها را هم باطل کند.
 */

type PayrollVoucherRef = {
  id: number;
  sourcePayrollId: number | null;
  referenceId: number | null;
  referenceNumber: string | null;
  voucherType: string | null;
};

function legacyPayrollVoucherShape(): SQL {
  return and(
    isNull(journalVouchers.sourcePayrollId),
    eq(journalVouchers.voucherType, 'payroll'),
    eq(journalVouchers.referenceModule, 'payroll'),
  ) as SQL;
}

/** اسناد فعال یک فیش: سند پیوندشده یا سند قدیمی بدون پیوند با الگوی دقیق VoucherSync. */
export function payrollVouchersWhere(payrollId: number, payrollNumber: string): SQL {
  return and(
    eq(journalVouchers.isDeleted, 0),
    or(
      eq(journalVouchers.sourcePayrollId, payrollId),
      and(
        legacyPayrollVoucherShape(),
        eq(journalVouchers.referenceId, payrollId),
        eq(journalVouchers.referenceNumber, payrollNumber.trim()),
      ),
    ),
  ) as SQL;
}

/**
 * نامزدهای سند فعال چند فیش (برای فهرست). تطبیق شماره فیش برای اسناد بدون پیوند با
 * `pickPayrollVoucher` در TypeScript انجام می‌شود.
 */
export function payrollVouchersForListWhere(payrollIds: number[]): SQL {
  return and(
    eq(journalVouchers.isDeleted, 0),
    or(
      inArray(journalVouchers.sourcePayrollId, payrollIds),
      and(legacyPayrollVoucherShape(), inArray(journalVouchers.referenceId, payrollIds)),
    ),
  ) as SQL;
}

/** آیا این سند سند قدیمی بدون پیوندِ همین فیش است؟ */
export function isLegacyPayrollVoucher(v: PayrollVoucherRef, payrollId: number, payrollNumber: string): boolean {
  return v.sourcePayrollId === null
    && v.voucherType === 'payroll'
    && v.referenceId === payrollId
    && (v.referenceNumber || '') === payrollNumber.trim();
}

/**
 * سند حسابداری یک فیش از میان نامزدها، همیشه همان سند (ترتیب ثابت): سند پیوندشده؛ در غیر این صورت قدیمی‌ترین
 * سند بدون پیوند با الگوی دقیق VoucherSync.
 */
export function pickPayrollVoucher<T extends PayrollVoucherRef>(candidates: T[], payrollId: number, payrollNumber: string): T | undefined {
  const linked = candidates.find(v => v.sourcePayrollId === payrollId);
  if (linked) return linked;
  return candidates
    .filter(v => isLegacyPayrollVoucher(v, payrollId, payrollNumber))
    .sort((a, b) => a.id - b.id)[0];
}
