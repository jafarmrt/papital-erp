import { formatPersianNumber } from '../../utils/persianNumber';

/**
 * v9.0.392 (TD-622، B01-42، تصمیم ت۸): متن عددی صفحه سلامت، همه با رقم فارسی؛ واحدها فارسی («میلی‌ثانیه»، «مگابایت»)
 * و درصد با «٪» پس از عدد.
 */

/** «۱ روز و ۲ ساعت و ۳ دقیقه و ۵ ثانیه» */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${formatPersianNumber(d)} روز`);
  if (h > 0) parts.push(`${formatPersianNumber(h)} ساعت`);
  if (m > 0) parts.push(`${formatPersianNumber(m)} دقیقه`);
  parts.push(`${formatPersianNumber(s)} ثانیه`);
  return parts.join(' و ');
}

export function formatMilliseconds(ms: number): string {
  return `${formatPersianNumber(ms)} میلی‌ثانیه`;
}

export function formatMegabytes(mb: number): string {
  return `${formatPersianNumber(mb)} مگابایت`;
}

/** «۸۰٪» */
export function formatPercent(value: number): string {
  return `${formatPersianNumber(value)}٪`;
}
