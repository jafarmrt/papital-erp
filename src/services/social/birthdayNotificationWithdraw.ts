import { and, inArray, isNull, like, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { notifications } from '../../db/schema.js';
import { startsWithLikePattern } from '../../lib/sqlLike.js';
import { BIRTHDAY_GREETING_NOTIFICATION, COLLEAGUE_BIRTHDAY_NOTIFICATION } from '../../lib/social/birthdays.js';

const BIRTHDAY_NOTIFICATION_TYPES = [COLLEAGUE_BIRTHDAY_NOTIFICATION, BIRTHDAY_GREETING_NOTIFICATION];

/**
 * v10.2 package 9 (review M-1): when a personnel's birthday stops being shown (the owner turns it off, the personnel
 * leaves or is deleted), the «امروز تولد … است» notifications already in colleagues' bells and the greeting notifications
 * of that birthday leave every bell in the same transaction. The rows are kept with `dismissed_at`, so the unique index
 * `uq_notifications_social` never makes them again for that year. Returns the number of rows withdrawn.
 */
export async function withdrawBirthdayNotifications(tx: DbExecutor, personnelId: number): Promise<number> {
  const rows = await tx.update(notifications)
    .set({ dismissedAt: sql`now()` })
    .where(and(
      inArray(notifications.type, BIRTHDAY_NOTIFICATION_TYPES),
      like(notifications.link, startsWithLikePattern(`/?birthday=${personnelId}-`)),
      isNull(notifications.dismissedAt),
    ))
    .returning({ id: notifications.id });
  return rows.length;
}

/** Whether colleagues see this personnel's birthday: shown, not left («قطع همکاری») and not deleted */
export function birthdayShownToColleagues(p: { isBirthdayVisible: number | null; employmentStatus: string | null; isDeleted: number | null }): boolean {
  return p.isBirthdayVisible === 1 && p.employmentStatus !== 'قطع همکاری' && (p.isDeleted ?? 0) === 0;
}
