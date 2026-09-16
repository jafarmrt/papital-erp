import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, unique, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FinancialAttachment } from '../../types';
import { customers } from './crm';
import { items, transactions } from './inventory';
import { users } from './auth';

export const productionProjects = pgTable('production_projects', {
  id: serial('id').primaryKey(),
  projectCode: text('project_code').notNull().unique(),
  title: text('title').notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  customerName: text('customer_name').default(''),
  itemId: integer('item_id').references((): AnyPgColumn => items.id),
  itemCode: text('item_code').default(''),
  itemName: text('item_name').default(''),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull().default(1),
  unit: text('unit').default('عدد'),
  startDate: text('start_date').default(''),
  endDate: text('end_date').default(''),
  status: text('status').default('planned'), // 'planned', 'in_progress', 'completed', 'paused', 'cancelled'
  priority: text('priority').default('medium'), // 'low', 'medium', 'high', 'urgent'
  description: text('description').default(''),
  products: jsonb('products').default([]),
  inventoryControl: jsonb('inventory_control').default({}),
  stageSchedules: jsonb('stage_schedules').default({}),
  customStages: jsonb('custom_stages').default([]),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  createdBy: text('created_by').default(''),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_proj_code: index('idx_proj_code').on(table.projectCode),
  idx_proj_status: index('idx_proj_status').on(table.status),
  idx_proj_deleted: index('idx_proj_deleted').on(table.isDeleted),
}));

export const projectStages = pgTable('project_stages', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  stageOrder: integer('stage_order').notNull().default(1),
  title: text('title').notNull(), // e.g., 'خرید مواد اولیه', 'تولید کاشی', 'چاپ ترنسفر', 'مونتاژ', 'کنترل کیفیت'
  status: text('status').default('pending'), // 'pending', 'in_progress', 'completed', 'blocked'
  startDate: text('start_date').default(''),
  endDate: text('end_date').default(''),
  assignedPersonnel: jsonb('assigned_personnel').default([]), // array of names or user IDs
  requiredResources: jsonb('required_resources').default([]), // array of tools/materials/machines
  progressPercent: integer('progress_percent').default(0),
  notes: text('notes').default(''),
  completedAt: text('completed_at').default(''),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_stage_proj: index('idx_stage_proj').on(table.projectId),
  idx_stage_order: index('idx_stage_order').on(table.stageOrder),
}));

// V3.1.0 — پیشرفت ماتریسی SKU × مرحله (به تفکیک هر کد کالا)
export const projectProductStageProgress = pgTable('project_product_stage_progress', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  itemId: integer('item_id').notNull().references((): AnyPgColumn => items.id),
  itemCode: text('item_code').notNull().default(''), // snapshot کد کالا (SKU)
  itemName: text('item_name').default(''),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  stageOrder: integer('stage_order').notNull(),
  stageTitle: text('stage_title').notNull().default(''),
  status: text('status').notNull().default('pending'), // 'pending' | 'in_progress' | 'completed' | 'blocked'
  updatedAt: text('updated_at').default(''),
  updatedByName: text('updated_by_name').default(''),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  uq_ppsp: unique('uq_ppsp_project_item_stage').on(table.projectId, table.itemId, table.stageOrder),
  idx_ppsp_item: index('idx_ppsp_item').on(table.projectId, table.itemId),
  idx_ppsp_order: index('idx_ppsp_order').on(table.projectId, table.stageOrder),
  idx_ppsp_deleted: index('idx_ppsp_deleted').on(table.isDeleted),
}));

export const projectBomAllocations = pgTable('project_bom_allocations', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  projectCode: text('project_code').notNull(),
  itemId: integer('item_id').notNull().references((): AnyPgColumn => items.id),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unit: text('unit').default('عدد'),
  sourceTransactionId: integer('source_transaction_id').references((): AnyPgColumn => transactions.id),
  sourceLocation: text('source_location').default('main'),
  status: text('status').notNull().default('allocated'), // 'allocated', 'consumed', 'released'
  userId: integer('user_id').references(() => users.id),
  username: text('username').default(''),
  notes: text('notes').default(''),
  allocatedAt: timestamp('allocated_at', { mode: 'string' }).defaultNow(),
  consumedAt: timestamp('consumed_at', { mode: 'string' }),
  releasedAt: timestamp('released_at', { mode: 'string' }),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_bom_alloc_proj: index('idx_bom_alloc_proj').on(table.projectId),
  idx_bom_alloc_item: index('idx_bom_alloc_item').on(table.itemId),
  idx_bom_alloc_status: index('idx_bom_alloc_status').on(table.status),
  idx_bom_alloc_src_tx: index('idx_bom_alloc_src_tx').on(table.sourceTransactionId),
}));
