import { pgTable, text, serial, integer, timestamp, jsonb, index, uniqueIndex, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { mediaAssets } from './media';
import type { PageSection, PageValues } from '../../lib/storefront/storefrontPageRules';

/**
 * v12 phase 10b (migration 0029, package 18, start plan V12_SITE_NEXT_START_PLAN.md §7.2): the site's pages.
 * `sections` is the draft the builder edits; `published` is the copy on the site (null = not on the site), which only
 * «انتشار» writes. A 'base' page (the five every shop needs) is never removed and keeps its address; removing a custom
 * page is a soft delete. `storefront_content_assets` names the images of the media library a published content uses, so
 * the site can be given those and no other (10c); a row no longer named is switched off, never removed.
 */
export type PublishedPage = Omit<PageValues, 'slug'>;

export const storefrontPages = pgTable('storefront_pages', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull().default('custom'),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  noindex: integer('noindex').notNull().default(0),
  shareImageAssetId: integer('share_image_asset_id').references(() => mediaAssets.id),
  sections: jsonb('sections').$type<PageSection[]>().notNull().default([]),
  published: jsonb('published').$type<PublishedPage>(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }),
  publishedBy: text('published_by').notNull().default(''),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_storefront_pages_slug_live: uniqueIndex('uq_storefront_pages_slug_live').on(table.slug).where(sql`${table.isDeleted} = 0`),
  idx_storefront_pages_share_image_asset_id: index('idx_storefront_pages_share_image_asset_id').on(table.shareImageAssetId).where(sql`${table.shareImageAssetId} IS NOT NULL`),
}));

export const storefrontContentAssets = pgTable('storefront_content_assets', {
  id: serial('id').primaryKey(),
  contentKind: text('content_kind').notNull(),
  contentId: integer('content_id').notNull(),
  assetId: integer('asset_id').notNull().references(() => mediaAssets.id),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_storefront_content_assets: unique('uq_storefront_content_assets').on(table.contentKind, table.contentId, table.assetId),
  idx_storefront_content_assets_asset_id: index('idx_storefront_content_assets_asset_id').on(table.assetId).where(sql`${table.isDeleted} = 0`),
}));
