import { and, eq, inArray } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '../../db/drizzle.js';
import { integrationDeliveryJobs, notifications, userMessengerLinks, userNotificationPreferences, users } from '../../db/schema.js';
import { isBellOnlyCategory, isNotificationCategory, messengerLinkPath, messengerNotificationText, type NotificationCategory } from '../../lib/notifications/notificationCategories.js';

/**
 * v10.1.41 (messenger notifications plan part 2, §2.3): the one way an in-app notification is written. In the caller's
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
  /**
   * v11 phase 6.2 (X6): keep this one in the bell. Its category's fixed messenger sentence would say something else (the
   * account-link notice is filed under `payslip`, whose sentence is «فیش حقوق شما تأیید شد.»).
   */
  bellOnly?: boolean;
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

async function queueMessengerJobs(tx: DbTransaction, allWritten: ReadonlyArray<NewNotification & { id: number }>): Promise<void> {
  // v10.2 package 9: a bell-only category (birthdays and greetings) never goes to the messenger
  const written = allWritten.filter(n => !isBellOnlyCategory(n.category) && !n.bellOnly);
  if (written.length === 0) return;
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
    const eventId = messengerDeliveryEventId(n.id);
    return {
      kind: MESSENGER_DELIVERY_KIND,
      targetId: link.id,
      eventId,
      eventType: MESSENGER_DELIVERY_EVENT_TYPE,
      event: messengerDeliveryEvent(n.id, { ...n, recipientName: link.fullName ?? '', messenger: link.messenger }),
      maxAttempts: MESSENGER_DELIVERY_MAX_ATTEMPTS,
    };
  }));
  if (jobs.length > 0) await tx.insert(integrationDeliveryJobs).values(jobs).onConflictDoNothing();
}

interface MessengerEventSource {
  userId: number;
  recipientName: string;
  messenger: string;
  category: NotificationCategory;
  title: string;
  message: string;
  link?: string | null;
}

/** The event of one messenger job: its text and link written from the notification by the category's rule */
function messengerDeliveryEvent(notificationId: number, source: MessengerEventSource) {
  const payload: MessengerDeliveryPayload = {
    notificationId,
    userId: source.userId,
    messenger: source.messenger,
    category: source.category,
    text: messengerNotificationText({ recipientName: source.recipientName, category: source.category, title: source.title, message: source.message }),
    link: messengerLinkPath(source.category, source.link),
  };
  const eventId = messengerDeliveryEventId(notificationId);
  return {
    eventId,
    eventType: MESSENGER_DELIVERY_EVENT_TYPE,
    aggregateType: 'notification',
    aggregateId: String(notificationId),
    payload,
    metadata: {},
    occurredAt: new Date().toISOString(),
  };
}

/** The notification id of a messenger job, read from its event id (`notification:<id>`), never from its payload */
export function messengerJobNotificationId(eventId: string): number | null {
  const match = /^notification:(\d+)$/.exec(eventId);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * v10.1.41: a dead letter replay of a messenger job never sends the payload it is given (a payload edited in the dead
 * letter queue could carry any text, amount or address): the event is written again from the notification row, the
 * recipient's name and the category the job was queued with (an unknown one reads as `event_rule`, a fixed sentence),
 * by the same rule as `createNotifications`. Null when the notification or its link is gone.
 */
export async function rebuildMessengerJobEvent(
  executor: DbExecutor,
  job: { eventId: string; targetId: number; event: unknown },
): Promise<ReturnType<typeof messengerDeliveryEvent> | null> {
  const notificationId = messengerJobNotificationId(job.eventId);
  if (notificationId === null) return null;
  const [row] = await executor.select({
    userId: notifications.userId,
    title: notifications.title,
    message: notifications.message,
    link: notifications.link,
    recipientName: users.fullName,
  }).from(notifications)
    .leftJoin(users, eq(users.id, notifications.userId))
    .where(eq(notifications.id, notificationId));
  if (!row) return null;
  const [link] = await executor.select({ userId: userMessengerLinks.userId, messenger: userMessengerLinks.messenger })
    .from(userMessengerLinks).where(eq(userMessengerLinks.id, job.targetId));
  if (!link || link.userId !== row.userId) return null;
  const queued = ((job.event as { payload?: { category?: unknown } } | null)?.payload ?? {}).category;
  const category: NotificationCategory = isNotificationCategory(queued) ? queued : 'event_rule';
  return messengerDeliveryEvent(notificationId, {
    userId: row.userId,
    recipientName: row.recipientName ?? '',
    messenger: link.messenger,
    category,
    title: row.title ?? '',
    message: row.message ?? '',
    link: row.link,
  });
}
