/**
 * v9.0.259 (TD-634, finding B13-09, product-owner decision ت۵ الف): the one work-hours rule of a daily log, shared by
 * the server and the form. A time is «HH:MM» from 00:00 to 23:59 (Persian digits read), the end must be after the
 * start (an overnight shift is refused, never counted as the next day), and the hours are rounded to two decimals.
 * An invalid time is refused instead of being stored as 8 hours.
 */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * «HH:MM» with Latin digits, or the trimmed input when it is not a time. v11 (owner request 8 Aban 1405): a phone's
 * number pad has no «:», so digits alone are read too: one or two digits are the hour («۸» → 08:00, «۱۴» → 14:00),
 * three or four are the hour and two minute digits («۸۳۰» → 08:30, «۱۴۰۰» → 14:00). An hour or minute out of range
 * stays refused by `TIME_OF_DAY_PATTERN`. A phone pad's «.» or «٫» is read as «:» («۸٫۳۰» → 08:30). The server reads
 * the same way (`dailyLogs.schemas.ts`), and so does `minutesOfDay` for a stored row (an old row saved as «830» now
 * counts in the overlap check instead of being skipped).
 */
export function normalizeTimeOfDay(value: string): string {
  const latin = value.trim().replace(/[۰-۹٠-٩]/g, (d) => String(Math.max(PERSIAN_DIGITS.indexOf(d), ARABIC_DIGITS.indexOf(d))));
  const withColon = /^(\d{1,2})[:.٫](\d\d)$/.exec(latin);
  if (withColon) return `${withColon[1].padStart(2, '0')}:${withColon[2]}`;
  if (!/^\d{1,4}$/.test(latin)) return latin;
  const [hour, minute] = latin.length <= 2 ? [latin, '00'] : [latin.slice(0, -2), latin.slice(-2)];
  return `${hour.padStart(2, '0')}:${minute}`;
}

export function minutesOfDay(value: string): number | null {
  const t = normalizeTimeOfDay(value);
  if (!TIME_OF_DAY_PATTERN.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** The message for a time that cannot be read; the same text on the form and the server */
export function timeOfDayFormatError(label: string): string {
  return `${label} را مثل ۸، ۸۳۰ یا ۰۸:۳۰ بنویسید (از ۰۰:۰۰ تا ۲۳:۵۹)`;
}

/** Why a start and end time cannot be recorded (Persian), or null when they can */
export function workTimeError(start: string, end: string): string | null {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (s === null) return timeOfDayFormatError('ساعت شروع');
  if (e === null) return timeOfDayFormatError('ساعت پایان');
  if (e <= s) return 'ساعت پایان باید بعد از ساعت شروع باشد؛ کار شبانه را در دو گزارش، یکی برای هر روز، ثبت کنید';
  return null;
}

/** Hours from start to end (two decimals), or null when `workTimeError` refuses them */
export function workHoursBetween(start: string, end: string): number | null {
  if (workTimeError(start, end) !== null) return null;
  return Math.round(((minutesOfDay(end)! - minutesOfDay(start)!) / 60) * 100) / 100;
}

/**
 * v10.0.79 (TD-1171): a stored «HH:MM» shown to the user, 24-hour with Persian digits («۰۸:۳۰»); the browser's time
 * input showed «08:30 AM» by its own locale
 */
export function timeOfDayLabel(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/**
 * v11 (owner request 8 Aban 1405): an end time written by the 12-hour habit, «۲» for 14:00. When the end is not after
 * the start, its hour is 1 to 11 and adding 12 hours puts it after the start, the afternoon time is returned
 * («08:00», «02:00» → «14:00»); otherwise the end is returned as it was. Only the form applies it, to an end as it is
 * typed, where the user sees its reading (`timeOfDayReading`); the server still refuses an end before the start.
 */
export function afternoonEndTime(start: string, end: string): string {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (s === null || e === null || e > s || e < 60 || e >= 720 || e + 720 <= s) return end;
  const shifted = e + 720;
  return `${String(Math.floor(shifted / 60)).padStart(2, '0')}:${String(shifted % 60).padStart(2, '0')}`;
}

/** A log longer than this many hours is shown a warning to check its times (not refused) */
export const LONG_WORK_DAY_HOURS = 12;

/**
 * v11: a time read in words under its box, 12-hour with the part of the day («14:00» → «۲ بعدازظهر», «08:30» →
 * «۸:۳۰ صبح»), so a misread time is seen before saving; null when the value is not a time
 */
export function timeOfDayReading(value: string): string | null {
  const minutes = minutesOfDay(value);
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const part = hour < 5 ? 'بامداد' : hour < 12 ? 'صبح' : hour === 12 ? 'ظهر' : hour < 17 ? 'بعدازظهر' : hour < 20 ? 'عصر' : 'شب';
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}`;
  return `${timeOfDayLabel(clock)} ${part}`;
}
