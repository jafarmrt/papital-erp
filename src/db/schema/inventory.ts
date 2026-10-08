import { pgTable, text, serial, numeric, integer, timestamp, index, varchar, primaryKey, check, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { registerColumnRef, baseRelations } from './baseRelations';
import { moneyNumeric } from './moneyColumn';

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  type: text('type').notNull(), // 'product' or 'raw_material'
  defaultUnit: text('default_unit').default('عدد'),
  // v9.0.204 (TD-659، ت۸ الف): حذف دسته نرم است (مهاجرت 0072)
  isDeleted: integer('is_deleted').notNull().default(0)
});

export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  isActive: integer('is_active').default(1)
});

/**
 * V7 Phase 4.1 (TD-165): جدول رابطه‌ای نرمال‌سازی‌شده موجودی کالا به تفکیک انبارها
 * جایگزین ساختار متزلزل JSONB با قید دیتابیسی عدم منفی بودن و قابلیت قفل‌گذاری سطری مستقیم
 */
export const itemWarehouseStocks = pgTable('item_warehouse_stocks', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  warehouseId: integer('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  warehouseCode: text('warehouse_code').notNull(),
  currentStock: numeric('current_stock', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  reservedStock: numeric('reserved_stock', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  uniqueItemWarehouse: uniqueIndex('idx_item_warehouse_unique').on(table.itemId, table.warehouseId),
  idxIwsItemId: index('idx_iws_item_id').on(table.itemId),
  idxIwsWarehouseId: index('idx_iws_warehouse_id').on(table.warehouseId),
  idxIwsWarehouseCode: index('idx_iws_warehouse_code').on(table.warehouseCode),
  checkStockNonNegative: check('chk_iws_current_stock_non_negative', sql`${table.currentStock} >= 0`),
}));

// v7.0.33 (TD-200 / audit P1-9): ثبت هر اصلاح یا امتناع از اصلاح در ترمیم موجودی انبارها از روی کاردکس
// kind: 'repaired' | 'negative_ledger' | 'unresolved_location'
export const inventoryReconciliationAnomalies = pgTable('inventory_reconciliation_anomalies', {
  id: serial('id').primaryKey(),
  runId: text('run_id').notNull(),
  itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  warehouseId: integer('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }),
  warehouseCode: text('warehouse_code').notNull().default(''),
  kind: text('kind').notNull(),
  ledgerQty: numeric('ledger_qty', { precision: 18, scale: 4, mode: 'number' }),
  beforeQty: numeric('before_qty', { precision: 18, scale: 4, mode: 'number' }),
  afterQty: numeric('after_qty', { precision: 18, scale: 4, mode: 'number' }),
  details: text('details').notNull().default(''),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idxRun: index('idx_inv_recon_anomalies_run').on(table.runId),
  idxItem: index('idx_inv_recon_anomalies_item').on(table.itemId),
}));

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  // v7.0.48 (TD-214): مجموع item_warehouse_stocks که فقط پایگاه‌داده (تریگر مهاجرت 0021) آن را می‌نویسد؛ کد برنامه نباید در آن بنویسد
  currentStock: numeric('current_stock', { precision: 18, scale: 4, mode: 'number' }).default(0),
  unit: text('unit').notNull(),
  category: text('category').default(''),
  image: text('image').default(''),
  thumbnail: text('thumbnail').default(''),
  reorderPoint: numeric('reorder_point', { precision: 18, scale: 4, mode: 'number' }).default(0),
  weightedAverageCost: moneyNumeric('weighted_average_cost').default(sql`0`),
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
registerColumnRef('items.id', () => items.id);

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id),
  documentId: integer('document_id').references(baseRelations.documentsId),
  type: text('type').notNull(), // 'in' or 'out'
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unitPrice: moneyNumeric('unit_price').default(sql`0`),
  totalPrice: moneyNumeric('total_price').default(sql`0`),
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
registerColumnRef('transactions.id', () => transactions.id);

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
  price: moneyNumeric('price').notNull(),
  currency: text('currency').default('IRR'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_item_id: index('item_prices_item_id').on(table.itemId),
}));

// v9.0.152 (TD-647، مهاجرت 0068): قیمت‌هایی که فهرست قیمت نبودند («میانگین خرید (WAC)»، «موجودی کل»، «میانگین بهای خرید»)
// با مقدار پیشین ثبت و نرم حذف شدند
export const itemPriceTitleCleanup = pgTable('item_price_title_cleanup', {
  id: serial('id').primaryKey(),
  itemPriceId: integer('item_price_id').notNull().unique('uq_item_price_title_cleanup_price'),
  itemId: integer('item_id').notNull(),
  title: text('title').notNull(),
  price: moneyNumeric('price').notNull(),
  currency: text('currency'),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const pendingMaterials = pgTable('pending_materials', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  category: text('category').default(''),
  type: text('type').default('raw_material'),
  projectId: integer('project_id').references(baseRelations.productionProjectsId),
  projectTitle: text('project_title').default(''),
  requestedBy: text('requested_by').default(''),
  status: text('status').default('pending'), // 'pending', 'approved', 'rejected'
  reorderPoint: numeric('reorder_point', { precision: 18, scale: 4, mode: 'number' }).default(0),
  weightedAverageCost: moneyNumeric('weighted_average_cost').default(sql`0`),
  color: text('color').default(''),
  weight: numeric('weight', { precision: 18, scale: 4, mode: 'number' }).default(0),
  material: text('material').default(''),
  size: text('size').default(''),
  image: text('image').default(''),
  thumbnail: text('thumbnail').default(''),
  rejectionReason: text('rejection_reason').default(''),
  // v9.0.397 (TD-825): the item an approval made (migration 0087); null while pending, rejected, or approved before v9.0.397
  itemId: integer('item_id').references(baseRelations.itemsId),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_pmat_item: index('idx_pmat_item').on(table.itemId),
  idx_pmat_status: index('idx_pmat_status').on(table.status),
  idx_pmat_code: index('idx_pmat_code').on(table.code),
  idx_pmat_deleted: index('idx_pmat_deleted').on(table.isDeleted),
  idx_pmat_project: index('idx_pmat_project').on(table.projectId),
}));
