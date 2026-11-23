import { pgTable, text, serial, integer, timestamp, jsonb, date, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { mediaAssets } from './media';
import type { PageSection } from '../../lib/storefront/storefrontPageRules';
import type { NewsValues } from '../../lib/storefront/storefrontNewsRules';

/**
 * v12 phase 10d (migration 0033, package 18, start plan V12_SITE_NEXT_START_PLAN.md §7.2): the news of the site.
 * Like a page, `sections` is the draft and `published` the copy on the site (null = not on the site), which only
 * «انتشار» writes. `newsDate` is the day (Tehran) the draft is dated; `publishedDate` is that day as it was at «انتشار»,
 * and the site shows the item from that day on. Removing a news item is a soft delete.
 */
export type PublishedNews = Omit<NewsValues, 'slug'>;

export const storefrontNews = pgTable('storefront_news', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  coverAssetId: integer('cover_asset_id').references(() => mediaAssets.id),
  newsDate: date('news_date', { mode: 'string' }),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  sections: jsonb('sections').$type<PageSection[]>().notNull().default([]),
  published: jsonb('published').$type<PublishedNews>(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }),
  publishedDate: date('published_date', { mode: 'string' }),
  publishedBy: text('published_by').notNull().default(''),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_storefront_news_slug_live: uniqueIndex('uq_storefront_news_slug_live').on(table.slug).where(sql`${table.isDeleted} = 0`),
  idx_storefront_news_cover_asset_id: index('idx_storefront_news_cover_asset_id').on(table.coverAssetId).where(sql`${table.coverAssetId} IS NOT NULL`),
  idx_storefront_news_on_site: index('idx_storefront_news_on_site').on(table.publishedDate.desc(), table.id.desc()).where(sql`${table.isDeleted} = 0 AND ${table.published} IS NOT NULL`),
}));
