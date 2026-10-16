import { pgTable, serial, text, integer, bigint, timestamp, index, uniqueIndex, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';

/**
 * v10.1.38 (messenger notifications plan, part 1, product-owner decision ت۱ الف): the two staff bots (Bale and Telegram,
 * separate from the server alert bots), each user's link to them and the one-time link codes (migration 0120).
 * A bot's token is stored only with `encryptSecret` and never leaves the server; a user links only from their own
 * profile by sending a six-digit code to the bot, and each user has at most one active link per messenger and each chat
 * at most one active user.
 */
export const messengerBots = pgTable('messenger_bots', {
  messenger: text('messenger').primaryKey(), // 'bale' | 'telegram'
  token: text('token').notNull().default(''),
  botUsername: text('bot_username').notNull().default(''),
  updatedById: integer('updated_by_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  // the next `getUpdates` offset of this bot, so a restart never reads old messages again; 0 after the bot changes
  updateOffset: bigint('update_offset', { mode: 'number' }).notNull().default(0),
  // wrong link codes sent to this bot in the current ten-minute window (every chat together)
  wrongCodesCount: integer('wrong_codes_count').notNull().default(0),
  wrongCodesSince: timestamp('wrong_codes_since', { mode: 'string' }),
}, (table) => ({
  idx_messenger_bots_updated_by_id: index('idx_messenger_bots_updated_by_id').on(table.updatedById).where(sql`${table.updatedById} IS NOT NULL`),
}));

export const userMessengerLinks = pgTable('user_messenger_links', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  messenger: text('messenger').notNull(),
  chatId: text('chat_id').notNull(),
  chatName: text('chat_name').notNull().default(''),
  isActive: integer('is_active').notNull().default(1),
  linkedAt: timestamp('linked_at', { mode: 'string' }).defaultNow(),
  unlinkedAt: timestamp('unlinked_at', { mode: 'string' }),
  unlinkReason: text('unlink_reason').notNull().default(''), // '' | 'user' | 'stop' | 'blocked' | 'relinked' | 'bot_changed'
}, (table) => ({
  idx_user_messenger_links_user_id: index('idx_user_messenger_links_user_id').on(table.userId),
  uq_user_messenger_links_user_active: uniqueIndex('uq_user_messenger_links_user_active').on(table.userId, table.messenger).where(sql`${table.isActive} = 1`),
  uq_user_messenger_links_chat_active: uniqueIndex('uq_user_messenger_links_chat_active').on(table.messenger, table.chatId).where(sql`${table.isActive} = 1`),
}));

export const messengerLinkCodes = pgTable('messenger_link_codes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  messenger: text('messenger').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_messenger_link_codes_user_id: index('idx_messenger_link_codes_user_id').on(table.userId),
  uq_messenger_link_codes_code: unique('uq_messenger_link_codes_code').on(table.messenger, table.codeHash),
}));
