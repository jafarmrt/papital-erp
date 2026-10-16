import { eq } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { userMessengerLinks } from '../../db/schema.js';
import { isMessenger } from '../../lib/messenger/messengerLinks.js';
import { messengerMessageWithLink, notificationAbsoluteLink } from '../../lib/notifications/notificationCategories.js';
import type { BaseDomainEvent } from '../events/domainEvents.js';
import type { DeliveryAttemptOutcome } from '../events/integrationDelivery.service.js';
import { readBot } from './messengerBots.service.js';
import { sendBotMessage } from './messengerClient.js';
import { closeChatLink } from './messengerLinks.service.js';

/**
 * v10.1.39 (messenger notifications plan part 2, §2.3): one attempt of a `messenger` delivery job. The job's target is the
 * user's link; its event carries the text written with the notification. A closed link or a removed bot closes the job
 * without a dead letter; a 403 (the user blocked the bot) closes the link too, which the profile then shows; a network
 * error, 429 or 5xx is retried by the delivery worker, any other refusal goes to the dead letter queue.
 * The link is the app's address (`APP_URL`) and the notification's own path.
 */
export async function deliverMessengerJob(linkId: number, event: BaseDomainEvent): Promise<DeliveryAttemptOutcome> {
  const payload = (event.payload ?? {}) as { text?: unknown; link?: unknown };
  const text = String(payload.text ?? '').trim();
  if (!text) return { ok: false, error: 'Messenger job has no text', retryable: false };

  const [link] = await orm.select().from(userMessengerLinks).where(eq(userMessengerLinks.id, linkId));
  if (!link || link.isActive !== 1) return { ok: false, cancelled: true, error: 'Messenger link is closed' };
  if (!isMessenger(link.messenger)) return { ok: false, error: `Unknown messenger ${link.messenger}`, retryable: false };

  const bot = await readBot(link.messenger);
  if (!bot) return { ok: false, cancelled: true, error: `No ${link.messenger} bot is configured` };

  const message = messengerMessageWithLink(text, notificationAbsoluteLink(process.env.APP_URL, String(payload.link ?? '')));
  const sent = await sendBotMessage(link.messenger, bot.token, link.chatId, message);
  if (sent.ok) return { ok: true };
  if (sent.blocked) {
    await closeChatLink(link.messenger, link.chatId, 'blocked');
    return { ok: false, cancelled: true, error: `Bot was blocked (HTTP 403); link #${link.id} closed` };
  }
  return { ok: false, error: `HTTP ${sent.status}: ${sent.description ?? ''}`.trim(), retryable: sent.retryable };
}
