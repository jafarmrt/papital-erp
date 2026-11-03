import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { storefrontOrders } from './storefront';

/**
 * v11 phase 8.4a (migration 0015_storefront_sms, package 18): the site's text messages.
 *
 * `storefront_sms_messages` is the outbox and the log in one: an order message is written in the same transaction as the
 * order's change (`queued`) and the minute sender sends it after the commit; a login code is written `sending` and sent at
 * once. `params` holds the template's values (an order number, a tracking code), never a login code: the code lives only
 * as its keyed hash in `storefront_sms_codes`. Rows are never deleted (a message is a record of what the shop told a buyer).
 *
 * `storefront_sms_codes` is one login code a buyer asked for: its keyed hash, its tries, its deadline and, once the right
 * code was typed, the hash of the single-use phone proof the sign-up or sign-in that follows presents. `address_key` is a
 * keyed hash of the buyer's address (for the per-address limit), never the address itself.
 */
export const storefrontSmsMessages = pgTable('storefront_sms_messages', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(),
  phone: text('phone').notNull(),
  phoneKey: text('phone_key').notNull(),
  orderId: integer('order_id').references(() => storefrontOrders.id),
  params: text('params').notNull().default('{}'),
  isTest: integer('is_test').notNull().default(0),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  provider: text('provider').notNull().default(''),
  providerMessageId: text('provider_message_id').notNull().default(''),
  error: text('error').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'string' }),
}, (table) => ({
  idx_storefront_sms_messages_due: index('idx_storefront_sms_messages_due').on(table.status, table.nextAttemptAt, table.id),
  idx_storefront_sms_messages_order_id: index('idx_storefront_sms_messages_order_id').on(table.orderId).where(sql`${table.orderId} IS NOT NULL`),
  idx_storefront_sms_messages_created: index('idx_storefront_sms_messages_created').on(table.createdAt.desc(), table.id.desc()),
}));

export const storefrontSmsCodes = pgTable('storefront_sms_codes', {
  id: serial('id').primaryKey(),
  phoneKey: text('phone_key').notNull(),
  purpose: text('purpose').notNull().default('phone'),
  codeHash: text('code_hash').notNull(),
  addressKey: text('address_key').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'string' }),
  proofHash: text('proof_hash'),
  proofExpiresAt: timestamp('proof_expires_at', { withTimezone: true, mode: 'string' }),
  proofUsedAt: timestamp('proof_used_at', { withTimezone: true, mode: 'string' }),
  messageId: integer('message_id').references(() => storefrontSmsMessages.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  idx_storefront_sms_codes_phone: index('idx_storefront_sms_codes_phone').on(table.phoneKey, table.createdAt.desc()),
  idx_storefront_sms_codes_address: index('idx_storefront_sms_codes_address').on(table.addressKey, table.createdAt.desc()),
  idx_storefront_sms_codes_created: index('idx_storefront_sms_codes_created').on(table.createdAt.desc()),
  uq_storefront_sms_codes_proof: uniqueIndex('uq_storefront_sms_codes_proof').on(table.proofHash).where(sql`${table.proofHash} IS NOT NULL`),
}));
