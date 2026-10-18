import { gregorianToJalali, jalaliMonthLength } from '../../utils/calendarDate.js';
import { toPersianDigits } from '../../utils/persianNumber.js';

/**
 * v10.2 package 9 (group dashboard, parts A to C of the social dashboard proposal): the birthday rules shared by the
 * server and the dashboard. A birthday is the Jalali month and day of `personnel.birth_date` (Gregorian ISO); only the
 * month and day ever leave the server, never the year or the age. A birthday on 30 Esfand is kept on 29 Esfand in a year
 * whose Esfand has 29 days.
 */
export const BIRTHDAY_WINDOW_DAYS = 7;
export const GREETING_MESSAGE_MAX = 200;

/** The fixed reactions, stored by key (`chk_birthday_greetings_reaction`) */
export const BIRTHDAY_REACTIONS = ['party', 'cake', 'clap', 'heart'] as const;
export type BirthdayReaction = (typeof BIRTHDAY_REACTIONS)[number];
export const BIRTHDAY_REACTION_EMOJI: Readonly<Record<BirthdayReaction, string>> = {
  party: '🎉', cake: '🎂', clap: '👏', heart: '❤️',
};
export const BIRTHDAY_REACTION_LABELS: Readonly<Record<BirthdayReaction, string>> = {
  party: 'جشن', cake: 'کیک تولد', clap: 'تشویق', heart: 'دل',
};
export const isBirthdayReaction = (value: unknown): value is BirthdayReaction =>
  typeof value === 'string' && (BIRTHDAY_REACTIONS as readonly string[]).includes(value);

const MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface MonthDay { month: number; day: number }

/** The Jalali month and day of a stored birth date; null for an empty or invalid one */
export function birthMonthDay(birthIso: string | null | undefined): MonthDay | null {
  const m = ISO_DATE.exec(String(birthIso ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const [, month, day] = gregorianToJalali(y, mo, d);
  return { month, day };
}

/** The birthday's day in a Jalali year: 30 Esfand falls on 29 Esfand when that Esfand has 29 days */
export function birthdayInYear(birth: MonthDay, jalaliYear: number): MonthDay {
  if (birth.month === 12 && birth.day === 30 && jalaliMonthLength(jalaliYear, 12) < 30) return { month: 12, day: 29 };
  return birth;
}

/** «۲۶ مهر»: the day and month only */
export function monthDayLabel(md: MonthDay): string {
  return `${toPersianDigits(md.day)} ${MONTH_NAMES[md.month - 1] ?? ''}`.trim();
}

/** The Jalali date of an ISO day plus `offset` days */
export function jalaliOfIsoDay(isoDay: string, offset = 0): { year: number; month: number; day: number } {
  const m = ISO_DATE.exec(isoDay);
  if (!m) throw new Error(`Invalid ISO day: ${isoDay}`);
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offset));
  const [year, month, day] = gregorianToJalali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  return { year, month, day };
}

export interface UpcomingBirthday { daysAway: number; jalaliYear: number; monthDay: MonthDay }

/** The day of a birth date within today and the next `windowDays` days, or null */
export function upcomingBirthday(birthIso: string | null | undefined, todayIso: string, windowDays = BIRTHDAY_WINDOW_DAYS): UpcomingBirthday | null {
  const birth = birthMonthDay(birthIso);
  if (!birth) return null;
  for (let offset = 0; offset <= windowDays; offset++) {
    const day = jalaliOfIsoDay(todayIso, offset);
    const due = birthdayInYear(birth, day.year);
    if (due.month === day.month && due.day === day.day) return { daysAway: offset, jalaliYear: day.year, monthDay: { month: day.month, day: day.day } };
  }
  return null;
}

/** «امروز»، «فردا» or «۳ روز دیگر» */
export function daysAwayLabel(daysAway: number): string {
  if (daysAway === 0) return 'امروز';
  if (daysAway === 1) return 'فردا';
  return `${toPersianDigits(daysAway)} روز دیگر`;
}

/** One greeting as the dashboard shows it */
export interface BirthdayGreetingView {
  id: number;
  senderUserId: number;
  senderName: string;
  senderAvatarUrl: string;
  reaction: BirthdayReaction | null;
  message: string;
  mine: boolean;
}

/** One colleague's birthday on the card (`GET /social/birthdays`): never the year, the age or the birth date */
export interface ColleagueBirthday {
  personnelId: number;
  name: string;
  avatarUrl: string;
  label: string;
  daysAway: number;
  isToday: boolean;
  /** the birthday is the viewer's own (linked personnel) */
  isMine: boolean;
  /** greetings, only for today's birthdays */
  greetings: BirthdayGreetingView[];
}

export interface BirthdaysAnswer {
  /** the viewer's own birthday is today: the banner greets them (only them) */
  myBirthdayToday: boolean;
  birthdays: ColleagueBirthday[];
}

/** Notification types and links of the social category (`uq_notifications_social`) */
export const COLLEAGUE_BIRTHDAY_NOTIFICATION = 'colleague_birthday';
export const BIRTHDAY_GREETING_NOTIFICATION = 'birthday_greeting';
export const birthdayLink = (personnelId: number, jalaliYear: number) => `/?birthday=${personnelId}-${jalaliYear}`;
export const birthdayGreetingLink = (personnelId: number, jalaliYear: number, senderUserId: number) =>
  `${birthdayLink(personnelId, jalaliYear)}&from=${senderUserId}`;
