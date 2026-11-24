import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { FormField } from '../../lib/storefront/storefrontFormRules';

/**
 * v12 phase 10f (migration 0037, package 18, start plan V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): a form the shop builds
 * for its site. `fields` is the list the server rebuilds from known keys on every save; the form is on the site only
 * while `enabled` is 1. Removing a form is a soft delete, which frees its key.
 */
export const storefrontForms = pgTable('storefront_forms', {
  id: serial('id').primaryKey(),
  key: text('key').notNull(),
  title: text('title').notNull(),
  intro: text('intro').notNull().default(''),
  fields: jsonb('fields').$type<FormField[]>().notNull().default([]),
  submitLabel: text('submit_label').notNull().default(''),
  successMessage: text('success_message').notNull().default(''),
  enabled: integer('enabled').notNull().default(0),
  makesLead: integer('makes_lead').notNull().default(0),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  updatedBy: text('updated_by').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_storefront_forms_key_live: uniqueIndex('uq_storefront_forms_key_live').on(table.key).where(sql`${table.isDeleted} = 0`),
}));
