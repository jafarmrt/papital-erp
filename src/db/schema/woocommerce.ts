import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documents } from './documents';
import { items } from './inventory';
import { users } from './auth';
import { moneyNumeric } from './moneyColumn';

/** The WooCommerce order log; its own file since OBS-R2-19 (it was declared in documents.ts) */
export const woocommerceOrderLogs = pgTable('woocommerce_order_logs', {
  id: serial('id').primaryKey(),
  wcOrderId: text('wc_order_id').notNull().unique(),
  erpDocumentId: integer('erp_document_id').references(() => documents.id, { onDelete: 'set null' }),
  status: text('status').notNull(), // 'processed', 'failed', 'already_exists'
  buyerName: text('buyer_name').default(''),
  totalAmount: moneyNumeric('total_amount', { precision: 15, scale: 2 }).default(sql`0`),
  payload: jsonb('payload'),
  errorMessage: text('error_message').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wc_order_id: index('idx_wc_order_id').on(table.wcOrderId),
  idx_wc_status: index('idx_wc_status').on(table.status),
  idx_wc_erp_doc: index('idx_wc_erp_doc').on(table.erpDocumentId),
}));

/**
 * 10.2 package 6 (D-04 part A, migration 0128): an item's product (or product variation, `wcVariationId` > 0) in the
 * WooCommerce shop, matched by SKU on «بازخوانی محصولات سایت». `siteStock` is the stock the shop holds as last read or
 * written; a link that no longer matches is closed (`isDeleted` = 1), never deleted.
 */
export const wcProductLinks = pgTable('wc_product_links', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id),
  wcProductId: integer('wc_product_id').notNull(),
  wcVariationId: integer('wc_variation_id').notNull().default(0),
  siteSku: text('site_sku').notNull().default(''),
  siteStock: integer('site_stock'),
  siteManageStock: integer('site_manage_stock').notNull().default(0),
  lastReadAt: timestamp('last_read_at', { mode: 'string' }),
  lastPushedAt: timestamp('last_pushed_at', { mode: 'string' }),
  lastError: text('last_error').notNull().default(''),
  failureCount: integer('failure_count').notNull().default(0),
  /** D-04 part C (migration 0131): the shop product's type and regular price as last read or written */
  siteType: text('site_type').notNull().default(''),
  siteRegularPrice: text('site_regular_price'),
  /** the automatic price push's and SKU rename's last refusal and refusals in a row, apart from the stock push's */
  priceError: text('price_error').notNull().default(''),
  priceFailureCount: integer('price_failure_count').notNull().default(0),
  skuError: text('sku_error').notNull().default(''),
  skuFailureCount: integer('sku_failure_count').notNull().default(0),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  idx_wc_product_links_item: index('idx_wc_product_links_item').on(table.itemId),
  uq_wc_product_links_item_live: uniqueIndex('uq_wc_product_links_item_live').on(table.itemId).where(sql`${table.isDeleted} = 0`),
  uq_wc_product_links_product_live: uniqueIndex('uq_wc_product_links_product_live').on(table.wcProductId, table.wcVariationId).where(sql`${table.isDeleted} = 0`),
}));

/** 10.2 package 6 (migration 0128): one catalog refresh or stock push of the WooCommerce shop and its counts */
export const wcSyncRuns = pgTable('wc_sync_runs', {
  id: serial('id').primaryKey(),
  kind: text('kind').notNull(), // 'refresh' | 'stock_push' | 'price_push' | 'sku_push' (0131)
  status: text('status').notNull(), // 'ok' | 'partial' | 'failed'
  userId: integer('user_id').references(() => users.id),
  startedAt: timestamp('started_at', { mode: 'string' }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { mode: 'string' }),
  summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
  errorMessage: text('error_message').notNull().default(''),
}, (table) => ({
  idx_wc_sync_runs_user: index('idx_wc_sync_runs_user').on(table.userId),
  idx_wc_sync_runs_kind: index('idx_wc_sync_runs_kind').on(table.kind, table.id),
}));
