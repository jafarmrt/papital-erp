import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { mediaAssets } from './media';
import { storefrontPages } from './storefrontPages';

/**
 * v12 phase 10e (migration 0035, package 18, start plan V12_SITE_NEXT_START_PLAN.md §7.2): the shop's own words for a
 * collection of the site, found by the collection's name on the items: an introduction, an image of the media library
 * and an optional link to a page of «صفحه‌های سایت». One row a name; a row is never removed (emptied, it shows nothing).
 */
export const storefrontCollections = pgTable('storefront_collections', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  intro: text('intro').notNull().default(''),
  imageAssetId: integer('image_asset_id').references(() => mediaAssets.id),
  imageAlt: text('image_alt').notNull().default(''),
  morePageId: integer('more_page_id').references(() => storefrontPages.id),
  version: integer('version').notNull().default(1),
  createdBy: text('created_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_storefront_collections_name: uniqueIndex('uq_storefront_collections_name').on(table.name),
  idx_storefront_collections_image_asset_id: index('idx_storefront_collections_image_asset_id').on(table.imageAssetId).where(sql`${table.imageAssetId} IS NOT NULL`),
  idx_storefront_collections_more_page_id: index('idx_storefront_collections_more_page_id').on(table.morePageId).where(sql`${table.morePageId} IS NOT NULL`),
}));
