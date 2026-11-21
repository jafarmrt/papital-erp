import { pgTable, text, serial, integer, timestamp, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { items } from './inventory';
import { storefrontCampaigns } from './storefrontCampaigns';

/**
 * v12 phase 9b (migration 0028, package 18, start plan V12_SITE_NEXT_START_PLAN.md §6): the site's menus. One row of
 * `storefront_menus` per place on the site (header, phone drawer, footer, bottom bar) holds its switch and the version
 * a whole save checks; it starts off, and then the site keeps its fixed menu. `storefront_menu_items` holds the items,
 * one submenu level under `parentId`. A product link keeps its item and a campaign link its row, so a later change of
 * slug keeps the link; every other kind keeps its target as text. Removing an item is a soft delete.
 */
export const storefrontMenus = pgTable('storefront_menus', {
  location: text('location').primaryKey(),
  isEnabled: integer('is_enabled').notNull().default(0),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

export const storefrontMenuItems = pgTable('storefront_menu_items', {
  id: serial('id').primaryKey(),
  location: text('location').notNull().references(() => storefrontMenus.location),
  parentId: integer('parent_id').references((): AnyPgColumn => storefrontMenuItems.id),
  position: integer('position').notNull().default(0),
  label: text('label').notNull(),
  linkKind: text('link_kind').notNull(),
  target: text('target').notNull().default(''),
  targetItemId: integer('target_item_id').references(() => items.id),
  targetCampaignId: integer('target_campaign_id').references(() => storefrontCampaigns.id),
  icon: text('icon').notNull().default(''),
  isActive: integer('is_active').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  idx_storefront_menu_items_location: index('idx_storefront_menu_items_location').on(table.location, table.parentId, table.position),
  idx_storefront_menu_items_parent_id: index('idx_storefront_menu_items_parent_id').on(table.parentId).where(sql`${table.parentId} IS NOT NULL`),
  idx_storefront_menu_items_target_item_id: index('idx_storefront_menu_items_target_item_id').on(table.targetItemId).where(sql`${table.targetItemId} IS NOT NULL`),
  idx_storefront_menu_items_target_campaign_id: index('idx_storefront_menu_items_target_campaign_id').on(table.targetCampaignId).where(sql`${table.targetCampaignId} IS NOT NULL`),
}));
