import { ADVISORY_LOCK_KEYS, withAdvisoryLock } from '../../lib/advisoryLock.js';
import { isStopCommand, MESSENGERS, parseLinkCode, type Messenger } from '../../lib/messenger/messengerLinks.js';
import { logger } from '../../middleware/logger.js';
import { readBot } from './messengerBots.service.js';
import { getBotUpdates, sendBotMessage, type BotUpdate } from './messengerClient.js';
import { closeChatLink, completeLinkFromChat } from './messengerLinks.service.js';

/**
 * v10.1.38 (messenger notifications plan part 1, §2.2): reads what users send to the staff bots with `getUpdates` (no
 * address on the server has to be opened to the internet). One pass at a time under the session advisory lock
 * `MESSENGER_UPDATES`. Only private chats count: a six-digit code links the chat to the code's user, «/stop» closes the
 * chat's link, anything else gets the short help text. Wrong codes are limited per chat (five in ten minutes), so a code
 * cannot be guessed. The offset of each bot is kept in memory: after a restart the bot API sends the updates not yet
 * confirmed again, and handling one twice changes nothing (a used code is gone, a closed link stays closed).
 */
const WRONG_CODE_LIMIT = 5;
const WRONG_CODE_WINDOW_MS = 10 * 60 * 1000;

export const BOT_REPLIES = {
  help: 'سلام. برای وصل شدن به پاپیتال، در برنامه به «نمایه ← پیام‌رسان» بروید، «اتصال» را بزنید و کد شش‌رقمی را همین‌جا بفرستید.',
  invalidCode: 'این کد درست نیست یا زمانش گذشته است. در «نمایه ← پیام‌رسان» کد تازه بگیرید و دوباره بفرستید.',
  tooManyCodes: 'چند بار کد نادرست فرستادید. ده دقیقه بعد دوباره بکوشید.',
  stopped: 'اتصال شما به پاپیتال قطع شد و دیگر اعلانی اینجا نمی‌رسد. برای وصل شدن دوباره از «نمایه ← پیام‌رسان» کد تازه بگیرید.',
  notLinked: 'این گفت‌وگو به حسابی در پاپیتال وصل نیست.',
  linked: (fullName: string) => `${fullName}، حساب شما در پاپیتال به این گفت‌وگو وصل شد. از این پس اعلان‌های شما اینجا هم می‌رسد. برای قطع، /stop را بفرستید.`,
} as const;

function chatDisplayName(chat: NonNullable<BotUpdate['message']>['chat']): string {
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  return chat.username ? `@${chat.username}` : '';
}

export class MessengerUpdatePoller {
  private static intervalId: NodeJS.Timeout | null = null;
  private static offsets = new Map<Messenger, number>();
  private static wrongCodes = new Map<string, { count: number; since: number }>();

  /** Test hook: forgets offsets and wrong-code counts */
  static reset(): void {
    this.offsets.clear();
    this.wrongCodes.clear();
  }

  private static tooManyWrongCodes(key: string, now: number): boolean {
    const entry = this.wrongCodes.get(key);
    return Boolean(entry && now - entry.since < WRONG_CODE_WINDOW_MS && entry.count >= WRONG_CODE_LIMIT);
  }

  private static countWrongCode(key: string, now: number): void {
    const entry = this.wrongCodes.get(key);
    if (!entry || now - entry.since >= WRONG_CODE_WINDOW_MS) this.wrongCodes.set(key, { count: 1, since: now });
    else entry.count += 1;
  }

  /** The reply to one message of a private chat (null: nothing to answer) */
  static async handleMessage(messenger: Messenger, update: BotUpdate, now = Date.now()): Promise<string | null> {
    const message = update.message;
    if (!message?.chat || (message.chat.type && message.chat.type !== 'private')) return null;
    const text = String(message.text ?? '').trim();
    const chatId = String(message.chat.id);
    if (isStopCommand(text)) {
      const closed = await closeChatLink(messenger, chatId, 'stop');
      return closed > 0 ? BOT_REPLIES.stopped : BOT_REPLIES.notLinked;
    }
    const code = parseLinkCode(text);
    if (!code) return BOT_REPLIES.help;
    const key = `${messenger}:${chatId}`;
    if (this.tooManyWrongCodes(key, now)) return BOT_REPLIES.tooManyCodes;
    const outcome = await completeLinkFromChat(messenger, chatId, chatDisplayName(message.chat), code);
    if (outcome.status === 'linked') {
      this.wrongCodes.delete(key);
      return BOT_REPLIES.linked(outcome.fullName);
    }
    this.countWrongCode(key, now);
    return BOT_REPLIES.invalidCode;
  }

  /** One pass over one bot: its new updates, each answered, then the offset moves past them */
  static async pollMessenger(messenger: Messenger): Promise<number> {
    const bot = await readBot(messenger);
    if (!bot) return 0;
    const res = await getBotUpdates(messenger, bot.token, this.offsets.get(messenger));
    if (!res.ok) {
      logger.warn(`[Messenger] getUpdates of the ${messenger} bot failed: HTTP ${res.status} ${res.description ?? ''}`);
      return 0;
    }
    const updates = Array.isArray(res.result) ? res.result : [];
    for (const update of updates) {
      try {
        const reply = await this.handleMessage(messenger, update);
        const chatId = update.message?.chat?.id;
        if (reply && chatId !== undefined) {
          const sent = await sendBotMessage(messenger, bot.token, String(chatId), reply);
          if (!sent.ok) logger.warn(`[Messenger] Reply of the ${messenger} bot was not delivered: HTTP ${sent.status}`);
        }
      } catch (err) {
        logger.error(`[Messenger] Update ${update.update_id} of the ${messenger} bot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.offsets.set(messenger, Math.max(this.offsets.get(messenger) ?? 0, Number(update.update_id) + 1));
    }
    return updates.length;
  }

  /** One pass over both bots, skipped when another pass holds the lock */
  static async pollOnce(): Promise<number> {
    const outcome = await withAdvisoryLock(ADVISORY_LOCK_KEYS.MESSENGER_UPDATES, async () => {
      let handled = 0;
      for (const messenger of MESSENGERS) handled += await this.pollMessenger(messenger);
      return handled;
    });
    return outcome.acquired ? outcome.result : 0;
  }

  static start(intervalMs = 5000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.pollOnce().catch(err => logger.error(`[Messenger] Update poll error: ${err instanceof Error ? err.message : String(err)}`));
    }, intervalMs);
    logger.info(`[Messenger] Update poller started with interval ${intervalMs}ms`);
  }

  static stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }
}

