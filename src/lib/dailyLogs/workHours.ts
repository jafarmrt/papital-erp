/**
 * v9.0.259 (TD-634, finding B13-09, product-owner decision ت۵ الف): the one work-hours rule of a daily log, shared by
 * the server and the form. A time is «HH:MM» from 00:00 to 23:59 (Persian digits read), the end must be after the
 * start (an overnight shift is refused, never counted as the next day), and the hours are rounded to two decimals.
 * An invalid time is refused instead of being stored as 8 hours.
 */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** «HH:MM» with Latin digits (a single-digit hour gets its leading zero), or the trimmed input when it is not a time */
export function normalizeTimeOfDay(value: string): string {
  const latin = value.trim().replace(/[۰-۹٠-٩]/g, (d) => String(Math.max(PERSIAN_DIGITS.indexOf(d), ARABIC_DIGITS.indexOf(d))));
  return /^\d:\d\d$/.test(latin) ? `0${latin}` : latin;
}

export function minutesOfDay(value: string): number | null {
  const t = normalizeTimeOfDay(value);
  if (!TIME_OF_DAY_PATTERN.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Why a start and end time cannot be recorded (Persian), or null when they can */
export function workTimeError(start: string, end: string): string | null {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (s === null) return 'ساعت شروع باید به شکل ساعت:دقیقه، از ۰۰:۰۰ تا ۲۳:۵۹ باشد';
  if (e === null) return 'ساعت پایان باید به شکل ساعت:دقیقه، از ۰۰:۰۰ تا ۲۳:۵۹ باشد';
  if (e <= s) return 'ساعت پایان باید بعد از ساعت شروع باشد؛ کار شبانه را در دو گزارش، یکی برای هر روز، ثبت کنید';
  return null;
}

/** Hours from start to end (two decimals), or null when `workTimeError` refuses them */
export function workHoursBetween(start: string, end: string): number | null {
  if (workTimeError(start, end) !== null) return null;
  return Math.round(((minutesOfDay(end)! - minutesOfDay(start)!) / 60) * 100) / 100;
}
