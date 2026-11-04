import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { mediaAssets } from './media';

/**
 * v11 phase 8.5b (migration 0022, package 18): «صفحه‌های ویژه», a campaign page of the site (Yalda first). Its products are
 * one ERP collection or chosen items (`itemIds`, in the owner's order; items are only soft-deleted, so an id stays that
 * item's). `discountCode` is only shown; the code is checked when an order uses it. `startsAt` / `endsAt` are the page's
 * window (Tehran days, as the discount codes). Removing a page is a soft delete.
 */
export const storefrontCampaigns = pgTable('storefront_campaigns', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  heroAssetId: integer('hero_asset_id').references(() => mediaAssets.id),
  source: text('source').notNull(),
  collection: text('collection').notNull().default(''),
  itemIds: integer('item_ids').array().notNull().default(sql`'{}'::integer[]`),
  discountCode: text('discount_code').notNull().default(''),
  startsAt: timestamp('starts_at', { withTimezone: true, mode: 'string' }),
  endsAt: timestamp('ends_at', { withTimezone: true, mode: 'string' }),
  homeBanner: integer('home_banner').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  uq_storefront_campaigns_slug_live: uniqueIndex('uq_storefront_campaigns_slug_live').on(table.slug).where(sql`${table.isDeleted} = 0`),
  idx_storefront_campaigns_list: index('idx_storefront_campaigns_list').on(table.isDeleted, table.id.desc()),
  idx_storefront_campaigns_hero_asset_id: index('idx_storefront_campaigns_hero_asset_id').on(table.heroAssetId).where(sql`${table.heroAssetId} IS NOT NULL`),
}));
