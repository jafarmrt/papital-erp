import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { items } from './inventory';
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
