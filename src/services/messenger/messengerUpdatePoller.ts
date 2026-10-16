import { and, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { messengerBots } from '../../db/schema.js';
import { ROW_ADVISORY_LOCK_NAMESPACES, withRowAdvisoryLock } from '../../lib/advisoryLock.js';
import { isStopCommand, MESSENGERS, parseLinkCode, type Messenger } from '../../lib/messenger/messengerLinks.js';
import { logger } from '../../middleware/logger.js';
import { readBot } from './messengerBots.service.js';
import { getBotUpdates, sendBotMessage, type BotUpdate } from './messengerClient.js';
import { closeChatLink, completeLinkFromChat } from './messengerLinks.service.js';

/**
 * v10.1.38 (messenger notifications plan part 1, §2.2): reads what users send to the staff bots with `getUpdates` (no
 * address on the server has to be opened to the internet). Each bot is read on its own, one pass at a time under the
 * session advisory lock `MESSENGER_BOT_UPDATES` keyed by the bot, so a slow or unreachable bot never holds up the other;
 * a bot whose `getUpdates` fails waits 5 seconds, then twice as long after each further failure up to 5 minutes, and is
 * read normally again after its first success. Only private chats count: a six-digit code links the chat to the code's
 * user, «/stop» closes the chat's link, anything else gets the short help text. Wrong codes are limited per chat (five in
 * ten minutes, in memory) and per bot over every chat (thirty in ten minutes, in `messenger_bots`), so a code cannot be
 * guessed from many chats either. The next offset of each bot is stored in `messenger_bots.update_offset` after every
 * update, under the bot's lock, so a restart never reads old messages again.
 */
const WRONG_CODE_LIMIT = 5;
const WRONG_CODE_WINDOW_MS = 10 * 60 * 1000;
const WRONG_CODE_WINDOW_MINUTES = 10;
/** wrong codes one bot takes from every chat together in ten minutes before it stops reading codes */
export const BOT_WRONG_CODE_LIMIT = 30;
const MAX_TRACKED_CHATS = 10_000;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
/** a long outage is logged on its first failure and then every this many failures */
const BACKOFF_LOG_EVERY = 10;

export const BOT_REPLIES = {
  help: 'سلام. برای وصل شدن به پاپیتال، در برنامه به «نمایه ← پیام‌رسان» بروید، «اتصال» را بزنید و کد شش‌رقمی را همین‌جا بفرستید.',
  invalidCode: 'این کد درست نیست یا زمانش گذشته است. در «نمایه ← پیام‌رسان» کد تازه بگیرید و دوباره بفرستید.',
  tooManyCodes: 'چند بار کد نادرست فرستادید. ده دقیقه بعد دوباره بکوشید.',
  codesPaused: 'اکنون کد اتصال پذیرفته نمی‌شود. چند دقیقه بعد دوباره بکوشید.',
  stopped: 'اتصال شما به پاپیتال قطع شد و دیگر اعلانی اینجا نمی‌رسد. برای وصل شدن دوباره از «نمایه ← پیام‌رسان» کد تازه بگیرید.',
  notLinked: 'این گفت‌وگو به حسابی در پاپیتال وصل نیست.',
  linked: (fullName: string) => `${fullName}، حساب شما در پاپیتال به این گفت‌وگو وصل شد. از این پس اعلان‌های شما اینجا هم می‌رسد. برای قطع، /stop را بفرستید.`,
} as const;

function chatDisplayName(chat: NonNullable<BotUpdate['message']>['chat']): string {
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim();
  if (name) return name;
  return chat.username ? `@${chat.username}` : '';
}

interface PollState {
  failures: number;
  nextAt: number;
  running: boolean;
}

export class MessengerUpdatePoller {
  private static intervalId: NodeJS.Timeout | null = null;
  private static states = new Map<Messenger, PollState>();
  private static wrongCodes = new Map<string, { count: number; since: number }>();

  /** Test hook: forgets the backoff and the per-chat wrong-code counts (the offsets are in the database) */
  static reset(): void {
    this.states.clear();
    this.wrongCodes.clear();
  }

  private static stateOf(messenger: Messenger): PollState {
    let state = this.states.get(messenger);
    if (!state) {
      state = { failures: 0, nextAt: 0, running: false };
      this.states.set(messenger, state);
    }
    return state;
  }

  private static recordFailure(messenger: Messenger, reason: string, now: number): void {
    const state = this.stateOf(messenger);
    state.failures += 1;
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (state.failures - 1), BACKOFF_MAX_MS);
    state.nextAt = now + delay;
    if (state.failures === 1 || state.failures % BACKOFF_LOG_EVERY === 0) {
      logger.warn(`[Messenger] getUpdates of the ${messenger} bot failed (${state.failures} in a row): ${reason}; next try in ${Math.round(delay / 1000)}s`);
    }
  }

  private static recordSuccess(messenger: Messenger): void {
    const state = this.stateOf(messenger);
    if (state.failures > 0) logger.info(`[Messenger] getUpdates of the ${messenger} bot works again after ${state.failures} failures`);
    state.failures = 0;
    state.nextAt = 0;
  }

  private static pruneWrongCodes(now: number): void {
    for (const [key, entry] of this.wrongCodes) {
      if (now - entry.since >= WRONG_CODE_WINDOW_MS) this.wrongCodes.delete(key);
    }
    while (this.wrongCodes.size > MAX_TRACKED_CHATS) {
      const oldest = this.wrongCodes.keys().next().value;
      if (oldest === undefined) break;
      this.wrongCodes.delete(oldest);
    }
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

  /** The bot's wrong codes of the current window (0 when its window has passed) */
  private static async botWrongCodes(messenger: Messenger): Promise<{ count: number; inWindow: boolean }> {
    const [row] = await orm.select({
      count: messengerBots.wrongCodesCount,
      inWindow: sql<boolean>`coalesce(${messengerBots.wrongCodesSince} > now() - make_interval(mins => ${WRONG_CODE_WINDOW_MINUTES}), false)`,
    }).from(messengerBots).where(eq(messengerBots.messenger, messenger));
    const inWindow = Boolean(row?.inWindow);
    return { count: inWindow ? Number(row?.count ?? 0) : 0, inWindow };
  }

  private static async countBotWrongCode(messenger: Messenger): Promise<void> {
    const current = await this.botWrongCodes(messenger);
    const count = current.count + 1;
    await orm.update(messengerBots)
      .set(current.inWindow ? { wrongCodesCount: count } : { wrongCodesCount: count, wrongCodesSince: sql`now()` })
      .where(eq(messengerBots.messenger, messenger));
    if (count === BOT_WRONG_CODE_LIMIT) {
      logger.warn(`[Messenger] The ${messenger} bot got ${count} wrong link codes in ${WRONG_CODE_WINDOW_MINUTES} minutes; link codes are refused until the window ends`);
    }
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
    if ((await this.botWrongCodes(messenger)).count >= BOT_WRONG_CODE_LIMIT) return BOT_REPLIES.codesPaused;
    const outcome = await completeLinkFromChat(messenger, chatId, chatDisplayName(message.chat), code);
    if (outcome.status === 'linked') {
      this.wrongCodes.delete(key);
      return BOT_REPLIES.linked(outcome.fullName);
    }
    this.countWrongCode(key, now);
    await this.countBotWrongCode(messenger);
    return BOT_REPLIES.invalidCode;
  }

  /**
   * One pass over one bot (call it under the bot's lock): skipped while the bot backs off; its new updates, each answered,
   * and the stored offset moved past each one
   */
  static async pollMessenger(messenger: Messenger, now = Date.now()): Promise<number> {
    const state = this.stateOf(messenger);
    if (now < state.nextAt) return 0;
    this.pruneWrongCodes(now);
    const bot = await readBot(messenger);
    if (!bot) {
      state.failures = 0;
      state.nextAt = 0;
      return 0;
    }
    const res = await getBotUpdates(messenger, bot.token, bot.updateOffset > 0 ? bot.updateOffset : undefined);
    if (!res.ok) {
      this.recordFailure(messenger, `HTTP ${res.status} ${res.description ?? ''}`.trim(), now);
      return 0;
    }
    this.recordSuccess(messenger);
    const updates = Array.isArray(res.result) ? res.result : [];
    let offset = bot.updateOffset;
    for (const update of updates) {
      try {
        const reply = await this.handleMessage(messenger, update, now);
        const chatId = update.message?.chat?.id;
        if (reply && chatId !== undefined) {
          const sent = await sendBotMessage(messenger, bot.token, String(chatId), reply);
          if (!sent.ok) logger.warn(`[Messenger] Reply of the ${messenger} bot was not delivered: HTTP ${sent.status}`);
        }
      } catch (err) {
        logger.error(`[Messenger] Update ${update.update_id} of the ${messenger} bot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      offset = Math.max(offset, Number(update.update_id) + 1);
      // only while the same bot is set: a bot changed meanwhile starts from 0
      await orm.update(messengerBots).set({ updateOffset: offset })
        .where(and(eq(messengerBots.messenger, messenger), eq(messengerBots.botUsername, bot.botUsername)));
    }
    return updates.length;
  }

  /** One pass over one bot under its own lock; skipped when another pass of the same bot holds it */
  static async pollMessengerExclusive(messenger: Messenger, now = Date.now()): Promise<number> {
    const outcome = await withRowAdvisoryLock(ROW_ADVISORY_LOCK_NAMESPACES.MESSENGER_BOT_UPDATES, MESSENGERS.indexOf(messenger) + 1, () => this.pollMessenger(messenger, now));
    return outcome.acquired ? outcome.result : 0;
  }

  /** One pass over both bots, one after the other (tests and manual runs; the timer reads each bot on its own) */
  static async pollOnce(): Promise<number> {
    let handled = 0;
    for (const messenger of MESSENGERS) handled += await this.pollMessengerExclusive(messenger);
    return handled;
  }

  /** A timer tick of one bot: never two passes of one bot in this process, and an error counts as a failure */
  private static async tick(messenger: Messenger): Promise<void> {
    const state = this.stateOf(messenger);
    if (state.running) return;
    state.running = true;
    try {
      await this.pollMessengerExclusive(messenger);
    } catch (err) {
      this.recordFailure(messenger, err instanceof Error ? err.message : String(err), Date.now());
    } finally {
      state.running = false;
    }
  }

  static start(intervalMs = 5000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      for (const messenger of MESSENGERS) void this.tick(messenger);
    }, intervalMs);
    logger.info(`[Messenger] Update poller started with interval ${intervalMs}ms`);
  }

  static stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
