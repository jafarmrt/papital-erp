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
