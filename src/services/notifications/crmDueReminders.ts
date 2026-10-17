import { and, eq, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmActivities, notifications, users } from '../../db/schema.js';
import { createNotifications } from './notificationCreator.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { isoToJalaliDate, toPersianDigits } from '../../utils.js';
import { dueFollowupCondition, ownFollowupCondition } from '../crm/crmFollowups.js';
import { runThrottledReminderScan } from '../../lib/workshop/reminderThrottle.js';

/**
 * v9.0.433 (TD-709، B15-07): پیگیری سررسیدشده‌ای که زنگ اعلان به یک کاربر یادآوری می‌کند فقط پیگیری خود اوست: مسئولی که
 * شناسه پرسنلش (`assigned_personnel_id`) به همین کاربر پیوند دارد، و برای ردیف قدیمی بی شناسه، نام مسئول (یا ثبت‌کننده)
 * بریده‌شده که دقیقاً نام کامل یا نام کاربری اوست؛ هرگز «شامل». پیش‌تر کاربر «علی» یادآوری پیگیری «علیرضا …» را با عنوان
 * پیگیری و نام مشتری می‌گرفت.
 */
export async function ownDueFollowupCondition(userId: number, todayIso: string): Promise<SQL | null> {
  const [user] = await orm.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  return and(dueFollowupCondition(todayIso), await ownFollowupCondition(userId)) as SQL;
}

/**
 * v10.1.62 (OBS-R2-85, decision ت۴۰ item 12): the bell and its counter ask every 30 seconds per open tab, and each ask read
 * the user's due follow-ups; the scan now runs at most once an hour per user, like the workshop reminder (the hour starts
 * after a scan that succeeded, a failed one is tried again after five minutes). Its own map, so a workshop scan never
 * holds back the follow-up scan of the same user.
 */
const crmReminderScans = new Map<number, number>();

/** The bell's call: the follow-up reminder scan, at most once an hour per user. */
export async function generateCrmDueRemindersThrottled(userId: number, nowMs = Date.now()): Promise<number> {
  return runThrottledReminderScan(userId, nowMs, async () => { await generateCrmDueReminders(userId); return 0; }, crmReminderScans);
}

/** Tests only: lets the next bell request scan the follow-ups at once (of one user, or of every user). */
export function forgetCrmReminderScan(userId?: number): void {
  if (userId === undefined) crmReminderScans.clear();
  else crmReminderScans.delete(userId);
}

export async function generateCrmDueReminders(userId: number): Promise<void> {
  const todayIso = await businessTodayIsoDate();
  const condition = await ownDueFollowupCondition(userId, todayIso);
  if (!condition) return;
  const due = await orm.select().from(crmActivities).where(condition);

  for (const act of due) {
    const dueDate = toPersianDigits(isoToJalaliDate(act.nextFollowUpDate));
    const notifLink = `/crm?activityId=${act.id}`;
    const [existing] = await orm
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(
        eq(notifications.userId, userId),
        eq(notifications.link, notifLink),
        // v7.0.132: اعلان «تسک جدید» همین پیوند را دارد و پیش‌تر جلوی یادآوری سررسید را می‌گرفت
        // v9.0.434 (TD-717): یادآوری کنارگذاشته (dismissed_at) هم شمرده می‌شود، پس دوباره ساخته نمی‌شود
        eq(notifications.type, 'crm_due_task'),
      ));
    if (existing) continue;
    // v9.0.434 (TD-717): uq_notifications_due_reminder makes a concurrent second insert a no-op (and sends nothing)
    await orm.transaction(tx => createNotifications(tx, [{
      userId,
      category: 'crm_followup',
      senderId: null,
      senderName: 'سامانه ارتباط با مشتری',
      type: 'crm_due_task',
      title: '⏰ سررسید پیگیری ارتباط با مشتری',
      message: `سررسید پیگیری: "${act.nextFollowUpTask || act.title}" (تاریخ: ${dueDate})`,
      link: notifLink,
    }], { skipExisting: true }));
  }
}
