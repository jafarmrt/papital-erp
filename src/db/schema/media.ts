import { pgTable, serial, text, integer, numeric, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { items } from './inventory';

/**
 * v10.0.18 (N-05): the media library (migration 0096). A section groups files: the one system section «محصولات»
 * (`kind = 'products'`, every file linked to an item) and the sections users create (`custom`). A file keeps its original
 * unchanged on disk under `MEDIA_DIR`, named by its SHA-256, plus a light version and a thumbnail the server makes
 * (`src/services/media/mediaStorage.ts`); the database holds only metadata.
 */
export const mediaSections = pgTable('media_sections', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull().default('custom'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
}, (table) => ({
  uq_media_sections_products: uniqueIndex('uq_media_sections_products').on(table.kind).where(sql`${table.kind} = 'products' AND ${table.isDeleted} = 0`),
  uq_media_sections_title_active: uniqueIndex('uq_media_sections_title_active').on(sql`lower(btrim(${table.title}))`).where(sql`${table.isDeleted} = 0`),
}));

export const mediaAssets = pgTable('media_assets', {
  id: serial('id').primaryKey(),
  sectionId: integer('section_id').notNull().references(() => mediaSections.id),
  itemId: integer('item_id').references(() => items.id),
  kind: text('kind').notNull(),
  shotType: text('shot_type').notNull().default('other'),
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  isCover: integer('is_cover').notNull().default(0),
  originalName: text('original_name').notNull().default(''),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationSeconds: numeric('duration_seconds', { precision: 10, scale: 2, mode: 'number' }),
  isLowQuality: integer('is_low_quality').notNull().default(0),
  /** bytes of the light version (image) and of the thumbnail (image, or video poster); null while there is none */
  lightBytes: integer('light_bytes'),
  thumbBytes: integer('thumb_bytes'),
  /** why the light version of an image could not be made (English, for the log and the health check); '' otherwise */
  lightError: text('light_error').notNull().default(''),
  createdBy: text('created_by').notNull().default(''),
  createdByUserId: integer('created_by_user_id'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
}, (table) => ({
  idx_media_assets_section_id: index('idx_media_assets_section_id').on(table.sectionId, table.isDeleted, table.sortOrder),
  idx_media_assets_item_id: index('idx_media_assets_item_id').on(table.itemId).where(sql`${table.itemId} IS NOT NULL`),
  idx_media_assets_sha256: index('idx_media_assets_sha256').on(table.sha256),
}));
