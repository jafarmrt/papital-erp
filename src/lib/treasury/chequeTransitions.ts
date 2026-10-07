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

/**
 * v9.0.104 (TD-512 / TD-513، B04-16 / B04-17): برچسب فارسی هر وضعیت چک، یک نگاشت برای پیام‌های سرور، ممیزی، یادداشت
 * پیش‌فرض تاریخچه و رابط. پیش‌تر پیام‌ها کد انگلیسی (`in_collection`، `passed`) را نشان می‌دادند.
 */
export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  received: 'دریافت شده',
  in_treasury: 'در خزانه / صندوق',
  in_safe: 'نزد صندوق',
  in_collection: 'در جریان وصول (خوابانده به حساب)',
  passed: 'وصول شده (پاس شده)',
  bounced: 'واخواست / برگشت خورده',
  returned: 'عودت داده شده به مشتری',
  spent: 'خرج شده / واگذار به غیر',
};

/** برچسب فارسی یک وضعیت چک؛ وضعیت ناشناخته «نامشخص» است، نه کد انگلیسی */
export function chequeStatusLabel(status: string | null | undefined): string {
  return CHEQUE_STATUS_LABELS[String(status ?? '') as ChequeStatus] ?? 'نامشخص';
}
