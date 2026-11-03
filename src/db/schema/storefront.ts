import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { items } from './inventory';
import { baseRelations } from './baseRelations';
import { treasuryTransactions } from './accounting';
import { moneyNumeric } from './moneyColumn';

/**
 * v11 phase 8.1 (migration 0013, package 18): the storefront on the ERP. An item reaches the site only through its row
 * here with `isPublished` = 1; name, description, material, size, colour, weight and collections stay on the item card.
 * The row is never deleted: unpublishing turns the flag off and keeps the slug, so an old address keeps its owner.
 */
export const storefrontProducts = pgTable('storefront_products', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id),
  isPublished: integer('is_published').notNull().default(0),
  slug: text('slug').notNull(),
  seoTitle: text('seo_title').notNull().default(''),
  seoDescription: text('seo_description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  uq_storefront_products_item: uniqueIndex('uq_storefront_products_item').on(table.itemId),
  uq_storefront_products_slug: uniqueIndex('uq_storefront_products_slug').on(table.slug),
  idx_storefront_products_published: index('idx_storefront_products_published').on(table.isPublished, table.sortOrder, table.id),
}));

/**
 * The delivery methods the site offers. `pricing`: 'flat' (`flatRate`), 'table' (rows of `storefrontShippingRates` by
 * province and weight), 'on_delivery' (the buyer pays the courier) or 'free'. Only an eligible method is free above the
 * free-shipping threshold of the settings.
 */
export const storefrontShippingMethods = pgTable('storefront_shipping_methods', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  pricing: text('pricing').notNull(),
  flatRate: moneyNumeric('flat_rate').notNull().default(sql`0`),
  isActive: integer('is_active').notNull().default(0),
  isFreeShippingEligible: integer('is_free_shipping_eligible').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
}, (table) => ({
  uq_storefront_shipping_methods_code_active: uniqueIndex('uq_storefront_shipping_methods_code_active').on(table.code).where(sql`${table.isDeleted} = 0`),
}));

/** A row of a table-priced method: up to `maxWeightGrams` (null = no limit) to `province` ('' = every other one) costs `rate` */
export const storefrontShippingRates = pgTable('storefront_shipping_rates', {
  id: serial('id').primaryKey(),
  methodId: integer('method_id').notNull().references(() => storefrontShippingMethods.id),
  province: text('province').notNull().default(''),
  maxWeightGrams: integer('max_weight_grams'),
  rate: moneyNumeric('rate').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  isDeleted: integer('is_deleted').notNull().default(0),
}, (table) => ({
  idx_storefront_shipping_rates_method_id: index('idx_storefront_shipping_rates_method_id').on(table.methodId, table.isDeleted, table.sortOrder),
}));

/**
 * v11 phase 8.2a (migration 0014): a site order. The order is a sales proforma of the ERP (`documentId`, reserving the
 * stock until the payment is confirmed and it becomes the final invoice); this row holds what the document does not: the
 * address and postal code, the shipping method, the status on the site, the reservation deadline and the salt of the
 * buyer's tracking key (the key is a keyed hash of the salt; neither the key nor its hash is stored).
 */
export const storefrontOrders = pgTable('storefront_orders', {
  id: serial('id').primaryKey(),
  orderNumber: text('order_number').notNull(),
  accessSalt: text('access_salt').notNull(),
  requestKey: text('request_key').notNull(),
  requestHash: text('request_hash').notNull(),
  documentId: integer('document_id').notNull().references(baseRelations.documentsId),
  customerId: integer('customer_id').notNull().references(baseRelations.customersId),
  status: text('status').notNull().default('awaiting_payment'),
  cancelReason: text('cancel_reason').notNull().default(''),
  recipientName: text('recipient_name').notNull(),
  phone: text('phone').notNull(),
  phoneKey: text('phone_key').notNull(),
  province: text('province').notNull(),
  city: text('city').notNull(),
  address: text('address').notNull(),
  postalCode: text('postal_code').notNull(),
  buyerNote: text('buyer_note').notNull().default(''),
  shippingMethodCode: text('shipping_method_code').notNull(),
  shippingMethodTitle: text('shipping_method_title').notNull(),
  shippingOnDelivery: integer('shipping_on_delivery').notNull().default(0),
  shippingAmount: moneyNumeric('shipping_amount').notNull().default(sql`0`),
  itemsAmount: moneyNumeric('items_amount').notNull(),
  payableAmount: moneyNumeric('payable_amount').notNull(),
  trackingCode: text('tracking_code').notNull().default(''),
  reserveUntil: timestamp('reserve_until', { withTimezone: true, mode: 'string' }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }),
  shippedAt: timestamp('shipped_at', { withTimezone: true, mode: 'string' }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull().default(''),
  version: integer('version').notNull().default(1),
}, (table) => ({
  uq_storefront_orders_number: uniqueIndex('uq_storefront_orders_number').on(table.orderNumber),
  uq_storefront_orders_request_key: uniqueIndex('uq_storefront_orders_request_key').on(table.requestKey),
  uq_storefront_orders_document: uniqueIndex('uq_storefront_orders_document').on(table.documentId),
  idx_storefront_orders_customer_id: index('idx_storefront_orders_customer_id').on(table.customerId),
  idx_storefront_orders_status_reserve: index('idx_storefront_orders_status_reserve').on(table.status, table.reserveUntil),
  idx_storefront_orders_phone_status: index('idx_storefront_orders_phone_status').on(table.phoneKey, table.status),
  idx_storefront_orders_created: index('idx_storefront_orders_created').on(table.createdAt.desc(), table.id.desc()),
}));

/** A card-to-card receipt a buyer sent for an order; only the paying card's last four digits are kept */
export const storefrontPaymentReceipts = pgTable('storefront_payment_receipts', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => storefrontOrders.id),
  reference: text('reference').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true, mode: 'string' }).notNull(),
  cardLast4: text('card_last4').notNull(),
  amount: moneyNumeric('amount').notNull(),
  status: text('status').notNull().default('pending'),
  rejectReason: text('reject_reason').notNull().default(''),
  reviewedBy: text('reviewed_by').notNull().default(''),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'string' }),
  treasuryTransactionId: integer('treasury_transaction_id').references(() => treasuryTransactions.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  idx_storefront_payment_receipts_order_id: index('idx_storefront_payment_receipts_order_id').on(table.orderId, table.id),
  idx_storefront_payment_receipts_treasury_transaction_id: index('idx_storefront_payment_receipts_treasury_transaction_id')
    .on(table.treasuryTransactionId).where(sql`${table.treasuryTransactionId} IS NOT NULL`),
  uq_storefront_payment_receipts_pending: uniqueIndex('uq_storefront_payment_receipts_pending').on(table.orderId).where(sql`${table.status} = 'pending'`),
}));
