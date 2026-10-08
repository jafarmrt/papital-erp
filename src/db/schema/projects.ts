import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { FinancialAttachment } from '../../types';
import { users } from './auth';
import { registerColumnRef, baseRelations } from './baseRelations';

export const productionProjects = pgTable('production_projects', {
  id: serial('id').primaryKey(),
  projectCode: text('project_code').notNull().unique(),
  title: text('title').notNull(),
  customerId: integer('customer_id').references(baseRelations.customersId),
  customerName: text('customer_name').default(''),
  itemId: integer('item_id').references(baseRelations.itemsId),
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
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_production_projects_customer_id: index('idx_production_projects_customer_id').on(table.customerId).where(sql`${table.customerId} IS NOT NULL`),
  idx_production_projects_item_id: index('idx_production_projects_item_id').on(table.itemId).where(sql`${table.itemId} IS NOT NULL`),
}));
registerColumnRef('productionProjects.id', () => productionProjects.id);

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
  // v9.0.448 (TD-613): built by migration 0084 only on data without duplicates; declared so the schema matches the database
  uq_project_stages_order_active: uniqueIndex('uq_project_stages_order_active').on(table.projectId, table.stageOrder).where(sql`${table.isDeleted} = 0`),
}));

// V3.1.0 — پیشرفت ماتریسی SKU × مرحله (به تفکیک هر کد کالا)
export const projectProductStageProgress = pgTable('project_product_stage_progress', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  itemId: integer('item_id').notNull().references(baseRelations.itemsId),
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
  // v9.0.448 (TD-613): migration 0002 built a unique index, not a constraint
  uq_ppsp: uniqueIndex('uq_ppsp_project_item_stage').on(table.projectId, table.itemId, table.stageOrder),
  idx_ppsp_item: index('idx_ppsp_item').on(table.projectId, table.itemId),
  idx_ppsp_order: index('idx_ppsp_order').on(table.projectId, table.stageOrder),
  idx_ppsp_deleted: index('idx_ppsp_deleted').on(table.isDeleted),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_project_product_stage_progress_item_id: index('idx_project_product_stage_progress_item_id').on(table.itemId),
}));

export const projectBomAllocations = pgTable('project_bom_allocations', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  projectCode: text('project_code').notNull(),
  itemId: integer('item_id').notNull().references(baseRelations.itemsId),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unit: text('unit').default('عدد'),
  sourceTransactionId: integer('source_transaction_id').references(baseRelations.transactionsId),
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
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_project_bom_allocations_user_id: index('idx_project_bom_allocations_user_id').on(table.userId).where(sql`${table.userId} IS NOT NULL`),
}));
registerColumnRef('projectBomAllocations.id', () => projectBomAllocations.id);

// v7.0.105 (TD-237): هر کسر رزرو پروژه بابت حواله خروج نهایی با ردیف رزرو پیش از کسر ثبت می‌شود تا ابطال حواله
// همان مقدار را به همان پروژه برگرداند (restored_at). v9.0.452 (TD-918): کسر تخصیص مواد هم، تا آزادسازی آن برگرداند.
export const projectReservationReleases = pgTable('project_reservation_releases', {
  id: serial('id').primaryKey(),
  // v9.0.452 (TD-918، مهاجرت 0095): هر کسر یک منبع دارد، سند یا تخصیص مواد (قید chk_project_reservation_releases_source)
  documentId: integer('document_id').references(baseRelations.documentsId, { onDelete: 'cascade' }),
  bomAllocationId: integer('bom_allocation_id').references(() => projectBomAllocations.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => productionProjects.id, { onDelete: 'cascade' }),
  itemId: integer('item_id'),
  qtyField: text('qty_field').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  reservationRow: jsonb('reservation_row').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  restoredAt: timestamp('restored_at', { mode: 'string' }),
}, (table) => ({
  idx_prr_document: index('idx_prr_document').on(table.documentId),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_project_reservation_releases_project_id: index('idx_project_reservation_releases_project_id').on(table.projectId),
  idx_project_reservation_releases_bom_allocation_id: index('idx_project_reservation_releases_bom_allocation_id').on(table.bomAllocationId).where(sql`${table.bomAllocationId} IS NOT NULL`),
}));
