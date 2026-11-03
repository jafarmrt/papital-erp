import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { items } from './inventory';

/**
 * v11 phase 8.5 (migration 0016, package 18): an old address of the WooCommerce site and where it goes on the new site.
 * `fromPath` is the address's key (`legacyPathKey` of `src/lib/storefront/storefrontSeoRules.ts`); a product target is
 * kept by its item, so the redirect follows a later change of the product's slug. Removing a row is a soft delete.
 */
export const storefrontRedirects = pgTable('storefront_redirects', {
  id: serial('id').primaryKey(),
  fromPath: text('from_path').notNull(),
  targetKind: text('target_kind').notNull(),
  targetItemId: integer('target_item_id').references(() => items.id),
  target: text('target').notNull().default(''),
  source: text('source').notNull().default('manual'),
  note: text('note').notNull().default(''),
  isActive: integer('is_active').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  uq_storefront_redirects_from_live: uniqueIndex('uq_storefront_redirects_from_live').on(table.fromPath).where(sql`${table.isDeleted} = 0`),
  idx_storefront_redirects_target_item_id: index('idx_storefront_redirects_target_item_id').on(table.targetItemId).where(sql`${table.targetItemId} IS NOT NULL`),
  idx_storefront_redirects_list: index('idx_storefront_redirects_list').on(table.isDeleted, table.id.desc()),
}));
