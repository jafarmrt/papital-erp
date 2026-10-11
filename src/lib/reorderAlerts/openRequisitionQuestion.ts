import { formatPersianNumber } from '../../utils';

/**
 * v10.0.255 (TD-1134): پرسش پنجره سفارش هشدار نقطه سفارش، وقتی کالایی از درخواست تازه هنوز در درخواست خرید باز و
 * سفارش‌نشده است (`requested_qty` پاسخ هشدار)؛ بی چنین کالایی null.
 */
export function openRequisitionQuestion(items: ReadonlyArray<{ name: string; unit?: string; requested_qty?: number }>): string | null {
  const open = items.filter(it => Number(it.requested_qty) > 0);
  if (open.length === 0) return null;
  const names = open.map(it => `«${it.name}» (${formatPersianNumber(Number(it.requested_qty))} ${it.unit || 'عدد'})`).join('، ');
  return `برای این کالاها درخواست خرید باز و هنوز سفارش‌نشده هست: ${names}. درخواست تازه هم ثبت شود؟`;
}
