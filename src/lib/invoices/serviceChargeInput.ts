import { normalizeDecimalString } from '../numericInput';

export const SERVICE_CHARGE_INVALID = 'هزینه ارسال و خدمات باید عددی بزرگ‌تر یا برابر صفر باشد.';

export interface ServiceChargeInput {
  /** مبلغی که فرم می‌فرستد (رشته لاتین)؛ خالی یعنی صفر */
  amount: string;
  error: string | null;
}

/**
 * v10.0.260 (TD-1136): کادر «هزینه ارسال و خدمات» فرم فاکتور. ارقام فارسی و عربی، «٫» و جداکننده هزار خوانده می‌شوند؛
 * متن نامعتبر یا منفی خطاست و هرگز صفر شمرده نمی‌شود (AGENTS §6، TD-666).
 */
export function serviceChargeInputOf(text: string): ServiceChargeInput {
  const clean = normalizeDecimalString(text ?? '');
  if (clean === '') return { amount: '0', error: null };
  if (!/^\d+(\.\d+)?$/.test(clean)) return { amount: '0', error: SERVICE_CHARGE_INVALID };
  return { amount: clean, error: null };
}
