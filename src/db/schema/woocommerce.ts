import { pgTable, text, serial, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { documents } from './documents';
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
