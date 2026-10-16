import crypto from 'node:crypto';
import type { Request } from 'express';
import { and, asc, desc, eq, lte, ne, or, sql } from 'drizzle-orm';
import { orm, type DbTransaction } from '../../db/drizzle.js';
import { messengerLinkCodes, userMessengerLinks, users } from '../../db/schema.js';
import { AppError, ConflictError, ValidationError } from '../../errors/customErrors.js';
import { logActivity } from '../../lib/auditLogger.js';
import { serverTimestampToUtcIso } from '../../lib/serverTimestamp.js';
import {
  botStartLink, LINK_CODE_TTL_MINUTES, MESSENGER_LABELS, MESSENGERS, UNLINK_REASONS,
  type LinkCodeIssued, type Messenger, type MessengerLinkAdminRow, type MyMessengerLink, type UnlinkReason,
} from '../../lib/messenger/messengerLinks.js';
import { readBot } from './messengerBots.service.js';
import { sendBotMessage } from './messengerClient.js';

/**
 * v10.1.37 (messenger notifications plan part 1, §2.2): each user's link to the staff bots. A link is made only from the
 * user's own profile: the profile asks for a one-time six-digit code (ten minutes, stored as a hash), the user sends it to
 * the bot, and the update poller (`messengerUpdatePoller.ts`) links that chat to the code's user. A user has at most one
 * active link per messenger and a chat at most one active user (partial unique indexes of migration 0119), so a new link
 * closes the older ones (`relinked`). «قطع اتصال» in the profile, «/stop» to the bot and a 403 from the bot (blocked)
 * each close the link with their reason, which the profile shows. Every link change has its audit row written with `tx`;
 * the chat id never leaves the server.
 */
export const MESSENGER_LINK_AUDIT_ENTITY = 'اتصال پیام‌رسان';

const MAX_CODE_ATTEMPTS = 5;

export function hashLinkCode(messenger: Messenger, code: string): string {
  return crypto.createHash('sha256').update(`${messenger}:${code}`).digest('hex');
}

function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function isUnlinkReason(value: string): value is UnlinkReason {
  return (UNLINK_REASONS as readonly string[]).includes(value);
}

export async function listMyLinks(userId: number): Promise<MyMessengerLink[]> {
  const rows = await orm.select().from(userMessengerLinks)
    .where(eq(userMessengerLinks.userId, userId))
    .orderBy(desc(userMessengerLinks.id));
  const result: MyMessengerLink[] = [];
  for (const messenger of MESSENGERS) {
    const bot = await readBot(messenger);
    const active = rows.find(r => r.messenger === messenger && r.isActive === 1);
    const lastClosed = rows.find(r => r.messenger === messenger && r.isActive !== 1);
    result.push({
      messenger,
      botConfigured: bot !== null,
      botUsername: bot?.botUsername ?? '',
      linked: Boolean(active),
      linkedAt: serverTimestampToUtcIso(active?.linkedAt ?? null),
      chatName: active?.chatName ?? '',
      lastUnlink: !active && lastClosed && isUnlinkReason(lastClosed.unlinkReason)
        ? { at: serverTimestampToUtcIso(lastClosed.unlinkedAt ?? null), reason: lastClosed.unlinkReason }
        : null,
    });
  }
  return result;
}

/** A new code for the user's link (an older unused code of the same messenger stops working) */
export async function issueLinkCode(userId: number, messenger: Messenger): Promise<LinkCodeIssued> {
  const bot = await readBot(messenger);
  if (!bot) {
    throw new ValidationError(`ربات ${MESSENGER_LABELS[messenger]} هنوز راه‌اندازی نشده است. از مدیر سامانه بخواهید آن را در تنظیمات وارد کند.`, undefined, 'MESSENGER_BOT_NOT_CONFIGURED');
  }
  return orm.transaction(async (tx) => {
    await tx.delete(messengerLinkCodes).where(or(
      and(eq(messengerLinkCodes.userId, userId), eq(messengerLinkCodes.messenger, messenger)),
      lte(messengerLinkCodes.expiresAt, sql`now()`),
    ));
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = newCode();
      const [row] = await tx.insert(messengerLinkCodes).values({
        userId,
        messenger,
        codeHash: hashLinkCode(messenger, code),
        expiresAt: sql`now() + make_interval(mins => ${LINK_CODE_TTL_MINUTES})`,
      }).onConflictDoNothing().returning({ expiresAt: messengerLinkCodes.expiresAt });
      if (row) {
        return {
          messenger,
          code,
          expiresAt: serverTimestampToUtcIso(row.expiresAt) ?? '',
          botUsername: bot.botUsername,
          startLink: botStartLink(messenger, bot.botUsername, code),
        };
      }
    }
    throw new AppError('ساختن کد اتصال این بار نشد؛ دوباره بکوشید.', 503, 'MESSENGER_CODE_BUSY');
  });
}

async function closeLinks(tx: DbTransaction, where: ReturnType<typeof and>, reason: UnlinkReason) {
  return tx.update(userMessengerLinks)
    .set({ isActive: 0, unlinkedAt: sql`now()`, unlinkReason: reason })
    .where(and(eq(userMessengerLinks.isActive, 1), where))
    .returning({ id: userMessengerLinks.id, userId: userMessengerLinks.userId });
}

export type CompleteLinkOutcome =
  | { status: 'linked'; userId: number; fullName: string }
  | { status: 'invalid' };

/**
 * A code sent to the bot from a private chat: links that chat to the code's user, closing the user's earlier link of that
 * messenger and the chat's link to another user. An unknown, used or expired code changes nothing.
 */
export async function completeLinkFromChat(messenger: Messenger, chatId: string, chatName: string, code: string): Promise<CompleteLinkOutcome> {
  return orm.transaction(async (tx) => {
    const [codeRow] = await tx.select().from(messengerLinkCodes)
      .where(and(
        eq(messengerLinkCodes.messenger, messenger),
        eq(messengerLinkCodes.codeHash, hashLinkCode(messenger, code)),
        sql`${messengerLinkCodes.expiresAt} > now()`,
      ))
      .for('update');
    if (!codeRow) return { status: 'invalid' } as const;
    await tx.delete(messengerLinkCodes).where(eq(messengerLinkCodes.id, codeRow.id));
    const [user] = await tx.select({ id: users.id, fullName: users.fullName, isDeleted: users.isDeleted }).from(users)
      .where(eq(users.id, codeRow.userId)).for('update');
    if (!user || user.isDeleted === 1) return { status: 'invalid' } as const;
    const closedOwn = await closeLinks(tx, and(eq(userMessengerLinks.userId, user.id), eq(userMessengerLinks.messenger, messenger)), 'relinked');
    const closedChat = await closeLinks(tx, and(eq(userMessengerLinks.messenger, messenger), eq(userMessengerLinks.chatId, chatId), ne(userMessengerLinks.userId, user.id)), 'relinked');
    const [link] = await tx.insert(userMessengerLinks).values({ userId: user.id, messenger, chatId, chatName: chatName.slice(0, 120) })
      .returning({ id: userMessengerLinks.id });
    await logActivity({
      tx,
      userId: user.id,
      userFullName: user.fullName,
      action: 'CREATE',
      entity: MESSENGER_LINK_AUDIT_ENTITY,
      entityId: link.id,
      description: `حساب ${MESSENGER_LABELS[messenger]} به کاربر «${user.fullName}» وصل شد`,
      details: { messenger, replacedLinkIds: closedOwn.map(r => r.id), closedOtherUserLinks: closedChat.map(r => r.userId) },
    });
    return { status: 'linked', userId: user.id, fullName: user.fullName } as const;
  });
}

/** Closes the active link of a chat («/stop» to the bot, or a 403 when sending); the number of links closed */
export async function closeChatLink(messenger: Messenger, chatId: string, reason: 'stop' | 'blocked'): Promise<number> {
  return orm.transaction(async (tx) => {
    const closed = await closeLinks(tx, and(eq(userMessengerLinks.messenger, messenger), eq(userMessengerLinks.chatId, chatId)), reason);
    for (const row of closed) {
      await logActivity({
        tx,
        userId: row.userId,
        action: 'UPDATE',
        entity: MESSENGER_LINK_AUDIT_ENTITY,
        entityId: row.id,
        description: reason === 'stop'
          ? `اتصال ${MESSENGER_LABELS[messenger]} با دستور توقف در پیام‌رسان قطع شد`
          : `اتصال ${MESSENGER_LABELS[messenger]} قطع شد چون ربات پیام را نرساند (مسدود شده)`,
        details: { messenger, reason },
      });
    }
    return closed.length;
  });
}

/** «قطع اتصال» in the user's own profile */
export async function unlinkMine(userId: number, messenger: Messenger, req?: Request): Promise<void> {
  await orm.transaction(async (tx) => {
    const closed = await closeLinks(tx, and(eq(userMessengerLinks.userId, userId), eq(userMessengerLinks.messenger, messenger)), 'user');
    if (closed.length === 0) {
      throw new ConflictError(`حساب ${MESSENGER_LABELS[messenger]} شما وصل نیست.`, undefined, 'MESSENGER_NOT_LINKED');
    }
    await logActivity({
      tx,
      req,
      action: 'UPDATE',
      entity: MESSENGER_LINK_AUDIT_ENTITY,
      entityId: closed[0].id,
      description: `کاربر اتصال ${MESSENGER_LABELS[messenger]} خود را قطع کرد`,
      details: { messenger, reason: 'user' },
    });
  });
}

/** The active link of a user and messenger, with its chat id (server only) */
export async function activeLinkOf(userId: number, messenger: Messenger) {
  const [row] = await orm.select().from(userMessengerLinks)
    .where(and(eq(userMessengerLinks.userId, userId), eq(userMessengerLinks.messenger, messenger), eq(userMessengerLinks.isActive, 1)));
  return row ?? null;
}

export function testMessageText(fullName: string): string {
  return `${fullName}، این پیام آزمایشی پاپیتال است. از این پس اعلان‌های شما اینجا هم می‌رسد.`;
}

/**
 * «پیام آزمایشی» of the profile. A 403 closes the link (`blocked`) and is 409 `MESSENGER_BLOCKED`; any other failure is
 * 502 `MESSENGER_SEND_FAILED` and leaves the link as it is.
 */
export async function sendTestMessage(userId: number, messenger: Messenger): Promise<void> {
  const link = await activeLinkOf(userId, messenger);
  if (!link) throw new ConflictError(`حساب ${MESSENGER_LABELS[messenger]} شما وصل نیست؛ نخست آن را وصل کنید.`, undefined, 'MESSENGER_NOT_LINKED');
  const bot = await readBot(messenger);
  if (!bot) throw new ValidationError(`ربات ${MESSENGER_LABELS[messenger]} هنوز راه‌اندازی نشده است.`, undefined, 'MESSENGER_BOT_NOT_CONFIGURED');
  const [user] = await orm.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId));
  const sent = await sendBotMessage(messenger, bot.token, link.chatId, testMessageText(user?.fullName ?? ''));
  if (sent.ok) return;
  if (sent.blocked) {
    await closeChatLink(messenger, link.chatId, 'blocked');
    throw new ConflictError(`ربات ${MESSENGER_LABELS[messenger]} نتوانست به شما پیام بدهد، پس اتصال قطع شد. ربات را باز کنید، «شروع» را بزنید و دوباره وصل شوید.`, undefined, 'MESSENGER_BLOCKED');
  }
  throw new AppError(`پیام آزمایشی به ${MESSENGER_LABELS[messenger]} نرسید. کمی بعد دوباره بکوشید.`, 502, 'MESSENGER_SEND_FAILED');
}

/** The system admin's list of active links: who is linked to which messenger, never the chat id */
export async function listActiveLinksForAdmin(): Promise<MessengerLinkAdminRow[]> {
  const rows = await orm.select({
    userId: userMessengerLinks.userId,
    userFullName: users.fullName,
    username: users.username,
    messenger: userMessengerLinks.messenger,
    linkedAt: userMessengerLinks.linkedAt,
  }).from(userMessengerLinks)
    .innerJoin(users, eq(users.id, userMessengerLinks.userId))
    .where(eq(userMessengerLinks.isActive, 1))
    .orderBy(asc(users.fullName), asc(userMessengerLinks.messenger));
  return rows.map(r => ({ ...r, messenger: r.messenger as Messenger, linkedAt: serverTimestampToUtcIso(r.linkedAt ?? null) }));
}
