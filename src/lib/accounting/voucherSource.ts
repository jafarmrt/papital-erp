/**
 * v9.0.289 (TD-552، B03-10، تصمیم ت۸ الف): منشأ سند حسابداری خودکار، مشترک میان سرور و صفحه اسناد حسابداری.
 *
 * سندی که یک منشأ صادر کرده (سند انبار یا فاکتور، تراکنش خزانه، چک، فیش حقوق، تخصیص مواد پروژه) و سند برگشت آن، از
 * صفحه اسناد حسابداری فقط تأیید و قطعی می‌شوند. حذف، ویرایش، بازگشت به پیش‌نویس، برگشت و اصلاح آن ۴۰۹
 * `VOUCHER_HAS_SOURCE` است؛ اثر آن فقط با ابطال منشأ (و ثبت دوباره آن) تغییر می‌کند. پیش‌تر این کارها پذیرفته می‌شد و
 * دفتر از موجودی و سند منشأ جدا می‌افتاد (ناوردایی‌های I3 و I4).
 */
export const VOUCHER_SOURCE_KINDS = ['document', 'treasury', 'cheque', 'payroll', 'bom_allocation'] as const;
export type VoucherSourceKind = typeof VOUCHER_SOURCE_KINDS[number];

export const VOUCHER_SOURCE_LABELS: Record<VoucherSourceKind, string> = {
  document: 'سند انبار یا فاکتور',
  treasury: 'تراکنش خزانه',
  cheque: 'چک',
  payroll: 'فیش حقوق',
  bom_allocation: 'تخصیص مواد پروژه',
};

/** پیشوند شماره مرجع سندهای برگشت (ابطال، ابطال برای بازثبت، برگشتِ برگشت خزانه) */
export const REVERSAL_REFERENCE_PREFIXES = ['REV-V', 'VOID-REPOST-V', 'RE-REV-V'] as const;

export function isReversalReference(referenceNumber?: string | null): boolean {
  const ref = referenceNumber ?? '';
  return REVERSAL_REFERENCE_PREFIXES.some(prefix => ref.startsWith(prefix));
}

export function voucherSourceLabel(kind?: string | null): string | null {
  return kind && (VOUCHER_SOURCE_KINDS as readonly string[]).includes(kind) ? VOUCHER_SOURCE_LABELS[kind as VoucherSourceKind] : null;
}
