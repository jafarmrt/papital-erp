import { and, inArray, isNull, like, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { notifications } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { startsWithLikePattern } from '../../lib/sqlLike.js';
import {
  BIRTHDAY_GREETING_NOTIFICATION, birthdayLink, COLLEAGUE_BIRTHDAY_NOTIFICATION, jalaliOfIsoDay, upcomingBirthday,
} from '../../lib/social/birthdays.js';

const BIRTHDAY_NOTIFICATION_TYPES = [COLLEAGUE_BIRTHDAY_NOTIFICATION, BIRTHDAY_GREETING_NOTIFICATION];

/**
 * v10.2 package 9 (review M-1): when a personnel's birthday stops being shown (the owner turns it off, the personnel
 * leaves or is deleted), the «امروز تولد … است» notifications already in colleagues' bells and the greeting notifications
 * of that birthday leave every bell in the same transaction. The rows are kept with `dismissed_at`, so the unique index
 * `uq_notifications_social` never makes them again for that year. Returns the number of rows withdrawn.
 */
export async function withdrawBirthdayNotifications(tx: DbExecutor, personnelId: number, jalaliYear?: number): Promise<number> {
  // the trailing «-» (all years) or the year's own link keeps personnel 1 from matching personnel 12
  const prefix = jalaliYear === undefined ? `/?birthday=${personnelId}-` : birthdayLink(personnelId, jalaliYear);
  const rows = await tx.update(notifications)
    .set({ dismissedAt: sql`now()` })
    .where(and(
      inArray(notifications.type, BIRTHDAY_NOTIFICATION_TYPES),
      like(notifications.link, startsWithLikePattern(prefix)),
      isNull(notifications.dismissedAt),
    ))
    .returning({ id: notifications.id });
  return rows.length;
}

type BirthdayRow = { isBirthdayVisible: number | null; employmentStatus: string | null; isDeleted: number | null; birthDate: string | null };

/**
 * After a personnel row is written (delta review nit 2): a birthday no longer shown leaves every bell, and a birth date
 * edited or cleared so that today is no longer the birthday takes this year's birthday notifications out too. Only a date
 * that WAS today and no longer is withdraws them (final delta M-1): an edit of anything else after the birthday has passed
 * (a phone, a salary, an Excel re-import) keeps that year's greetings in the bell. Turning a birthday back on the same day
 * does not bring withdrawn rows back (the unique index keeps them dismissed), by design.
 */
export async function withdrawBirthdayNotificationsIfGone(
  tx: DbExecutor,
  personnelId: number,
  row: BirthdayRow,
  previousBirthDate: string | null,
): Promise<number> {
  if (!birthdayShownToColleagues(row)) return withdrawBirthdayNotifications(tx, personnelId);
  const todayIso = await businessTodayIsoDate();
  const wasToday = upcomingBirthday(previousBirthDate, todayIso, 0) !== null;
  if (!wasToday || upcomingBirthday(row.birthDate, todayIso, 0)) return 0;
  return withdrawBirthdayNotifications(tx, personnelId, jalaliOfIsoDay(todayIso).year);
}

/** Whether today is this row's birthday and colleagues see it; the bell scan re-reads its candidates with it */
export function birthdayTodayShown(row: BirthdayRow, todayIso: string): boolean {
  return birthdayShownToColleagues(row) && upcomingBirthday(row.birthDate, todayIso, 0) !== null;
}

/** Whether colleagues see this personnel's birthday: shown, not left («قطع همکاری») and not deleted */
export function birthdayShownToColleagues(p: { isBirthdayVisible: number | null; employmentStatus: string | null; isDeleted: number | null }): boolean {
  return p.isBirthdayVisible === 1 && p.employmentStatus !== 'قطع همکاری' && (p.isDeleted ?? 0) === 0;
}
