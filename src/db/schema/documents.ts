import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, varchar, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { FinancialAttachment } from '../../types';
import { users } from './auth';
import { registerColumnRef, baseRelations } from './baseRelations';
import { moneyNumeric } from './moneyColumn';

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  refNumber: text('ref_number').notNull(),
  // v7.0.21 (TD-178 / audit P0-2): سال مالی «پارتیشن شماره‌گذاری» — همان سالی که شمارنده document_ref_counters
  // هنگام تخصیص شماره عطف استفاده کرده است. یکتایی شماره عطف روی (type, ref_fiscal_year, ref_number) است
  // (ایندکس uq_documents_type_fy_ref_active در مهاجرت 0015). در صورت تهی بودن، تریگر دیتابیس آن را از date پر می‌کند.
  refFiscalYear: integer('ref_fiscal_year'),
  date: timestamp('date', { withTimezone: false, mode: 'string' }).notNull(),
  // V10-4.3 / TD-169: لینک رسمی سند به پرونده فروش CRM — ارجاع از طریق baseRelations
  crmLeadId: integer('crm_lead_id').references(baseRelations.crmLeadsId),
  // V3.1.46 (TD-070) / TD-169: لینک رسمی سند انبار/فاکتور به پروژه تولید — ارجاع از طریق baseRelations
  projectId: integer('project_id').references(baseRelations.productionProjectsId),
  // v7.0.81 (TD-230): فاکتور فروش اصلی سند برگشت از فروش؛ بهای ورود کالای برگشتی از گردش خروج همان فاکتور خوانده می‌شود
  returnOfDocumentId: integer('return_of_document_id').references((): AnyPgColumn => documents.id),
  user: text('user'),
  notes: text('notes'),
  buyerName: text('buyer_name').default(''),
  buyerCity: text('buyer_city').default(''),
  buyerPhone: text('buyer_phone').default(''),
  buyerAddress: text('buyer_address').default(''),
  status: text('status').default('final'),
  currency: text('currency').default('IRR'),
  // v7.0.32 (TD-197 / audit P1-7): مالیات بر ارزش افزوده ساختاریافته؛ تنها منبع مبلغ مالیات سند حسابداری فروش.
  // vat_amount مبلغ نهایی مالیات (به ارز سند) است؛ vat_percent فقط برای نمایش/ویرایش فرم نگه داشته می‌شود.
  vatPercent: numeric('vat_percent', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  vatAmount: moneyNumeric('vat_amount').notNull().default(sql`0`),
  // v7.0.103 (TD-191): هزینه ارسال و کارمزد فاکتور فروش (سفارش ووکامرس)؛ در سند حسابداری به «درآمد حمل و خدمات» می‌رود
  serviceChargeAmount: moneyNumeric('service_charge_amount').notNull().default(sql`0`),
  // v7.0.63 (TD-198): نرخ تسعیر (ریال به ازای یک واحد ارز سند)؛ برای سند غیرریالی الزامی، برای ریالی تهی.
  exchangeRate: moneyNumeric('exchange_rate'),
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
  idx_docs_return_of_document: index('idx_docs_return_of_document').on(table.returnOfDocumentId),
}));
registerColumnRef('documents.id', () => documents.id);

// v7.0.62 (TD-179): گزارش اصلاح سال مالی شماره‌گذاری اسناد روز مرزی نوروز (مهاجرت 0024). فقط گزارش؛ شماره عطف تغییر نمی‌کند.
export const refFiscalYearCorrections = pgTable('ref_fiscal_year_corrections', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => documents.id),
  docType: text('doc_type').notNull(),
  refNumber: text('ref_number').notNull(),
  documentDate: timestamp('document_date', { withTimezone: false, mode: 'string' }).notNull(),
  oldFiscalYear: integer('old_fiscal_year').notNull(),
  newFiscalYear: integer('new_fiscal_year').notNull(),
  status: text('status').notNull(), // 'corrected' | 'conflict'
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

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
  itemId: integer('item_id').notNull().references(baseRelations.itemsId),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unitPrice: moneyNumeric('unit_price').default(sql`0`),
  discount: moneyNumeric('discount').default(sql`0`),
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
