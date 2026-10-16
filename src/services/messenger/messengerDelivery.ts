import { and, eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { userMessengerLinks, userNotificationPreferences, users } from '../../db/schema.js';
import { isMessenger } from '../../lib/messenger/messengerLinks.js';
import { messengerMessageWithLink, notificationAbsoluteLink } from '../../lib/notifications/notificationCategories.js';
import type { BaseDomainEvent } from '../events/domainEvents.js';
import type { DeliveryAttemptOutcome } from '../events/integrationDelivery.service.js';
import { readBot } from './messengerBots.service.js';
import { sendBotMessage } from './messengerClient.js';
import { closeBlockedLink } from './messengerLinks.service.js';

/**
 * v10.1.39 (messenger notifications plan part 2, §2.3): one attempt of a `messenger` delivery job. The job's target is the
 * user's link; its event carries the text written with the notification. A closed link or a removed bot closes the job
 * without a dead letter; a 403 (the user blocked the bot) closes the link too, which the profile then shows; a network
 * error, 429 or 5xx is retried by the delivery worker (a 429 not before its retry_after), any other refusal goes to the dead
 * letter queue. Checked again when it is sent: a user deleted meanwhile, or a category the user turned off meanwhile,
 * closes the job without sending.
 * The link is the app's address (`APP_URL`) and the notification's own path.
 */
export async function deliverMessengerJob(linkId: number, event: BaseDomainEvent): Promise<DeliveryAttemptOutcome> {
  const payload = (event.payload ?? {}) as { text?: unknown; link?: unknown; category?: unknown };
  const text = String(payload.text ?? '').trim();
  if (!text) return { ok: false, error: 'Messenger job has no text', retryable: false };

  const [link] = await orm.select({
    id: userMessengerLinks.id,
    userId: userMessengerLinks.userId,
    messenger: userMessengerLinks.messenger,
    chatId: userMessengerLinks.chatId,
    isActive: userMessengerLinks.isActive,
    userDeleted: users.isDeleted,
  }).from(userMessengerLinks)
    .leftJoin(users, eq(users.id, userMessengerLinks.userId))
    .where(eq(userMessengerLinks.id, linkId));
  if (!link || link.isActive !== 1) return { ok: false, cancelled: true, error: 'Messenger link is closed' };
  if (link.userDeleted !== 0) return { ok: false, cancelled: true, error: 'The user of the link is deleted' };
  const [preference] = await orm.select({ sendToMessenger: userNotificationPreferences.sendToMessenger })
    .from(userNotificationPreferences)
    .where(and(eq(userNotificationPreferences.userId, link.userId), eq(userNotificationPreferences.category, String(payload.category ?? ''))));
  if (preference?.sendToMessenger === 0) return { ok: false, cancelled: true, error: 'The user turned this category off' };
  if (!isMessenger(link.messenger)) return { ok: false, error: `Unknown messenger ${link.messenger}`, retryable: false };

  const bot = await readBot(link.messenger);
  if (!bot) return { ok: false, cancelled: true, error: `No ${link.messenger} bot is configured` };

  const message = messengerMessageWithLink(text, notificationAbsoluteLink(process.env.APP_URL, String(payload.link ?? '')));
  const sent = await sendBotMessage(link.messenger, bot.token, link.chatId, message);
  if (sent.ok) return { ok: true };
  if (sent.blocked) {
    await closeBlockedLink(link.messenger, link.id);
    return { ok: false, cancelled: true, error: `Bot was blocked (HTTP 403); link #${link.id} closed` };
  }
  return {
    ok: false,
    error: `HTTP ${sent.status}: ${sent.description ?? ''}`.trim(),
    retryable: sent.retryable,
    ...(sent.retryAfterSeconds ? { retryAfterSeconds: sent.retryAfterSeconds } : {}),
  };
}
