/**
 * v9.0.158 (TD-573، B03-31): نوع‌های سند حسابداری و برچسب فارسی آن‌ها، یک فهرست برای چاپ سند، نشان نوع در فهرست اسناد و
 * صافی نوع. همان فهرست طرح Zod سرور (`accounting.schemas.ts`). پیش‌تر چاپ و فهرست «تسویه» را نداشتند و سند تسویه «عمومی»
 * چاپ می‌شد؛ صافی فهرست هم تسویه نداشت.
 */

export const VOUCHER_TYPES = ['general', 'sales', 'purchase', 'treasury', 'payroll', 'opening', 'closing', 'adjustment', 'settlement'] as const;
export type VoucherTypeCode = typeof VOUCHER_TYPES[number];

export const VOUCHER_TYPE_LABELS: Record<VoucherTypeCode, string> = {
  general: 'عمومی',
  sales: 'فروش و درآمد',
  purchase: 'خرید و انبار',
  treasury: 'دریافت و پرداخت',
  payroll: 'حقوق و دستمزد',
  opening: 'افتتاحیه',
  closing: 'اختتامیه',
  adjustment: 'اصلاحی / برگشت',
  settlement: 'تسویه',
};

export function isVoucherTypeCode(value: unknown): value is VoucherTypeCode {
  return typeof value === 'string' && (VOUCHER_TYPES as readonly string[]).includes(value);
}

/** برچسب نوع سند: خالی «عمومی»؛ نوع ناشناخته «نوع نامشخص» (هرگز «عمومی» به جای نوعی که هست) */
export function voucherTypeLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return VOUCHER_TYPE_LABELS.general;
  return isVoucherTypeCode(value) ? VOUCHER_TYPE_LABELS[value] : 'نوع نامشخص';
}
