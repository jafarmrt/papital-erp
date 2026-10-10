import { formatPersianNumber } from '../../utils/persianNumber';
import type { ReservationShortage } from './projectReservation.js';

/**
 * v10.0.90 (TD-1149): the message after «ثبت نهایی و رزرو انبار» says what the server really reserved. The server keeps
 * only rows with a positive reserved quantity (`planProjectReservation`), so an empty list means nothing was reserved:
 * no control row reached a warehouse item, or none had free stock (then the purchase list names the shortages).
 */
export interface FinalizeReservationOutcome {
  kind: 'success' | 'warning';
  message: string;
}

export function finalizeReservationOutcome(reservedItems: readonly unknown[], shortages: readonly ReservationShortage[]): FinalizeReservationOutcome {
  const reserved = Array.isArray(reservedItems) ? reservedItems.length : 0;
  if (reserved > 0) {
    return { kind: 'success', message: `کنترل موجودی ثبت نهایی شد و ${formatPersianNumber(reserved)} قلم در انبار رزرو شد.` };
  }
  if (shortages.length > 0) {
    return {
      kind: 'warning',
      message: 'کنترل موجودی ثبت نهایی شد، ولی هیچ قلمی رزرو نشد، چون موجودی آزاد نبود؛ فهرست کمبود در «فهرست خرید» آمده است.',
    };
  }
  return {
    kind: 'warning',
    message: 'کنترل موجودی ثبت نهایی شد، ولی هیچ قلمی رزرو نشد، چون هیچ ردیفی به کالای انبار نرسید؛ کد یا نام اقلام را بررسی کنید.',
  };
}

/**
 * The second message, for items reserved below their need. Its cause comes from each shortage's `reservedByOthers`
 * (roles-c Rc13): before, it always said others had reserved the stock, also when the warehouse simply held too little.
 */
export function reservationShortageMessage(shortages: readonly ReservationShortage[]): string | null {
  if (shortages.length === 0) return null;
  const count = formatPersianNumber(shortages.length);
  const byOthers = shortages.filter(s => Number(s.reservedByOthers) > 0).length;
  const cause = byOthers === shortages.length
    ? 'چون بخشی از موجودی را پیش‌فاکتورها یا پروژه‌های دیگر رزرو کرده‌اند'
    : byOthers === 0
      ? 'چون موجودی انبار کمتر از نیاز است'
      : 'چون موجودی انبار کم است یا بخشی از آن را پیش‌فاکتورها یا پروژه‌های دیگر رزرو کرده‌اند';
  return `${count} کالا کمتر از نیاز رزرو شد، ${cause}؛ فهرست کمبود در «فهرست خرید» آمده است.`;
}
