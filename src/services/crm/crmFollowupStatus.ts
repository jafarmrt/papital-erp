import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { crmActivities } from '../../db/schema.js';
import { NotFoundError } from '../../errors/customErrors.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { isoToJalaliDate } from '../../utils.js';

type Activity = typeof crmActivities.$inferSelect;

export interface FollowupOutcome {
  result?: string;
  resultNote?: string;
}

export interface FollowupStatusChange {
  before: Activity;
  after: Activity;
  /** false: پیگیری از پیش در وضعیت هدف بود و چیزی نوشته نشد */
  changed: boolean;
}

/**
 * v9.0.19 (TD-430): «انجام» و «بازگشایی» پیگیری دو عمل صریح با وضعیت هدف‌اند، زیر قفل ردیف اقدام. تکرار درخواست (دوبار کلیک
 * یا ارسال دوباره) پیگیری را در همان وضعیت می‌گذارد و نتیجه را دوباره نمی‌افزاید. پیش‌تر `toggle-followup` کلید دوطرفه بود:
 * دو درخواست پشت‌سرهم پیگیری انجام‌شده را دوباره باز می‌کرد.
 */
export async function setFollowupCompleted(tx: DbExecutor, id: number, completed: boolean, outcome: FollowupOutcome = {}): Promise<FollowupStatusChange> {
  const [before] = await tx.select().from(crmActivities)
    .where(and(eq(crmActivities.id, id), eq(crmActivities.isDeleted, 0)))
    .for('update');
  if (!before) throw new NotFoundError('اقدام یافت نشد');

  const target = completed ? 1 : 0;
  if (before.isFollowUpCompleted === target) return { before, after: before, changed: false };

  const updateData: Partial<typeof crmActivities.$inferInsert> = { isFollowUpCompleted: target };
  if (completed) {
    const result = outcome.result?.trim();
    if (result) updateData.result = result;
    const note = outcome.resultNote?.trim();
    if (note) {
      const todayJalali = isoToJalaliDate(await businessTodayIsoDate());
      const line = `[نتیجه پیگیری (${todayJalali})]: ${note}`;
      updateData.description = before.description ? `${before.description}\n${line}` : line;
    }
  }

  const [after] = await tx.update(crmActivities).set(updateData).where(eq(crmActivities.id, id)).returning();
  return { before, after, changed: true };
}
