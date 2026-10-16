import type { Request } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { userNotificationPreferences, users } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import {
  NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, type MessengerPreference, type NotificationCategory,
} from '../../lib/notifications/notificationCategories.js';

/**
 * v10.1.39 (messenger notifications plan part 2, §2.3): «در پیام‌رسان هم بفرست» per notification category, in the user's
 * own profile. Every category is on until the user turns it off; the bell keeps every notification either way.
 */
/** Same audit entity as a link change (`MESSENGER_LINK_AUDIT_ENTITY`): both are the user's own messenger settings */
const MESSENGER_PREFERENCE_AUDIT_ENTITY = 'اتصال پیام‌رسان';

export async function listMyPreferences(userId: number): Promise<MessengerPreference[]> {
  const rows = await orm.select({ category: userNotificationPreferences.category, sendToMessenger: userNotificationPreferences.sendToMessenger })
    .from(userNotificationPreferences).where(eq(userNotificationPreferences.userId, userId));
  const off = new Set(rows.filter(r => r.sendToMessenger === 0).map(r => r.category));
  return NOTIFICATION_CATEGORIES.map(category => ({ category, label: NOTIFICATION_CATEGORY_LABELS[category], sendToMessenger: !off.has(category) }));
}

/** Sets one category under the user's row lock, with its audit row; a repeat changes nothing and writes nothing */
export async function setMyPreference(userId: number, category: NotificationCategory, sendToMessenger: boolean, req?: Request): Promise<MessengerPreference[]> {
  await orm.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const [current] = await tx.select({ sendToMessenger: userNotificationPreferences.sendToMessenger })
      .from(userNotificationPreferences)
      .where(and(eq(userNotificationPreferences.userId, userId), eq(userNotificationPreferences.category, category)));
    const before = current ? current.sendToMessenger === 1 : true;
    if (before === sendToMessenger) return;
    const flag = sendToMessenger ? 1 : 0;
    await tx.insert(userNotificationPreferences).values({ userId, category, sendToMessenger: flag })
      .onConflictDoUpdate({
        target: [userNotificationPreferences.userId, userNotificationPreferences.category],
        set: { sendToMessenger: flag, updatedAt: sql`now()` },
      });
    await logActivity({
      tx,
      req,
      action: 'UPDATE',
      entity: MESSENGER_PREFERENCE_AUDIT_ENTITY,
      entityId: userId,
      description: sendToMessenger
        ? `کاربر «${NOTIFICATION_CATEGORY_LABELS[category]}» را در پیام‌رسان روشن کرد`
        : `کاربر «${NOTIFICATION_CATEGORY_LABELS[category]}» را در پیام‌رسان خاموش کرد`,
      details: { category, before: { sendToMessenger: before }, after: { sendToMessenger } },
    });
  });
  return listMyPreferences(userId);
}
