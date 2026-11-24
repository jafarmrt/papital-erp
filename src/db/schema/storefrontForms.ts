import { pgTable, text, serial, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { FormField } from '../../lib/storefront/storefrontFormRules';
import type { MessageAnswer, MessageStatus } from '../../lib/storefront/storefrontMessageRules';
import { crmLeads } from './crm';

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

/**
 * v12 phase 10f (migration 0038, package 18): an answer a visitor sent through a form of the site. `formTitle` and
 * `answers` are a copy made when it arrived, so a form changed or removed later never changes a message. The answers
 * hold what people wrote (names, phone numbers): they are read only with the keys of «پیام‌های سایت» and never copied
 * into the audit log. Removing a message is a soft delete.
 */
export const storefrontMessages = pgTable('storefront_messages', {
  id: serial('id').primaryKey(),
  formId: integer('form_id').notNull().references(() => storefrontForms.id),
  formTitle: text('form_title').notNull(),
  answers: jsonb('answers').$type<MessageAnswer[]>().notNull().default([]),
  status: text('status').$type<MessageStatus>().notNull().default('new'),
  statusBy: text('status_by').notNull().default(''),
  statusAt: timestamp('status_at', { withTimezone: true, mode: 'string' }),
  leadId: integer('lead_id').references(() => crmLeads.id),
  requestKey: text('request_key').notNull(),
  requestHash: text('request_hash').notNull(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_storefront_messages_request_key: uniqueIndex('uq_storefront_messages_request_key').on(table.requestKey),
  idx_storefront_messages_list: index('idx_storefront_messages_list').on(table.status, table.createdAt.desc(), table.id.desc()).where(sql`${table.isDeleted} = 0`),
  idx_storefront_messages_created_at: index('idx_storefront_messages_created_at').on(table.createdAt),
  idx_storefront_messages_form_id: index('idx_storefront_messages_form_id').on(table.formId),
  idx_storefront_messages_lead_id: index('idx_storefront_messages_lead_id').on(table.leadId).where(sql`${table.leadId} IS NOT NULL`),
}));
