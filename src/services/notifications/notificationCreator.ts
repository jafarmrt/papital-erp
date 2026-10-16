import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '../../db/drizzle.js';
import { integrationDeliveryJobs, notifications, userMessengerLinks, userNotificationPreferences, users } from '../../db/schema.js';
import { messengerLinkPath, messengerNotificationText, type NotificationCategory } from '../../lib/notifications/notificationCategories.js';

/**
 * v10.1.39 (messenger notifications plan part 2, §2.3): the one way an in-app notification is written. In the caller's
 * transaction it writes the bell row and, for each active messenger link of the recipient whose category the user has not
 * turned off, one delivery job of kind `messenger` in `integration_delivery_jobs`; the delivery worker sends it, retries a
 * failed send and moves one that never arrives to the dead letter queue. So a write that rolls back sends nothing.
 * No production file outside this one inserts into `notifications` (Vitest `messengerDelivery.test.ts`).
 */
export const MESSENGER_DELIVERY_KIND = 'messenger';
export const MESSENGER_DELIVERY_EVENT_TYPE = 'MessengerNotification';
/** 5 s doubling to 5 min: about twenty minutes before a send that keeps failing goes to the dead letter queue */
export const MESSENGER_DELIVERY_MAX_ATTEMPTS = 10;

export interface NewNotification {
  userId: number;
  category: NotificationCategory;
  /** the bell's own type, kept as before (`mention`, `task`, `system`, `crm_due_task` …) */
  type: string;
  title: string;
  message: string;
  link?: string;
  senderId?: number | null;
  senderName?: string;
}

/** The delivery event a messenger job carries (the dead letter queue reads its aggregate and payload) */
export interface MessengerDeliveryPayload {
  notificationId: number;
  userId: number;
  messenger: string;
  category: NotificationCategory;
  text: string;
  link: string;
}

export function messengerDeliveryEventId(notificationId: number): string {
  return `notification:${notificationId}`;
}

export interface CreateNotificationsOptions {
  /** skip a row the bell already has (a unique index such as `uq_notifications_due_reminder`); a skipped row sends nothing */
  skipExisting?: boolean;
}

/** Writes the notifications and queues their messenger jobs; returns the ids of the written notifications */
export async function createNotifications(tx: DbTransaction, items: readonly NewNotification[], options: CreateNotificationsOptions = {}): Promise<number[]> {
  const written: Array<NewNotification & { id: number }> = [];
  for (const item of items) {
    const insert = tx.insert(notifications).values({
      userId: item.userId,
      senderId: item.senderId ?? null,
      senderName: item.senderName ?? '',
      type: item.type,
      title: item.title,
      message: item.message,
      link: item.link ?? '',
      isRead: 0,
    });
    const [row] = options.skipExisting
      ? await insert.onConflictDoNothing().returning({ id: notifications.id })
      : await insert.returning({ id: notifications.id });
    if (row) written.push({ ...item, id: row.id });
  }
  if (written.length === 0) return [];
  await queueMessengerJobs(tx, written);
  return written.map(n => n.id);
}

async function queueMessengerJobs(tx: DbTransaction, written: ReadonlyArray<NewNotification & { id: number }>): Promise<void> {
  const userIds = [...new Set(written.map(n => n.userId))];
  const links = await tx.select({
    id: userMessengerLinks.id,
    userId: userMessengerLinks.userId,
    messenger: userMessengerLinks.messenger,
    fullName: users.fullName,
  }).from(userMessengerLinks)
    .innerJoin(users, eq(users.id, userMessengerLinks.userId))
    .where(and(inArray(userMessengerLinks.userId, userIds), eq(userMessengerLinks.isActive, 1), eq(users.isDeleted, 0)))
    .orderBy(userMessengerLinks.id);
  if (links.length === 0) return;
  const turnedOff = await tx.select({ userId: userNotificationPreferences.userId, category: userNotificationPreferences.category })
    .from(userNotificationPreferences)
    .where(and(inArray(userNotificationPreferences.userId, userIds), eq(userNotificationPreferences.sendToMessenger, 0)));
  const off = new Set(turnedOff.map(p => `${p.userId}:${p.category}`));

  const jobs = written.flatMap(n => off.has(`${n.userId}:${n.category}`) ? [] : links.filter(l => l.userId === n.userId).map(link => {
    const payload: MessengerDeliveryPayload = {
      notificationId: n.id,
      userId: n.userId,
      messenger: link.messenger,
      category: n.category,
      text: messengerNotificationText({ recipientName: link.fullName ?? '', category: n.category, title: n.title, message: n.message }),
      link: messengerLinkPath(n.category, n.link),
    };
    const eventId = messengerDeliveryEventId(n.id);
    return {
      kind: MESSENGER_DELIVERY_KIND,
      targetId: link.id,
      eventId,
      eventType: MESSENGER_DELIVERY_EVENT_TYPE,
      event: {
        eventId,
        eventType: MESSENGER_DELIVERY_EVENT_TYPE,
        aggregateType: 'notification',
        aggregateId: String(n.id),
        payload,
        metadata: {},
        occurredAt: new Date().toISOString(),
      },
      maxAttempts: MESSENGER_DELIVERY_MAX_ATTEMPTS,
    };
  }));
  if (jobs.length > 0) await tx.insert(integrationDeliveryJobs).values(jobs).onConflictDoNothing();
}
