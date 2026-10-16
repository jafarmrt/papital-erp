import type { Request } from 'express';
import { and, count, eq, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { messengerBots, userMessengerLinks, users } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { decryptSecret, encryptSecret } from '../../lib/secretBox.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import { isBotTokenShape, MESSENGER_LABELS, MESSENGERS, type Messenger, type MessengerBotView } from '../../lib/messenger/messengerLinks.js';
import { getBotUsername } from './messengerClient.js';

/**
 * v10.1.38 (messenger notifications plan part 1, product-owner decision ت۱ الف): the two staff bots. Only the system admin
 * enters a bot's token, from the settings tab «ربات‌های پیام‌رسان»; the server checks it with the bot API (`getMe`), stores
 * it only through `encryptSecret` (AGENTS §5, `ERP_SECRETS_KEY`) and never sends it back, not even masked. Changing or
 * removing the bot of a messenger closes that messenger's links (`bot_changed`), since their chats belong to the old bot,
 * and starts its update offset and wrong-code count again.
 */
export const MESSENGER_BOT_AUDIT_ENTITY = 'ربات پیام‌رسان';

export interface StoredBot {
  token: string;
  botUsername: string;
  /** the next `getUpdates` offset (0: none read yet) */
  updateOffset: number;
}

/** The bot of a messenger with its token opened, or null when none is set or the current key cannot open it */
export async function readBot(messenger: Messenger): Promise<StoredBot | null> {
  const [row] = await orm.select().from(messengerBots).where(eq(messengerBots.messenger, messenger));
  if (!row || !row.token) return null;
  const token = decryptSecret(row.token);
  return token ? { token, botUsername: row.botUsername, updateOffset: Number(row.updateOffset ?? 0) } : null;
}

export async function listBotViews(): Promise<MessengerBotView[]> {
  const rows = await orm.select().from(messengerBots);
  const links = await orm.select({ messenger: userMessengerLinks.messenger, n: count() }).from(userMessengerLinks)
    .innerJoin(users, eq(users.id, userMessengerLinks.userId))
    .where(and(eq(userMessengerLinks.isActive, 1), eq(users.isDeleted, 0))).groupBy(userMessengerLinks.messenger);
  return MESSENGERS.map((messenger) => {
    const row = rows.find(r => r.messenger === messenger);
    const configured = Boolean(row?.token);
    return {
      messenger,
      configured,
      tokenReadable: configured ? Boolean(decryptSecret(row?.token)) : false,
      botUsername: configured ? row?.botUsername ?? '' : '',
      updatedAt: serverTimestampToUtcIso(row?.updatedAt ?? null),
      activeLinks: Number(links.find(l => l.messenger === messenger)?.n ?? 0),
    };
  });
}

/**
 * Saves (or, with an empty token, removes) a messenger's bot. A token not in the bot makers' shape (`BOT_TOKEN_PATTERN`,
 * never sent to the bot API) or one the bot API refuses is 422 `MESSENGER_TOKEN_INVALID` and nothing is written; the
 * token never enters the audit row.
 */
export async function saveBotToken(params: { messenger: Messenger; token: string; req?: Request }): Promise<MessengerBotView> {
  const { messenger } = params;
  const token = params.token.trim();
  let botUsername = '';
  if (token) {
    const username = isBotTokenShape(token) ? await getBotUsername(messenger, token) : null;
    if (username === null) {
      throw new ValidationError(`ربات ${MESSENGER_LABELS[messenger]} این نشانه را نپذیرفت. نشانه را دوباره از سازنده ربات بگیرید و کامل وارد کنید.`, undefined, 'MESSENGER_TOKEN_INVALID');
    }
    botUsername = username;
  }
  const sealed = token ? encryptSecret(token) : '';
  const userId = (params.req?.user as { id?: number } | undefined)?.id ?? null;
  await orm.transaction(async (tx) => {
    const [before] = await tx.select().from(messengerBots).where(eq(messengerBots.messenger, messenger)).for('update');
    const beforeUsername = before?.token ? before.botUsername : '';
    // the same bot keeps its offset and counter; another bot, or none, starts again
    const sameBot = Boolean(token && beforeUsername && beforeUsername.toLowerCase() === botUsername.toLowerCase());
    const fresh = sameBot ? {} : { updateOffset: 0, wrongCodesCount: 0, wrongCodesSince: null };
    await tx.insert(messengerBots).values({ messenger, token: sealed, botUsername, updatedById: userId, updatedAt: sql`now()` })
      .onConflictDoUpdate({ target: messengerBots.messenger, set: { token: sealed, botUsername, updatedById: userId, updatedAt: sql`now()`, ...fresh } });
    let closedLinks = 0;
    if (!sameBot) {
      const closed = await tx.update(userMessengerLinks)
        .set({ isActive: 0, unlinkedAt: sql`now()`, unlinkReason: 'bot_changed' })
        .where(and(eq(userMessengerLinks.messenger, messenger), eq(userMessengerLinks.isActive, 1)))
        .returning({ id: userMessengerLinks.id });
      closedLinks = closed.length;
    }
    await logActivity({
      tx,
      req: params.req,
      action: 'SETTING_CHANGE',
      entity: MESSENGER_BOT_AUDIT_ENTITY,
      entityId: messenger,
      description: token
        ? `ربات ${MESSENGER_LABELS[messenger]} کارکنان تنظیم شد (@${botUsername})`
        : `ربات ${MESSENGER_LABELS[messenger]} کارکنان برداشته شد`,
      details: { before: { botUsername: beforeUsername }, after: { botUsername }, closedLinks },
    });
  });
  const views = await listBotViews();
  return views.find(v => v.messenger === messenger) as MessengerBotView;
}
