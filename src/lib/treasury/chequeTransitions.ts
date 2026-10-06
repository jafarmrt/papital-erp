import type { ChequeStatus } from '../../types/accounting.types';

/**
 * V1.4.0 — ماشین وضعیت چک صیادی (یک جدول برای سرور و مرورگر از v9.0.69)
 * هر انتقال فقط در صورت مجاز بودن و فقط یک‌بار امکان‌پذیر است؛
 * این مانع از دوبار وصول (دوبار مانده + دوبار سند) و ناسازگاری دفتر/خزانه می‌شود.
 */
export const CHEQUE_TRANSITIONS: Record<string, ChequeStatus[]> = {
  received: ['in_treasury', 'in_collection', 'passed', 'bounced', 'spent'],
  in_treasury: ['in_collection', 'passed', 'bounced', 'spent'],
  in_safe: ['in_collection', 'passed', 'bounced', 'spent'],
  in_collection: ['passed', 'bounced'],
  passed: [],        // پایانی
  bounced: ['returned'],
  returned: [],      // پایانی
  spent: [],         // پایانی
};

/** v9.0.69 (TD-502، تصمیم ت۹): چکی که گام بعدی ندارد (وصول‌شده، عودت‌شده، خرج‌شده) در منوی ردیف «تغییر وضعیت» و «حذف» ندارد */
export function chequeHasNextStep(status: string | null | undefined): boolean {
  return (CHEQUE_TRANSITIONS[String(status ?? '')] ?? []).length > 0;
}
