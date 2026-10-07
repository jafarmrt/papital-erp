/**
 * v9.0.269 (TD-816، B12P-13): فقط فیش «تأییدشده» یا «پرداخت جزئی» پرداخت می‌گیرد. پیش‌تر فیش «پیش‌نویس» هم پرداخت می‌شد و
 * دکمه «ثبت پرداخت» برای آن نمایش داده می‌شد. سرور (ثبت پرداخت) و مرورگر (دکمه‌های فهرست و فیش) هر دو از این فایل می‌خوانند.
 */
export const PAYABLE_PAYROLL_STATUSES: readonly string[] = ['approved', 'partially_paid'];

export function isPayablePayrollStatus(status: string | null | undefined): boolean {
  return PAYABLE_PAYROLL_STATUSES.includes(String(status ?? ''));
}
