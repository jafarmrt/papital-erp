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

/** v10.1.47 (OBS-R1-61): گام‌هایی که فقط چک دریافتی دارد؛ چک پرداختی را ما نه به وصول می‌فرستیم و نه به دیگری واگذار می‌کنیم */
const RECEIVED_ONLY_STEPS: readonly ChequeStatus[] = ['in_collection', 'spent'];

/**
 * v10.1.47 (OBS-R1-61): گام‌های مجاز بعدی یک چک بر پایه وضعیت و نوع آن، یک جدول برای سرور و مرورگر. پیش‌تر چک پرداختی
 * «در جریان وصول» پذیرفته می‌شد و سندی نمی‌گرفت، چون جدول انتقال نوع چک را نمی‌دید.
 */
export function chequeNextStatuses(status: string | null | undefined, type?: string | null): ChequeStatus[] {
  const all = CHEQUE_TRANSITIONS[String(status ?? '')] ?? [];
  return type === 'paid' ? all.filter(s => !RECEIVED_ONLY_STEPS.includes(s)) : all;
}

/** v9.0.69 (TD-502، تصمیم ت۹): چکی که گام بعدی ندارد (وصول‌شده، عودت‌شده، خرج‌شده) در منوی ردیف «تغییر وضعیت» و «حذف» ندارد */
export function chequeHasNextStep(status: string | null | undefined, type?: string | null): boolean {
  return chequeNextStatuses(status, type).length > 0;
}

/** v10.1.47 (OBS-PR-12): همه وضعیت‌های واقعی چک، برای پالایه فهرست چک‌ها */
export const CHEQUE_STATUSES = ['received', 'in_treasury', 'in_safe', 'in_collection', 'passed', 'bounced', 'returned', 'spent'] as const satisfies readonly ChequeStatus[];

/**
 * v10.1.47 (OBS-R1-70): گام‌هایی که حساب بانکی چک را تعیین می‌کنند (ارسال به وصول و وصول). در گام‌های دیگر حساب بانکی
 * فرستاده و ذخیره نمی‌شود؛ پیش‌تر پنجره وضعیت نخستین حساب بانکی را پیش‌فرض می‌گذاشت، حتی برای خرج، و سرور آن را ذخیره می‌کرد.
 */
export function chequeStepTakesBankAccount(status: string | null | undefined): boolean {
  return status === 'in_collection' || status === 'passed';
}

/**
 * v10.1.47 (ت۴۰): چک فقط به حساب بانکی یا صندوق وصول می‌شود یا به وصول فرستاده می‌شود، نه کارتخوان یا تنخواه‌گردان.
 * یک قاعده برای سرور و پنجره وضعیت چک.
 */
export const CHEQUE_CLEARING_ACCOUNT_TYPES = ['bank', 'cash'] as const;

export function isChequeClearingAccountType(type: string | null | undefined): boolean {
  return (CHEQUE_CLEARING_ACCOUNT_TYPES as readonly string[]).includes(String(type ?? 'bank'));
}

/** Closing sweep (#291 review): the statuses from which a paid cheque still clears from its issuing account */
export const PAID_CHEQUE_OPEN_CLEARING_STATUSES: readonly ChequeStatus[] = CHEQUE_STATUSES
  .filter(status => chequeNextStatuses(status, 'paid').some(chequeStepTakesBankAccount));

/**
 * Closing sweep (#291 review): a paid cheque drawn on a bank or cash account clears only from that account, the server's
 * rule of v10.1.47. The cheque row carries its account's type, so the status window knows it even when the account list
 * has not loaded that account; with no type known at all the window asks for an account as before.
 */
export function paidChequeIssuingAccountFixed(
  cheque: { type?: string | null; bankAccountId?: number | null; bankAccountType?: string | null } | null | undefined,
  loadedAccountType?: string | null,
): boolean {
  if (!cheque || cheque.type !== 'paid' || !cheque.bankAccountId) return false;
  const type = cheque.bankAccountType ?? loadedAccountType;
  return type != null && isChequeClearingAccountType(type);
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
