import { and, eq, isNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { notifications } from '../../db/schema.js';

/**
 * v10.0.248 (TD-960، OBS-R2-01): نوشتن‌های زنگ اعلان (خواندن یک اعلان، خواندن همه و کنار گذاشتن) از route به این سرویس
 * آمد؛ رفتار همان است: هر کاربر فقط اعلان خودش را تغییر می‌دهد و اعلان کنارگذاشته (v9.0.434، TD-717) با `dismissed_at`
 * می‌ماند و دوباره کنار گذاشته نمی‌شود.
 */
export async function markNotificationRead(userId: number, notificationId: number): Promise<void> {
  await orm
    .update(notifications)
    .set({ isRead: 1 })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number): Promise<void> {
  await orm
    .update(notifications)
    .set({ isRead: 1 })
    .where(eq(notifications.userId, userId));
}

export async function dismissNotification(userId: number, notificationId: number): Promise<void> {
  await orm
    .update(notifications)
    .set({ dismissedAt: sql`now()` })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.dismissedAt)));
}
