import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { registerColumnRef, baseRelations } from './baseRelations';
import { moneyNumeric } from './moneyColumn';

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  contactName: text('contact_name').default(''),
  country: text('country').default('ایران'),
  province: text('province').default(''),
  phone: text('phone').default(''),
  city: text('city').default(''),
  address: text('address').default(''),
  notes: text('notes').default(''),
  partyType: text('party_type').default('customer'), // 'customer', 'supplier', 'both'
  supplierCategory: text('supplier_category').default(''), // category of supply e.g. سنگ، فلز، بسته‌بندی
  bankInfo: jsonb('bank_info').default({}), // { bankName, accountNumber, shaba, cardNumber }
  contacts: jsonb('contacts').default([]),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0)
}, (table) => ({
  nameTrgmIdx: index('customers_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
  idx_customers_party_type: index('idx_customers_party_type').on(table.partyType),
  idx_customers_is_deleted: index('idx_customers_is_deleted').on(table.isDeleted),
  // v9.0.8 (TD-420): ایندکس یکتای جزئی uq_customers_name_active روی lower(btrim(name)) برای طرف حساب‌های فعال را مهاجرت 0052
  // فقط روی داده بدون نام تکراری می‌سازد (src/services/customers/customerIdentity.ts)؛ v9.0.434 (TD-613): اعلام‌شده تا اسکیما با پایگاه‌داده بخواند
  uq_customers_name_active: uniqueIndex('uq_customers_name_active').on(sql`lower(btrim(${table.name}))`).where(sql`${table.isDeleted} = 0`),
}));
registerColumnRef('customers.id', () => customers.id);

export const crmLeads = pgTable('crm_leads', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  customerName: text('customer_name').default(''),
  phone: text('phone').default(''),
  company: text('company').default(''),
  source: text('source').default('تماس تلفنی'), // 'تماس تلفنی', 'وبسایت', 'معرف', 'نمایشگاه', 'شبکه‌های اجتماعی', 'سایر'
  stage: text('stage').default('lead'), // 'lead', 'qualified', 'proposal', 'won', 'lost'
  estimatedValue: moneyNumeric('estimated_value').default(sql`0`),
  currency: text('currency').default('IRR'),
  probability: integer('probability').default(50),
  assignedTo: text('assigned_to').default(''),
  // V10-4.1 / TD-169: فروشنده مسئول از پرسنل — ارجاع از طریق baseRelations
  assignedPersonnelId: integer('assigned_personnel_id').references(baseRelations.personnelId),
  expectedCloseDate: text('expected_close_date').default(''),
  notes: text('notes').default(''),
  status: text('status').default('active'), // 'active', 'won', 'lost', 'archived'
  contacts: jsonb('contacts').default([]),
  hasProforma: integer('has_proforma').default(0),
  // V3.1.29: Loose reference without circular FK constraint — documents.crmLeadId is the single source of truth for the relationship
  proformaId: integer('proforma_id'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  createdBy: text('created_by').default(''),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_crm_stage: index('idx_crm_stage').on(table.stage),
  idx_crm_assigned: index('idx_crm_assigned').on(table.assignedTo),
  idx_crm_deleted: index('idx_crm_deleted').on(table.isDeleted),
  idx_crm_proforma: index('idx_crm_proforma').on(table.proformaId),
  // v9.0.435 (TD-614): an index leading with each foreign key column (migration 0093)
  idx_crm_leads_assigned_personnel_id: index('idx_crm_leads_assigned_personnel_id').on(table.assignedPersonnelId).where(sql`${table.assignedPersonnelId} IS NOT NULL`),
  idx_crm_leads_customer_id: index('idx_crm_leads_customer_id').on(table.customerId).where(sql`${table.customerId} IS NOT NULL`),
}));
registerColumnRef('crmLeads.id', () => crmLeads.id);

export const crmActivities = pgTable('crm_activities', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id').references(() => crmLeads.id),
  customerId: integer('customer_id').references(() => customers.id),
  type: text('type').notNull(), // 'call', 'meeting', 'email', 'whatsapp', 'note', 'quote', 'task'
  title: text('title').notNull(),
  description: text('description').default(''),
  result: text('result').default(''),
  loggedBy: text('logged_by').default(''),
  assignedTo: text('assigned_to').default(''),
  // V10-4.1 / TD-169: مسئول تسک از پرسنل — ارجاع از طریق baseRelations
  assignedPersonnelId: integer('assigned_personnel_id').references(baseRelations.personnelId),
  mentions: jsonb('mentions').default([]),
  activityDate: text('activity_date').default(''),
  activityDateIso: text('activity_date_iso').default(''),
  nextFollowUpDate: text('next_followup_date').default(''),
  nextFollowUpDateIso: text('next_followup_date_iso').default(''),
  nextFollowUpTask: text('next_followup_task').default(''),
  isFollowUpCompleted: integer('is_followup_completed').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_crm_act_lead: index('idx_crm_act_lead').on(table.leadId),
  idx_crm_act_cust: index('idx_crm_act_cust').on(table.customerId),
  idx_crm_act_date: index('idx_crm_act_date').on(table.activityDate),
  idx_crm_act_date_iso: index('idx_crm_act_date_iso').on(table.activityDateIso),
  idx_crm_act_next_iso: index('idx_crm_act_next_iso').on(table.nextFollowUpDateIso),
  idx_crm_act_deleted: index('idx_crm_act_deleted').on(table.isDeleted),
  // v9.0.435 (TD-614): an index leading with each foreign key column (migration 0093)
  idx_crm_activities_assigned_personnel_id: index('idx_crm_activities_assigned_personnel_id').on(table.assignedPersonnelId).where(sql`${table.assignedPersonnelId} IS NOT NULL`),
}));

export const transfers = pgTable('transfers', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // e.g. "003", "001"
  title: text('title').default(''),
  image: text('image').default(''),
  thumbnail: text('thumbnail').default(''),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_transfer_code: index('idx_transfer_code').on(table.code),
  idx_transfer_deleted: index('idx_transfer_deleted').on(table.isDeleted),
}));
