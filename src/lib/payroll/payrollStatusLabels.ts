/**
 * v9.0.276 (TD-810، B12P-07): برچسب فارسی وضعیت فیش حقوقی و کارکرد برای ردیف‌های ممیزی و پیام‌ها. پیش‌تر ردیف ممیزی تغییر
 * وضعیت فیش کد خام را می‌نوشت («به «draft»»).
 */
export const PAYROLL_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'پیش‌نویس',
  approved: 'تأییدشده',
  partially_paid: 'نیمه‌پرداخت',
  paid: 'پرداخت‌شده',
};

export const WORK_LOG_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'در انتظار فیش',
  draft: 'در فیش پیش‌نویس',
  approved: 'در فیش تأییدشده',
  partially_paid: 'در فیش نیمه‌پرداخت',
  paid: 'پرداخت‌شده',
};

/** وضعیت ناشناخته همان کد را برمی‌گرداند تا چیزی گم نشود */
export function payrollStatusLabel(status: string | null | undefined): string {
  const key = String(status ?? '').trim().toLowerCase();
  return PAYROLL_STATUS_LABELS[key] ?? (key || '—');
}

export function workLogStatusLabel(status: string | null | undefined): string {
  const key = String(status ?? '').trim().toLowerCase();
  return WORK_LOG_STATUS_LABELS[key] ?? (key || '—');
}
