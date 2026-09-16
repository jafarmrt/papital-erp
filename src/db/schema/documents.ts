import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, varchar, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FinancialAttachment } from '../../types';
import { crmLeads } from './crm';
import { productionProjects } from './projects';
import { items } from './inventory';
import { users } from './auth';

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  refNumber: text('ref_number').notNull(),
  date: timestamp('date', { withTimezone: false, mode: 'string' }).notNull(),
  // V10-4.3: لینک رسمی سند به پرونده فروش CRM — جایگزین اتکا به تگ متنی «CRM #n» در یادداشت‌ها
  // (پسوند AnyPgColumn برای شکستن استنتاج چرخه‌ای documents↔crmLeads)
  crmLeadId: integer('crm_lead_id').references((): AnyPgColumn => crmLeads.id),
  // V3.1.46 (TD-070): لینک رسمی سند انبار/فاکتور به پروژه تولید — منبع یگانه ردیابی سند↔پروژه
  projectId: integer('project_id').references((): AnyPgColumn => productionProjects.id),
  user: text('user'),
  notes: text('notes'),
  buyerName: text('buyer_name').default(''),
  buyerCity: text('buyer_city').default(''),
  buyerPhone: text('buyer_phone').default(''),
  buyerAddress: text('buyer_address').default(''),
  status: text('status').default('final'),
  currency: text('currency').default('IRR'),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
  deletedBy: text('deleted_by'),
}, (table) => ({
  idx_type_deleted: index('docs_type_deleted').on(table.type, table.isDeleted),
  idx_date: index('docs_date').on(table.date),
  idx_buyer_name: index('idx_docs_buyer_name').on(table.buyerName),
  idx_docs_project: index('idx_docs_project').on(table.projectId),
}));

export const documentRefCounters = pgTable('document_ref_counters', {
  docType: varchar('doc_type', { length: 20 }).notNull(),
  fiscalYear: integer('fiscal_year').notNull(),
  lastRefNumber: integer('last_ref_number').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.docType, t.fiscalYear] }),
}));

export const documentItems = pgTable('document_items', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => documents.id),
  itemId: integer('item_id').notNull().references((): AnyPgColumn => items.id),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4, mode: 'number' }).default(0),
  discount: numeric('discount', { precision: 18, scale: 4, mode: 'number' }).default(0),
  location: text('location').default('main'),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_doc_id: index('doc_items_doc_id').on(table.documentId),
  idx_item_id: index('doc_items_item_id').on(table.itemId),
}));

export const formDrafts = pgTable('form_drafts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  username: text('username').default(''),
  sessionId: text('session_id').default(''),
  entityType: text('entity_type').notNull(), // 'invoice', 'voucher', 'document', 'project', 'cheque', 'treasury'
  draftKey: text('draft_key').default('default'), // e.g. 'new_invoice', 'voucher_create', or entityId for editing
  payload: jsonb('payload').notNull(),
  summary: text('summary').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  expiresAt: timestamp('expires_at', { mode: 'string' }),
  isDeleted: integer('is_deleted').default(0)
}, (table) => ({
  idx_form_drafts_user_entity: index('idx_form_drafts_user_entity').on(table.userId, table.entityType, table.draftKey),
  idx_form_drafts_session: index('idx_form_drafts_session').on(table.sessionId),
  idx_form_drafts_updated: index('idx_form_drafts_updated').on(table.updatedAt)
}));

export const woocommerceOrderLogs = pgTable('woocommerce_order_logs', {
  id: serial('id').primaryKey(),
  wcOrderId: text('wc_order_id').notNull().unique(),
  erpDocumentId: integer('erp_document_id').references(() => documents.id),
  status: text('status').notNull(), // 'processed', 'failed', 'already_exists'
  buyerName: text('buyer_name').default(''),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2, mode: 'number' }).default(0),
  payload: jsonb('payload'),
  errorMessage: text('error_message').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wc_order_id: index('idx_wc_order_id').on(table.wcOrderId),
  idx_wc_status: index('idx_wc_status').on(table.status),
  idx_wc_erp_doc: index('idx_wc_erp_doc').on(table.erpDocumentId),
}));
