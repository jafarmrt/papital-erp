import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { crmActivities, notifications, personnel, users } from '../../db/schema.js';
import { businessTodayIsoDate } from '../../lib/businessClock.js';
import { isoToJalaliDate, toPersianDigits } from '../../utils.js';
import { dueFollowupCondition } from '../crm/crmFollowups.js';

/**
 * v9.0.413 (TD-709، B15-07): پیگیری سررسیدشده‌ای که زنگ اعلان به یک کاربر یادآوری می‌کند فقط پیگیری خود اوست: مسئولی که
 * شناسه پرسنلش (`assigned_personnel_id`) به همین کاربر پیوند دارد، و برای ردیف قدیمی بی شناسه، نام مسئول (یا ثبت‌کننده)
 * بریده‌شده که دقیقاً نام کامل یا نام کاربری اوست؛ هرگز «شامل». پیش‌تر کاربر «علی» یادآوری پیگیری «علیرضا …» را با عنوان
 * پیگیری و نام مشتری می‌گرفت.
 */
export async function ownDueFollowupCondition(userId: number, todayIso: string): Promise<SQL | null> {
  const [user] = await orm.select({ fullName: users.fullName, username: users.username }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  const names = [...new Set([(user.fullName ?? '').trim(), (user.username ?? '').trim()].filter(Boolean))];
  const linkedPersonnel = orm.select({ id: personnel.id }).from(personnel).where(and(eq(personnel.userId, userId), eq(personnel.isDeleted, 0)));
  const byPersonnel = inArray(crmActivities.assignedPersonnelId, linkedPersonnel);
  const legacyAssignee = sql<string>`btrim(COALESCE(NULLIF(btrim(${crmActivities.assignedTo}), ''), ${crmActivities.loggedBy}, ''))`;
  const byExactName = names.length > 0 ? and(isNull(crmActivities.assignedPersonnelId), inArray(legacyAssignee, names)) : undefined;
  return and(dueFollowupCondition(todayIso), byExactName ? or(byPersonnel, byExactName) : byPersonnel) as SQL;
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
        // v9.0.414 (TD-717): یادآوری کنارگذاشته (dismissed_at) هم شمرده می‌شود، پس دوباره ساخته نمی‌شود
        eq(notifications.type, 'crm_due_task'),
      ));
    if (existing) continue;
    // v9.0.414 (TD-717): uq_notifications_due_reminder makes a concurrent second insert a no-op
    await orm.insert(notifications).values({
      userId,
      senderId: null,
      senderName: 'سامانه ارتباط با مشتری',
      type: 'crm_due_task',
      title: '⏰ سررسید پیگیری ارتباط با مشتری',
      message: `سررسید پیگیری: "${act.nextFollowUpTask || act.title}" (تاریخ: ${dueDate})`,
      link: notifLink,
      isRead: 0,
    }).onConflictDoNothing();
  }
}
