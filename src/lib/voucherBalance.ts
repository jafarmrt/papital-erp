import { FinancialMath } from './financialDecimal.js';
import { parseCleanNumber } from '../utils/persianNumber.js';

/**
 * v7.0.49 (audit P2-5، تصمیم مالک محصول): بیشترین اختلاف مجاز جمع بدهکار و بستانکار یک سند (۰٫۰۱)، یکسان در
 * ایجاد، ویرایش، اصلاح، بازثبت و قطعی‌سازی. v7.0.76: فرم‌های سند حسابداری هم همین ثابت را می‌خوانند.
 */
export const VOUCHER_BALANCE_TOLERANCE = 0.01;

export interface VoucherBalanceRow {
  debit?: unknown;
  credit?: unknown;
}

export interface VoucherBalance {
  totalDebit: number;
  totalCredit: number;
  /** بدهکار منهای بستانکار؛ مثبت یعنی ردیف بستانکار لازم است */
  debitSurplus: number;
  /** قدر مطلق اختلاف */
  difference: number;
  isBalanced: boolean;
}

/**
 * v7.0.76 (audit P3-6): تراز ردیف‌های سند حسابداری در فرم‌ها با جمع اعشاری دقیق (نه `+=` اعداد جاوااسکریپت)
 * و همان تلورانس سرور. پیش‌تر فرم سند جدید ۰٫۱ + ۰٫۲ بدهکار و ۰٫۳ بستانکار را تراز نمی‌دانست.
 */
export function computeVoucherBalance(rows: readonly VoucherBalanceRow[] | null | undefined): VoucherBalance {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalDebit = FinancialMath.sum(safeRows.map(r => parseCleanNumber(r.debit, 0)));
  const totalCredit = FinancialMath.sum(safeRows.map(r => parseCleanNumber(r.credit, 0)));
  const surplus = totalDebit.subtract(totalCredit);
  return {
    totalDebit: totalDebit.toNumber(),
    totalCredit: totalCredit.toNumber(),
    debitSurplus: surplus.toNumber(),
    difference: surplus.abs().toNumber(),
    isBalanced: totalDebit.isPositive() && surplus.abs().lessThan(VOUCHER_BALANCE_TOLERANCE),
  };
}
