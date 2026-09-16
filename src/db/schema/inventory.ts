import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, varchar, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documents } from './documents';
import { productionProjects } from './projects';

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  type: text('type').notNull(), // 'product' or 'raw_material'
  defaultUnit: text('default_unit').default('عدد')
});

export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  isActive: integer('is_active').default(1)
});

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  currentStock: numeric('current_stock', { precision: 18, scale: 4, mode: 'number' }).default(0),
  unit: text('unit').notNull(),
  category: text('category').default(''),
  image: text('image').default(''),
  thumbnail: text('thumbnail').default(''),
  reorderPoint: numeric('reorder_point', { precision: 18, scale: 4, mode: 'number' }).default(0),
  weightedAverageCost: numeric('weighted_average_cost', { precision: 18, scale: 4, mode: 'number' }).default(0),
  stocks: jsonb('stocks').default({}), // Replaces dynamic columns stock_safe, etc.
  color: text('color'),
  weight: numeric('weight', { precision: 18, scale: 4, mode: 'number' }),
  material: text('material'),
  size: text('size'),
  lastKardexRebuildAt: timestamp('last_kardex_rebuild_at', { mode: 'string' }),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_type_deleted: index('items_type_deleted').on(table.type, table.isDeleted),
  idx_code: index('items_code').on(table.code),
  idx_category: index('items_category').on(table.category),
  nameTrgmIdx: index('items_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`)
}));

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id),
  documentId: integer('document_id').references((): AnyPgColumn => documents.id),
  type: text('type').notNull(), // 'in' or 'out'
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4, mode: 'number' }).default(0),
  totalPrice: numeric('total_price', { precision: 18, scale: 4, mode: 'number' }).default(0),
  date: timestamp('date', { withTimezone: false, mode: 'string' }).notNull(),
  documentType: text('document_type'),
  documentRef: text('document_ref'),
  createdBy: text('created_by'),
  notes: text('notes'),
  location: text('location').default('main'),
  reversalOfId: integer('reversal_of_id'),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_item_date_id_active: index('tx_item_date_id_active').on(table.itemId, table.isDeleted, table.date, table.id),
  idx_item_loc_active: index('tx_item_loc_active').on(table.itemId, table.location, table.isDeleted),
  idx_item_active_date: index('tx_item_active_date').on(table.itemId, table.isDeleted, table.date),
  idx_doc: index('tx_doc_id').on(table.documentId),
  idx_date: index('tx_date').on(table.date),
  idx_type_deleted: index('tx_type_deleted').on(table.type, table.isDeleted),
}));

// V10-2.1: شمارنده اتمیک کد کالا — جایگزین الگوی ممنوع MAX()+1 (DB-001)
export const itemCodeCounters = pgTable('item_code_counters', {
  scope: varchar('scope', { length: 20 }).notNull(), // 'product' | 'raw_material'
  prefixKey: varchar('prefix_key', { length: 60 }).notNull(),
  lastNumber: integer('last_number').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.scope, t.prefixKey] }),
}));

export const itemPrices = pgTable('item_prices', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id),
  title: text('title').notNull(),
  price: numeric('price', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  currency: text('currency').default('IRR'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_item_id: index('item_prices_item_id').on(table.itemId),
}));

export const pendingMaterials = pgTable('pending_materials', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  category: text('category').default(''),
  type: text('type').default('raw_material'),
  projectId: integer('project_id').references((): AnyPgColumn => productionProjects.id),
  projectTitle: text('project_title').default(''),
  requestedBy: text('requested_by').default(''),
  status: text('status').default('pending'), // 'pending', 'approved', 'rejected'
  reorderPoint: numeric('reorder_point', { precision: 18, scale: 4, mode: 'number' }).default(0),
  weightedAverageCost: numeric('weighted_average_cost', { precision: 18, scale: 4, mode: 'number' }).default(0),
  color: text('color').default(''),
  weight: numeric('weight', { precision: 18, scale: 4, mode: 'number' }).default(0),
  material: text('material').default(''),
  size: text('size').default(''),
  image: text('image').default(''),
  thumbnail: text('thumbnail').default(''),
  rejectionReason: text('rejection_reason').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_pmat_status: index('idx_pmat_status').on(table.status),
  idx_pmat_code: index('idx_pmat_code').on(table.code),
  idx_pmat_deleted: index('idx_pmat_deleted').on(table.isDeleted),
  idx_pmat_project: index('idx_pmat_project').on(table.projectId),
}));
