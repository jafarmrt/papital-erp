import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * 📦 Module Template Schema (Drizzle ORM)
 * 
 * استانداردهای الزامی معماری سامانه نسخه ۴:
 * 1. نام‌گذاری ستون‌ها به صورت snake_case در دیتابیس و camelCase در TypeScript
 * 2. ستون‌های پولی و مقادیر عددی اعشاری با numeric({ precision: 18, scale: 4, mode: 'number' })
 * 3. فیلد حذف منطقی isDeleted با پیش‌فرض 0 و فیلتر خودکار در کوئری‌ها
 * 4. فیلد نگارش version برای کنترل هم‌زمانی خوش‌بینانه (OCC)
 * 5. فیلدهای زمان‌بندی createdAt و updatedAt با فرمت رشته‌ای یکنواخت ISO
 */
export const templateEntities = pgTable('template_entities', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'archived'
  amount: numeric('amount', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  metadata: jsonb('metadata').default({}),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idx_code: index('template_entities_code_idx').on(table.code),
  idx_status_deleted: index('template_entities_status_deleted_idx').on(table.status, table.isDeleted),
  idx_created_at: index('template_entities_created_at_idx').on(table.createdAt),
}));

export type TemplateEntitySelect = typeof templateEntities.$inferSelect;
export type TemplateEntityInsert = typeof templateEntities.$inferInsert;
