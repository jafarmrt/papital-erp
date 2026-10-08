import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, uniqueIndex, varchar, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
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
  crmLeadId: integer('crm_lead_id').references(baseRelations.crmLeadsId, { onDelete: 'set null' }),
  // V3.1.46 (TD-070) / TD-169: لینک رسمی سند انبار/فاکتور به پروژه تولید — ارجاع از طریق baseRelations
  projectId: integer('project_id').references(baseRelations.productionProjectsId),
  // v7.0.81 (TD-230): فاکتور فروش اصلی سند برگشت از فروش؛ بهای ورود کالای برگشتی از گردش خروج همان فاکتور خوانده می‌شود
  returnOfDocumentId: integer('return_of_document_id').references((): AnyPgColumn => documents.id),
  // v9.0.347 (TD-691، تصمیم ت۲ بسته ۱۰): درخواست خریدی که «تبدیل به سفارش» این سفارش را برایش صادر کرده است؛ فهرست،
  // خلاصه و تحویل سفارش‌های تدارکات فقط سندهای دارای این پیوند را می‌بینند (مهاجرت 0082)
  procurementRequisitionId: integer('procurement_requisition_id').references(baseRelations.purchaseRequisitionsId),
  user: text('user'),
  notes: text('notes'),
  // v9.0.336 (TD-778، تصمیم ت۶ الف بسته ۸): طرف حساب سند فروش و خرید با شناسه (مهاجرت 0080)؛ نام خریدار فقط برای نمایش است
  partyId: integer('party_id').references(baseRelations.customersId),
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
  idx_docs_procurement_requisition: index('idx_docs_procurement_requisition').on(table.procurementRequisitionId).where(sql`procurement_requisition_id IS NOT NULL`),
  // v9.0.448 (TD-613): indexes of migrations 0015 and 0080, declared so the schema matches the database; the unique one is
  // built only on data without duplicate numbers
  idx_docs_type_ref_fiscal_year: index('idx_docs_type_ref_fiscal_year').on(table.type, table.refFiscalYear),
  uq_documents_type_fy_ref_active: uniqueIndex('uq_documents_type_fy_ref_active').on(table.type, table.refFiscalYear, table.refNumber)
    .where(sql`${table.isDeleted} = 0 AND length(${table.refNumber}) > 0`),
  idx_documents_party_id: index('idx_documents_party_id').on(table.partyId).where(sql`${table.partyId} IS NOT NULL`),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_documents_crm_lead_id: index('idx_documents_crm_lead_id').on(table.crmLeadId).where(sql`${table.crmLeadId} IS NOT NULL`),
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
}, (table) => ({
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_ref_fiscal_year_corrections_document_id: index('idx_ref_fiscal_year_corrections_document_id').on(table.documentId),
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
  itemId: integer('item_id').notNull().references(baseRelations.itemsId),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unitPrice: moneyNumeric('unit_price').default(sql`0`),
  discount: moneyNumeric('discount').default(sql`0`),
  location: text('location').default('main'),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_doc_id: index('doc_items_doc_id').on(table.documentId),
  idx_item_id: index('doc_items_item_id').on(table.itemId),
  // v9.0.448 (TD-613): index of migration 0012, declared so the schema matches the database
  idx_doc_items_deleted: index('idx_doc_items_deleted').on(table.isDeleted),
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
