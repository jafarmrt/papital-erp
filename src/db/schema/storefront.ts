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

/**
 * v11 phase 8.2b (migration 0016): a buyer group, one of the site's price policies besides the retail one of the settings
 * (start plan §6, decision 5). Its prices, minimums, payment methods and visible products apply only to an active account
 * approved into it.
 */
export const storefrontBuyerGroups = pgTable('storefront_buyer_groups', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  priceList: text('price_list').notNull().default(''),
  minOrderAmount: moneyNumeric('min_order_amount').notNull().default(sql`0`),
  minLineQuantity: integer('min_line_quantity').notNull().default(0),
  allowCard: integer('allow_card').notNull().default(1),
  allowOnAccount: integer('allow_on_account').notNull().default(0),
  creditLimit: moneyNumeric('credit_limit').notNull().default(sql`0`),
  catalogScope: text('catalog_scope').notNull().default('all'),
  collections: text('collections').array().notNull().default(sql`'{}'::text[]`),
  acceptsDiscounts: integer('accepts_discounts').notNull().default(0),
  isActive: integer('is_active').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
}, (table) => ({
  uq_storefront_buyer_groups_code_live: uniqueIndex('uq_storefront_buyer_groups_code_live').on(table.code).where(sql`${table.isDeleted} = 0`),
}));

/**
 * A buyer's account on the site: retail (no group) or approved into a buyer group. `status` 'pending' is an account the
 * wholesale form made, with no password until a colleague approves it; only the scrypt hash of a password is kept.
 */
export const storefrontBuyerAccounts = pgTable('storefront_buyer_accounts', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id').references(() => storefrontBuyerGroups.id),
  customerId: integer('customer_id').references(baseRelations.customersId),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  phoneKey: text('phone_key').notNull(),
  city: text('city').notNull().default(''),
  status: text('status').notNull().default('active'),
  passwordHash: text('password_hash').notNull().default(''),
  applicationStatus: text('application_status').notNull().default('none'),
  companyName: text('company_name').notNull().default(''),
  nationalId: text('national_id').notNull().default(''),
  economicCode: text('economic_code').notNull().default(''),
  applicationNote: text('application_note').notNull().default(''),
  appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }),
  reviewedBy: text('reviewed_by').notNull().default(''),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'string' }),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedBy: text('updated_by').notNull().default(''),
  version: integer('version').notNull().default(1),
}, (table) => ({
  uq_storefront_buyer_accounts_phone_key: uniqueIndex('uq_storefront_buyer_accounts_phone_key').on(table.phoneKey),
  idx_storefront_buyer_accounts_group_id: index('idx_storefront_buyer_accounts_group_id').on(table.groupId).where(sql`${table.groupId} IS NOT NULL`),
  idx_storefront_buyer_accounts_customer_id: index('idx_storefront_buyer_accounts_customer_id').on(table.customerId).where(sql`${table.customerId} IS NOT NULL`),
  idx_storefront_buyer_accounts_application: index('idx_storefront_buyer_accounts_application').on(table.applicationStatus, table.appliedAt.desc(), table.id.desc()),
}));

/** A sign-in session of a buyer account; only the SHA-256 of its token is kept */
export const storefrontBuyerSessions = pgTable('storefront_buyer_sessions', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references(() => storefrontBuyerAccounts.id),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
}, (table) => ({
  uq_storefront_buyer_sessions_token_hash: uniqueIndex('uq_storefront_buyer_sessions_token_hash').on(table.tokenHash),
  idx_storefront_buyer_sessions_account_id: index('idx_storefront_buyer_sessions_account_id').on(table.accountId).where(sql`${table.revokedAt} IS NULL`),
}));

/** A one-time set-password link a colleague made for an account; only the SHA-256 of its token is kept */
export const storefrontPasswordTokens = pgTable('storefront_password_tokens', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id').notNull().references(() => storefrontBuyerAccounts.id),
  tokenHash: text('token_hash').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
}, (table) => ({
  uq_storefront_password_tokens_token_hash: uniqueIndex('uq_storefront_password_tokens_token_hash').on(table.tokenHash),
  idx_storefront_password_tokens_account_id: index('idx_storefront_password_tokens_account_id').on(table.accountId).where(sql`${table.usedAt} IS NULL`),
}));
