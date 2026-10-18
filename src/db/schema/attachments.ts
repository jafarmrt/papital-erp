import { pgTable, text, integer, uuid, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * v7.0.56 (audit P2-9): فایل پیوست‌ها روی دیسک (public/uploads/.attachments) و ثبت هر فایل با رکورد مالک آن.
 * ستون‌های JSONB `attachments` فقط فراداده و آدرس /api/attachments/<id> را نگه می‌دارند.
 */
export const fileAttachments = pgTable('file_attachments', {
  id: uuid('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  storagePath: text('storage_path').notNull(),
  originalName: text('original_name').notNull().default(''),
  mimeType: text('mime_type').notNull().default('application/octet-stream'),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  isDeleted: integer('is_deleted').notNull().default(0),
  /** v10.2 package 7 (migration 0127): the light WEBP of an image attachment of a sales file or activity; null otherwise */
  lightStoragePath: text('light_storage_path'),
}, (table) => ({
  idx_entity: index('idx_file_attachments_entity').on(table.entityType, table.entityId),
}));
