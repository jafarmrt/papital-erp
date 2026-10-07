import { isoToJalaliDate, jalaliYearBounds } from '../utils/calendarDate.js';

/**
 * v8.0.47 (TD-310، تصمیم مالک محصول): تاریخ‌های فرم بستن سال مالی از خود سال ساخته می‌شوند — سند اختتامیه آخرین روز
 * سال (۳۰ اسفند در سال کبیسه، وگرنه ۲۹ اسفند) و سند افتتاحیه ۱ فروردین سال بعد؛ سرور همان را با
 * `resolveFiscalClosingDates` می‌سازد و تاریخ دیگری نمی‌پذیرد. سال نامعتبر ← رشته خالی.
 */
export function fiscalClosingJalaliDates(year: string | number): { closingDate: string; openingDateNewYear: string } {
  const bounds = jalaliYearBounds(Number(year));
  if (!bounds) return { closingDate: '', openingDateNewYear: '' };
  return { closingDate: isoToJalaliDate(bounds.lastDay), openingDateNewYear: isoToJalaliDate(bounds.nextFirstDay) };
}
