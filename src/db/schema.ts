import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, varchar, primaryKey, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  fullName: text('full_name').notNull(),
  role: text('role').notNull(), // 'admin', 'warehouse_keeper', 'accountant', etc. or role code
  avatarUrl: text('avatar_url').default(''),
  mustResetPassword: integer('must_reset_password').default(0),
  failedLoginCount: integer('failed_login_count').default(0),
  lockedUntil: text('locked_until'),
  // V9-2.2: ابطال نشست با نسخه توکن و حذف نرم کاربران
  tokenVersion: integer('token_version').default(0),
  isDeleted: integer('is_deleted').default(0),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
});

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  description: text('description').default(''),
  permissions: jsonb('permissions').default([]),
  isSystem: integer('is_system').default(0)
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  type: text('type').notNull(), // 'product' or 'raw_material'
  defaultUnit: text('default_unit').default('عدد')
});

export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  isActive: integer('is_active').default(1)
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
});

export const migrationsLog = pgTable('migrations_log', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  appliedAt: timestamp('applied_at', { mode: 'string' }).defaultNow()
});

export const changelogs = pgTable('changelogs', {
  id: serial('id').primaryKey(),
  version: text('version').notNull(),
  date: timestamp('date', { withTimezone: false, mode: 'string' }).notNull(),
  features: text('features').notNull(),
  fixes: text('fixes').notNull()
});

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
}));

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  currentStock: numeric('current_stock', { precision: 18, scale: 4 }).$type<number>().default(0),
  unit: text('unit').notNull(),
  category: text('category').default(''),
  image: text('image').default(''),
  thumbnail: text('thumbnail').default(''),
  reorderPoint: numeric('reorder_point', { precision: 18, scale: 4 }).$type<number>().default(0),
  weightedAverageCost: numeric('weighted_average_cost', { precision: 18, scale: 4 }).$type<number>().default(0),
  stocks: jsonb('stocks').default({}), // Replaces dynamic columns stock_safe, etc.
  color: text('color'),
  weight: numeric('weight', { precision: 18, scale: 4 }).$type<number>(),
  material: text('material'),
  size: text('size'),
  lastKardexRebuildAt: timestamp('last_kardex_rebuild_at', { mode: 'string' }),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_type_deleted: index('items_type_deleted').on(table.type, table.isDeleted),
  idx_code: index('items_code').on(table.code),
  idx_category: index('items_category').on(table.category),
  nameTrgmIdx: index('items_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`)
}));

export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id),
  documentId: integer('document_id').references(() => documents.id),
  type: text('type').notNull(), // 'in' or 'out'
  quantity: numeric('quantity', { precision: 18, scale: 4 }).$type<number>().notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).$type<number>().default(0),
  totalPrice: numeric('total_price', { precision: 18, scale: 4 }).$type<number>().default(0),
  date: timestamp('date', { withTimezone: false, mode: 'string' }).notNull(),
  documentType: text('document_type'),
  documentRef: text('document_ref'),
  createdBy: text('created_by'),
  notes: text('notes'),
  location: text('location').default('main'),
  reversalOfId: integer('reversal_of_id'),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_item_date_id_active: index('tx_item_date_id_active').on(table.itemId, table.isDeleted, table.date, table.id),
  idx_item_loc_active: index('tx_item_loc_active').on(table.itemId, table.location, table.isDeleted),
  idx_item_active_date: index('tx_item_active_date').on(table.itemId, table.isDeleted, table.date),
  idx_doc: index('tx_doc_id').on(table.documentId),
  idx_date: index('tx_date').on(table.date),
  idx_type_deleted: index('tx_type_deleted').on(table.type, table.isDeleted),
}));

export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(),
  refNumber: text('ref_number').notNull(),
  date: timestamp('date', { withTimezone: false, mode: 'string' }).notNull(),
  // V10-4.3: لینک رسمی سند به پرونده فروش CRM — جایگزین اتکا به تگ متنی «CRM #n» در یادداشت‌ها
  // (پسوند AnyPgColumn برای شکستن استنتاج چرخه‌ای documents↔crmLeads)
  crmLeadId: integer('crm_lead_id').references((): AnyPgColumn => crmLeads.id),
  user: text('user'),
  notes: text('notes'),
  buyerName: text('buyer_name').default(''),
  buyerCity: text('buyer_city').default(''),
  buyerPhone: text('buyer_phone').default(''),
  buyerAddress: text('buyer_address').default(''),
  status: text('status').default('final'),
  currency: text('currency').default('IRR'),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
  deletedAt: timestamp('deleted_at', { mode: 'string' }),
  deletedBy: text('deleted_by'),
}, (table) => ({
  idx_type_deleted: index('docs_type_deleted').on(table.type, table.isDeleted),
  idx_date: index('docs_date').on(table.date),
  idx_buyer_name: index('idx_docs_buyer_name').on(table.buyerName),
}));

export const documentRefCounters = pgTable('document_ref_counters', {
  docType: varchar('doc_type', { length: 20 }).notNull(),
  fiscalYear: integer('fiscal_year').notNull(),
  lastRefNumber: integer('last_ref_number').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.docType, t.fiscalYear] }),
}));

// V10-2.1: شمارنده اتمیک کد کالا — جایگزین الگوی ممنوع MAX()+1 (DB-001)
export const itemCodeCounters = pgTable('item_code_counters', {
  scope: varchar('scope', { length: 20 }).notNull(), // 'product' | 'raw_material'
  prefixKey: varchar('prefix_key', { length: 60 }).notNull(),
  lastNumber: integer('last_number').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.scope, t.prefixKey] }),
}));

export const documentItems = pgTable('document_items', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => documents.id),
  itemId: integer('item_id').notNull().references(() => items.id),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).$type<number>().notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).$type<number>().default(0),
  discount: numeric('discount', { precision: 18, scale: 4 }).$type<number>().default(0),
  location: text('location').default('main'),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_doc_id: index('doc_items_doc_id').on(table.documentId),
  idx_item_id: index('doc_items_item_id').on(table.itemId),
}));

export const itemPrices = pgTable('item_prices', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => items.id),
  title: text('title').notNull(),
  price: numeric('price', { precision: 18, scale: 4 }).$type<number>().notNull(),
  currency: text('currency').default('IRR'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_item_id: index('item_prices_item_id').on(table.itemId),
}));

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: text('username').notNull(),
  userFullName: text('user_full_name').default(''),
  action: text('action').notNull(), // 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', etc.
  entity: text('entity').notNull(), // 'کالا', 'فاکتور', 'کاربر', 'نقش', 'مشتری', 'تنظیمات', etc.
  entityId: text('entity_id').default(''),
  description: text('description').notNull(),
  details: jsonb('details').default({}),
  ipAddress: text('ip_address').default(''),
  timestamp: timestamp('timestamp', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_username: index('activity_logs_username').on(table.username),
  idx_action: index('activity_logs_action').on(table.action),
  idx_entity: index('activity_logs_entity').on(table.entity),
  idx_timestamp: index('activity_logs_timestamp').on(table.timestamp),
}));

export const productionProjects = pgTable('production_projects', {
  id: serial('id').primaryKey(),
  projectCode: text('project_code').notNull().unique(),
  title: text('title').notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  customerName: text('customer_name').default(''),
  itemId: integer('item_id').references(() => items.id),
  itemCode: text('item_code').default(''),
  itemName: text('item_name').default(''),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).$type<number>().notNull().default(1),
  unit: text('unit').default('عدد'),
  startDate: text('start_date').default(''),
  endDate: text('end_date').default(''),
  status: text('status').default('planned'), // 'planned', 'in_progress', 'completed', 'paused', 'cancelled'
  priority: text('priority').default('medium'), // 'low', 'medium', 'high', 'urgent'
  description: text('description').default(''),
  products: jsonb('products').default([]),
  inventoryControl: jsonb('inventory_control').default({}),
  stageSchedules: jsonb('stage_schedules').default({}),
  customStages: jsonb('custom_stages').default([]),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  createdBy: text('created_by').default(''),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_proj_code: index('idx_proj_code').on(table.projectCode),
  idx_proj_status: index('idx_proj_status').on(table.status),
  idx_proj_deleted: index('idx_proj_deleted').on(table.isDeleted),
}));

export const projectStages = pgTable('project_stages', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  stageOrder: integer('stage_order').notNull().default(1),
  title: text('title').notNull(), // e.g., 'خرید مواد اولیه', 'تولید کاشی', 'چاپ ترنسفر', 'مونتاژ', 'کنترل کیفیت'
  status: text('status').default('pending'), // 'pending', 'in_progress', 'completed', 'blocked'
  startDate: text('start_date').default(''),
  endDate: text('end_date').default(''),
  assignedPersonnel: jsonb('assigned_personnel').default([]), // array of names or user IDs
  requiredResources: jsonb('required_resources').default([]), // array of tools/materials/machines
  progressPercent: integer('progress_percent').default(0),
  notes: text('notes').default(''),
  completedAt: text('completed_at').default(''),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_stage_proj: index('idx_stage_proj').on(table.projectId),
  idx_stage_order: index('idx_stage_order').on(table.stageOrder),
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
}, (table) => ({
  idx_transfer_code: index('idx_transfer_code').on(table.code),
}));

export const dailyWorkLogs = pgTable('daily_work_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  username: text('username').notNull(),
  userFullName: text('user_full_name').default(''),
  date: text('date').notNull(),
  dateIso: text('date_iso').default(''),
  startTime: text('start_time').default('08:00'),
  endTime: text('end_time').default('17:00'),
  workHours: numeric('work_hours', { precision: 18, scale: 4 }).$type<number>().default(8),
  workMode: text('work_mode').default('onsite'), // 'onsite', 'remote', 'hybrid'
  title: text('title').notNull(),
  content: text('content').notNull(),
  projectId: integer('project_id').references(() => productionProjects.id),
  projectName: text('project_name').default(''),
  tags: jsonb('tags').default([]),
  mentions: jsonb('mentions').default([]), // array of user IDs
  visibility: text('visibility').default('public'), // 'public', 'managers', 'mentioned_only', 'custom', 'private'
  allowedUsers: jsonb('allowed_users').default([]),
  status: text('status').default('submitted'), // 'submitted', 'reviewed'
  managerNotes: text('manager_notes').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_dwl_user: index('idx_dwl_user').on(table.userId),
  idx_dwl_date: index('idx_dwl_date').on(table.date),
  idx_dwl_date_iso: index('idx_dwl_date_iso').on(table.dateIso),
  idx_dwl_vis: index('idx_dwl_vis').on(table.visibility),
  idx_dwl_deleted: index('idx_dwl_deleted').on(table.isDeleted),
}));

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  senderId: integer('sender_id').references(() => users.id),
  senderName: text('sender_name').default(''),
  type: text('type').default('mention'), // 'mention', 'work_log_review', 'system'
  title: text('title').notNull(),
  message: text('message').notNull(),
  link: text('link').default(''),
  isRead: integer('is_read').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_notif_user: index('idx_notif_user').on(table.userId),
  idx_notif_read: index('idx_notif_read').on(table.isRead),
}));

export const crmLeads = pgTable('crm_leads', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  customerId: integer('customer_id').references(() => customers.id),
  customerName: text('customer_name').default(''),
  phone: text('phone').default(''),
  company: text('company').default(''),
  source: text('source').default('تماس تلفنی'), // 'تماس تلفنی', 'وبسایت', 'معرف', 'نمایشگاه', 'شبکه‌های اجتماعی', 'سایر'
  stage: text('stage').default('lead'), // 'lead', 'qualified', 'proposal', 'won', 'lost'
  estimatedValue: numeric('estimated_value', { precision: 18, scale: 4 }).$type<number>().default(0),
  currency: text('currency').default('IRR'),
  probability: integer('probability').default(50),
  assignedTo: text('assigned_to').default(''),
  // V10-4.1: فروشنده مسئول از پرسنل — لینک رسمی با حفظ snapshot متنی
  assignedPersonnelId: integer('assigned_personnel_id').references(() => personnel.id),
  expectedCloseDate: text('expected_close_date').default(''),
  notes: text('notes').default(''),
  status: text('status').default('active'), // 'active', 'won', 'lost', 'archived'
  contacts: jsonb('contacts').default([]),
  hasProforma: integer('has_proforma').default(0),
  proformaId: integer('proforma_id').references(() => documents.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  createdBy: text('created_by').default(''),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_crm_stage: index('idx_crm_stage').on(table.stage),
  idx_crm_assigned: index('idx_crm_assigned').on(table.assignedTo),
  idx_crm_deleted: index('idx_crm_deleted').on(table.isDeleted),
}));

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
  // V10-4.1: مسئول تسک از پرسنل
  assignedPersonnelId: integer('assigned_personnel_id').references(() => personnel.id),
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
}));

export const personnel = pgTable('personnel', {
  id: serial('id').primaryKey(),
  firstName: text('first_name').default(''),
  lastName: text('last_name').default(''),
  fullName: text('full_name').notNull(),
  personnelCode: text('personnel_code').default(''),
  userId: integer('user_id').references(() => users.id),
  gender: text('gender').default('مرد'),
  birthDate: text('birth_date').default(''),
  nationality: text('nationality').default('ایرانی'),
  nationalId: text('national_id').default(''),
  phone: text('phone').default(''),
  employmentStatus: text('employment_status').default('فعال'), // 'فعال', 'قطع همکاری', 'مرخصی', 'تعلیق'
  // V10-4.4: مدل حقوق — 'none' | 'piecework' (پیش‌فرض) | 'monthly_fixed' | 'mixed'
  salaryType: text('salary_type').default('none'),
  monthlySalary: numeric('monthly_salary', { precision: 18, scale: 4 }).$type<number>().default(0),
  jobTitle: text('job_title').default(''),
  education: text('education').default(''),
  endDate: text('end_date').default(''),
  terminationReason: text('termination_reason').default(''),
  specializedSkills: text('specialized_skills').default(''),
  otherSkills: text('other_skills').default(''),
  referralSource: text('referral_source').default(''),
  cardNumber: text('card_number').default(''),
  accountNumber: text('account_number').default(''),
  shebaNumber: text('sheba_number').default(''),
  bankName: text('bank_name').default(''),
  nobitexUsername: text('nobitex_username').default(''),
  nobitexPassword: text('nobitex_password').default(''),
  address: text('address').default(''),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_personnel_code: index('idx_personnel_code').on(table.personnelCode),
  idx_personnel_user: index('idx_personnel_user').on(table.userId),
  idx_personnel_status: index('idx_personnel_status').on(table.employmentStatus),
  idx_personnel_deleted: index('idx_personnel_deleted').on(table.isDeleted),
}));

export const taskCategories = pgTable('task_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description').default(''),
  isDeleted: integer('is_deleted').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const pieceworkTasks = pgTable('piecework_tasks', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  category: text('category').default('سایر'),
  defaultRate: numeric('default_rate', { precision: 18, scale: 4 }).$type<number>().default(0),
  unit: text('unit').default('عدد'),
  description: text('description').default(''),
  isActive: integer('is_active').default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_ptask_code: index('idx_ptask_code').on(table.code),
  idx_ptask_cat: index('idx_ptask_cat').on(table.category),
  idx_ptask_deleted: index('idx_ptask_deleted').on(table.isDeleted),
}));

export const pieceworkTaskRateHistory = pgTable('piecework_task_rate_history', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => pieceworkTasks.id),
  taskCode: text('task_code').default(''),
  taskTitle: text('task_title').default(''),
  oldRate: numeric('old_rate', { precision: 18, scale: 4 }).$type<number>().default(0),
  newRate: numeric('new_rate', { precision: 18, scale: 4 }).$type<number>().notNull(),
  changeType: text('change_type').default('rate_change'), // 'create', 'rate_change', 'excel_import', 'title_change', 'archived', 'restored'
  reason: text('reason').default(''),
  changedByUserId: integer('changed_by_user_id').references(() => users.id),
  changedByUsername: text('changed_by_username').default(''),
  effectiveDate: text('effective_date').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_ptrh_task: index('idx_ptrh_task').on(table.taskId),
  idx_ptrh_created: index('idx_ptrh_created').on(table.createdAt),
}));

export const pieceworkPersonnelRates = pgTable('piecework_personnel_rates', {
  id: serial('id').primaryKey(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  taskId: integer('task_id').notNull().references(() => pieceworkTasks.id),
  customRate: numeric('custom_rate', { precision: 18, scale: 4 }).$type<number>().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_ppr_personnel: index('idx_ppr_personnel').on(table.personnelId),
  idx_ppr_task: index('idx_ppr_task').on(table.taskId),
}));

export const pieceworkLogs = pgTable('piecework_logs', {
  id: serial('id').primaryKey(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  taskId: integer('task_id').notNull().references(() => pieceworkTasks.id),
  projectId: integer('project_id').references(() => productionProjects.id),
  date: text('date').notNull(),
  dateIso: text('date_iso').default(''),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).$type<number>().notNull(),
  unitRate: numeric('unit_rate', { precision: 18, scale: 4 }).$type<number>().notNull(),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).$type<number>().notNull(),
  notes: text('notes').default(''),
  payrollId: integer('payroll_id').references(() => pieceworkPayrolls.id),
  status: text('status').default('pending'),
  createdById: integer('created_by_id').references(() => users.id),
  createdByUsername: text('created_by_username').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_plog_personnel: index('idx_plog_personnel').on(table.personnelId),
  idx_plog_task: index('idx_plog_task').on(table.taskId),
  idx_plog_project: index('idx_plog_project').on(table.projectId),
  idx_plog_date: index('idx_plog_date').on(table.date),
  idx_plog_date_iso: index('idx_plog_date_iso').on(table.dateIso),
  idx_plog_payroll: index('idx_plog_payroll').on(table.payrollId),
  idx_plog_deleted: index('idx_plog_deleted').on(table.isDeleted),
}));

export const pieceworkPayrolls = pgTable('piecework_payrolls', {
  id: serial('id').primaryKey(),
  payrollNumber: text('payroll_number').notNull(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  title: text('title').notNull(),
  totalPieceworkAmount: numeric('total_piecework_amount', { precision: 18, scale: 4 }).$type<number>().notNull().default(0),
  totalBonuses: numeric('total_bonuses', { precision: 18, scale: 4 }).$type<number>().default(0),
  totalDeductions: numeric('total_deductions', { precision: 18, scale: 4 }).$type<number>().default(0),
  netPayable: numeric('net_payable', { precision: 18, scale: 4 }).$type<number>().notNull(),
  // V10-4.4: سهم حقوق ثابت در این فیش (برای salaryType = monthly_fixed / mixed)
  totalFixedAmount: numeric('total_fixed_amount', { precision: 18, scale: 4 }).$type<number>().default(0),
  // V1.9.0: کسر از مساعده/وام پرسنل — در سند تسویه از حساب مساعده (1301) بستانکار می‌شود
  advanceDeduction: numeric('advance_deduction', { precision: 18, scale: 4 }).$type<number>().default(0),
  status: text('status').default('draft'),
  paymentDate: text('payment_date').default(''),
  paymentMethod: text('payment_method').default(''),
  paymentReference: text('payment_reference').default(''),
  notes: text('notes').default(''),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_ppay_personnel: index('idx_ppay_personnel').on(table.personnelId),
  idx_ppay_number: index('idx_ppay_number').on(table.payrollNumber),
  idx_ppay_status: index('idx_ppay_status').on(table.status),
  idx_ppay_deleted: index('idx_ppay_deleted').on(table.isDeleted),
}));

export const pendingMaterials = pgTable('pending_materials', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  category: text('category').default(''),
  type: text('type').default('raw_material'),
  projectId: integer('project_id'),
  projectTitle: text('project_title').default(''),
  requestedBy: text('requested_by').default(''),
  status: text('status').default('pending'), // 'pending', 'approved', 'rejected'
  reorderPoint: numeric('reorder_point', { precision: 18, scale: 4 }).$type<number>().default(0),
  weightedAverageCost: numeric('weighted_average_cost', { precision: 18, scale: 4 }).$type<number>().default(0),
  color: text('color').default(''),
  weight: numeric('weight', { precision: 18, scale: 4 }).$type<number>().default(0),
  material: text('material').default(''),
  size: text('size').default(''),
  image: text('image').default(''),
  thumbnail: text('thumbnail').default(''),
  rejectionReason: text('rejection_reason').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_pmat_status: index('idx_pmat_status').on(table.status),
  idx_pmat_code: index('idx_pmat_code').on(table.code),
  idx_pmat_deleted: index('idx_pmat_deleted').on(table.isDeleted),
}));

// ==========================================
// ACCOUNTING & FINANCIAL TABLES (حسابداری و مالی)
// ==========================================

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  level: text('level').notNull(), // 'group', 'general', 'subsidiary', 'detailed'
  parentId: integer('parent_id').references((): any => accounts.id),
  accountType: text('account_type').notNull(), // 'asset', 'liability', 'equity', 'revenue', 'expense', 'cost_of_sales'
  nature: text('nature').notNull().default('debit'), // 'debit', 'credit', 'both'
  description: text('description').default(''),
  isSystem: integer('is_system').default(0),
  isActive: integer('is_active').default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_acc_code: index('idx_acc_code').on(table.code),
  idx_acc_parent: index('idx_acc_parent').on(table.parentId),
  idx_acc_level: index('idx_acc_level').on(table.level),
  idx_acc_type: index('idx_acc_type').on(table.accountType),
  idx_acc_deleted: index('idx_acc_deleted').on(table.isDeleted),
}));

export const journalVouchers = pgTable('journal_vouchers', {
  id: serial('id').primaryKey(),
  voucherNumber: integer('voucher_number').notNull(),
  manualVoucherNumber: text('manual_voucher_number').default(''),
  date: text('date').notNull(),
  voucherType: text('voucher_type').default('general'), // 'general', 'opening', 'closing', 'sales', 'purchase', 'treasury', 'payroll', 'adjustment'
  status: text('status').default('approved'), // 'draft', 'approved', 'permanent'
  totalDebit: numeric('total_debit', { precision: 18, scale: 4 }).$type<number>().notNull().default(0),
  totalCredit: numeric('total_credit', { precision: 18, scale: 4 }).$type<number>().notNull().default(0),
  description: text('description').notNull(),
  referenceModule: text('reference_module').default('manual'), // 'manual', 'invoice', 'payroll', 'cheque', 'treasury', 'inventory'
  referenceId: integer('reference_id'),
  referenceNumber: text('reference_number').default(''),
  currency: text('currency').default('IRR'),
  createdById: integer('created_by_id').references(() => users.id),
  createdByUsername: text('created_by_username').default(''),
  approvedById: integer('approved_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_jv_number: index('idx_jv_number').on(table.voucherNumber),
  idx_jv_date: index('idx_jv_date').on(table.date),
  idx_jv_status: index('idx_jv_status').on(table.status),
  idx_jv_module: index('idx_jv_module').on(table.referenceModule),
  idx_jv_deleted: index('idx_jv_deleted').on(table.isDeleted),
}));

export const journalVoucherItems = pgTable('journal_voucher_items', {
  id: serial('id').primaryKey(),
  voucherId: integer('voucher_id').notNull().references(() => journalVouchers.id),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  rowOrder: integer('row_order').default(1),
  detailedType: text('detailed_type').default('none'), // 'none', 'customer', 'personnel', 'project', 'bank_account', 'other'
  detailedId: integer('detailed_id'),
  detailedName: text('detailed_name').default(''),
  debit: numeric('debit', { precision: 18, scale: 4 }).$type<number>().notNull().default(0),
  credit: numeric('credit', { precision: 18, scale: 4 }).$type<number>().notNull().default(0),
  currency: text('currency').default('IRR'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 4 }).$type<number>().default(1),
  description: text('description').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_jvi_voucher: index('idx_jvi_voucher').on(table.voucherId),
  idx_jvi_account: index('idx_jvi_account').on(table.accountId),
  idx_jvi_detailed: index('idx_jvi_detailed').on(table.detailedType, table.detailedId),
}));

export const bankAccounts = pgTable('bank_accounts', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull().default('bank'), // 'bank', 'cash', 'pos', 'petty_cash'
  bankName: text('bank_name').default(''),
  accountNumber: text('account_number').default(''),
  shebaNumber: text('sheba_number').default(''),
  cardNumber: text('card_number').default(''),
  branch: text('branch').default(''),
  initialBalance: numeric('initial_balance', { precision: 18, scale: 4 }).$type<number>().default(0),
  currentBalance: numeric('current_balance', { precision: 18, scale: 4 }).$type<number>().default(0),
  currency: text('currency').default('IRR'),
  accountId: integer('account_id').references(() => accounts.id),
  isActive: integer('is_active').default(1),
  notes: text('notes').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_bank_code: index('idx_bank_code').on(table.code),
  idx_bank_type: index('idx_bank_type').on(table.type),
  idx_bank_deleted: index('idx_bank_deleted').on(table.isDeleted),
}));

export const cheques = pgTable('cheques', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // 'received', 'paid'
  chequeNumber: text('cheque_number').notNull(),
  sayadNumber: text('sayad_number').default(''),
  bankName: text('bank_name').notNull(),
  branch: text('branch').default(''),
  issueDate: text('issue_date').notNull(),
  dueDate: text('due_date').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).$type<number>().notNull(),
  currency: text('currency').default('IRR'),
  partyType: text('party_type').default('customer'), // 'customer', 'personnel', 'supplier', 'other'
  partyId: integer('party_id'),
  partyName: text('party_name').notNull(),
  status: text('status').default('received'), // 'received', 'in_treasury', 'in_collection', 'passed', 'bounced', 'returned', 'spent'
  drawerName: text('drawer_name').default(''),
  payeeName: text('payee_name').default(''),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  voucherId: integer('voucher_id').references(() => journalVouchers.id),
  description: text('description').default(''),
  statusHistory: jsonb('status_history').default([]),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_chq_type: index('idx_chq_type').on(table.type),
  idx_chq_due: index('idx_chq_due').on(table.dueDate),
  idx_chq_status: index('idx_chq_status').on(table.status),
  idx_chq_sayad: index('idx_chq_sayad').on(table.sayadNumber),
  idx_chq_deleted: index('idx_chq_deleted').on(table.isDeleted),
}));

export const treasuryTransactions = pgTable('treasury_transactions', {
  id: serial('id').primaryKey(),
  transactionNumber: text('transaction_number').notNull(),
  type: text('type').notNull(), // 'receipt', 'payment'
  date: text('date').notNull(),
  method: text('method').notNull(), // 'cash', 'bank_transfer', 'pos', 'cheque'
  amount: numeric('amount', { precision: 18, scale: 4 }).$type<number>().notNull(),
  currency: text('currency').default('IRR'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 4 }).$type<number>().default(1),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  partyType: text('party_type').default('customer'), // 'customer', 'personnel', 'supplier', 'other'
  partyId: integer('party_id'),
  partyName: text('party_name').notNull(),
  trackingNumber: text('tracking_number').default(''),
  voucherId: integer('voucher_id').references(() => journalVouchers.id),
  chequeId: integer('cheque_id').references(() => cheques.id),
  documentId: integer('document_id').references(() => documents.id),
  // V10-4.4: لینک رسمی تراکنش خزانه به فیش حقوقی (پرداخت حقوق فقط از این مسیر)
  payrollId: integer('payroll_id').references(() => pieceworkPayrolls.id),
  // V1.4.0: ابطال با سند معکوس (DB-009) — تراکنش معکوس به اصل اشاره می‌کند
  reversalOfId: integer('reversal_of_id'),
  description: text('description').default(''),
  status: text('status').default('completed'), // 'completed' | 'voided'
  // V1.6.0: آشتی‌سنجی بانکی (صورت‌حساب بیرونی)
  reconciled: integer('reconciled').default(0),
  reconciledAt: text('reconciled_at').default(''),
  reconciledBatch: text('reconciled_batch').default(''),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_tt_type: index('idx_tt_type').on(table.type),
  idx_tt_date: index('idx_tt_date').on(table.date),
  idx_tt_bank: index('idx_tt_bank').on(table.bankAccountId),
  idx_tt_deleted: index('idx_tt_deleted').on(table.isDeleted),
}));

export const accountingSettings = pgTable('accounting_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  accountId: integer('account_id').references(() => accounts.id),
  description: text('description').default(''),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});

// ==========================================
// WORKFLOW ENGINE TABLES (FSM & EVENT-DRIVEN)
// ==========================================

export const workflowDefinitions = pgTable('workflow_definitions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  entityType: text('entity_type').notNull(),
  version: integer('version').default(1),
  isActive: integer('is_active').default(1),
  description: text('description').default(''),
  dslJson: jsonb('dsl_json').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const workflowStates = pgTable('workflow_states', {
  id: serial('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  stateKey: text('state_key').notNull(),
  title: text('title').notNull(),
  stateType: text('state_type').default('intermediate'), // 'initial', 'intermediate', 'terminal'
  color: text('color').default('gray'),
  stepOrder: integer('step_order').default(0),
  slaHours: integer('sla_hours').default(24),
  positionX: integer('position_x').default(100),
  positionY: integer('position_y').default(100),
});

export const workflowTransitions = pgTable('workflow_transitions', {
  id: serial('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  fromStateId: integer('from_state_id').notNull().references(() => workflowStates.id),
  toStateId: integer('to_state_id').notNull().references(() => workflowStates.id),
  actionKey: text('action_key').notNull(),
  title: text('title').notNull(),
  requiredRole: text('required_role').default(''),
  requiredPermission: text('required_permission').default(''),
  approvalRuleType: text('approval_rule_type').default('SINGLE'), // 'SINGLE', 'AND_ALL', 'OR_ANY', 'K_OF_N'
  kValue: integer('k_value').default(1),
  ruleConditionsJson: jsonb('rule_conditions_json').default([]),
  autoActionKey: text('auto_action_key').default(''),
});

export const workflowInstances = pgTable('workflow_instances', {
  id: serial('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  definitionVersion: integer('definition_version').default(1),
  snapshotDsl: jsonb('snapshot_dsl').default({}),
  approvalProgressJson: jsonb('approval_progress_json').default({}),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  currentStateId: integer('current_state_id').notNull().references(() => workflowStates.id),
  status: text('status').default('IN_PROGRESS'), // 'IN_PROGRESS', 'COMPLETED', 'TERMINATED', 'REJECTED'
  startedBy: integer('started_by').references(() => users.id),
  startedByName: text('started_by_name').default(''),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});

export const workflowPendingApprovals = pgTable('workflow_pending_approvals', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  transitionId: integer('transition_id').notNull().references(() => workflowTransitions.id),
  assignedRole: text('assigned_role').default(''),
  assignedUserId: integer('assigned_user_id').references(() => users.id),
  status: text('status').default('PENDING'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const workflowHistoryLogs = pgTable('workflow_history_logs', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  fromStateId: integer('from_state_id').references(() => workflowStates.id),
  toStateId: integer('to_state_id').references(() => workflowStates.id),
  transitionId: integer('transition_id').references(() => workflowTransitions.id),
  performedBy: integer('performed_by').references(() => users.id),
  performedByName: text('performed_by_name').default(''),
  actionKey: text('action_key').notNull(),
  actionTitle: text('action_title').default(''),
  comment: text('comment').default(''),
  snapshotData: jsonb('snapshot_data').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const workflowDefinitionVersions = pgTable('workflow_definition_versions', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  description: text('description').default(''),
  dslJson: jsonb('dsl_json').default({}),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wdv_def_ver: index('idx_wdv_def_ver').on(table.definitionId, table.version)
}));

export const workflowTasks = pgTable('workflow_tasks', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  transitionId: integer('transition_id').references(() => workflowTransitions.id),
  assignedUserId: integer('assigned_user_id').references(() => users.id),
  assignedRole: text('assigned_role').default(''),
  candidateUsers: jsonb('candidate_users').default([]),
  candidateRoles: jsonb('candidate_roles').default([]),
  delegatedToUserId: integer('delegated_to_user_id').references(() => users.id),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'delegated', 'expired', 'canceled'
  title: text('title').notNull(),
  description: text('description').default(''),
  dueAt: timestamp('due_at', { mode: 'string' }),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wft_instance: index('idx_wft_instance').on(table.instanceId),
  idx_wft_assigned_user: index('idx_wft_assigned_user').on(table.assignedUserId),
  idx_wft_status: index('idx_wft_status').on(table.status)
}));

export const workflowDelegations = pgTable('workflow_delegations', {
  id: serial('id').primaryKey(),
  fromUserId: integer('from_user_id').notNull().references(() => users.id),
  toUserId: integer('to_user_id').notNull().references(() => users.id),
  scope: text('scope').notNull().default('ALL'), // 'ALL', or specific workflow code
  startDate: timestamp('start_date', { mode: 'string' }).notNull(),
  endDate: timestamp('end_date', { mode: 'string' }).notNull(),
  isActive: integer('is_active').default(1),
  reason: text('reason').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wfd_from_user: index('idx_wfd_from_user').on(table.fromUserId),
  idx_wfd_to_user: index('idx_wfd_to_user').on(table.toUserId),
  idx_wfd_active: index('idx_wfd_active').on(table.isActive)
}));

export const outboxEvents = pgTable('outbox_events', {
  id: serial('id').primaryKey(),
  eventId: text('event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  status: text('status').notNull().default('pending'), // 'pending', 'processing', 'completed', 'failed'
  payload: jsonb('payload').default({}),
  metadata: jsonb('metadata').default({}),
  retryCount: integer('retry_count').default(0),
  nextRetryAt: timestamp('next_retry_at', { mode: 'string' }),
  lastError: text('last_error').default(''),
  occurredAt: timestamp('occurred_at', { mode: 'string' }).defaultNow(),
  processedAt: timestamp('processed_at', { mode: 'string' }),
  lockedAt: timestamp('locked_at', { mode: 'string' }),
  lockedBy: text('locked_by').default('')
}, (table) => ({
  idx_outbox_status_next: index('idx_outbox_status_next').on(table.status, table.nextRetryAt),
  idx_outbox_aggregate: index('idx_outbox_aggregate').on(table.aggregateType, table.aggregateId),
  idx_outbox_status_locked: index('idx_outbox_status_locked').on(table.status, table.lockedAt)
}));

export const eventActionRules = pgTable('event_action_rules', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  eventType: text('event_type').notNull(), // Specific DomainEventType or '*'
  conditionsJson: jsonb('conditions_json').default([]), // [{ field, operator, value }]
  actionType: text('action_type').notNull(), // 'webhook', 'in_app_notification', 'workflow_trigger', 'sms_simulation', 'audit_log'
  actionConfigJson: jsonb('action_config_json').default({}),
  isActive: integer('is_active').default(1),
  executionCount: integer('execution_count').default(0),
  lastExecutedAt: timestamp('last_executed_at', { mode: 'string' }),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_action_rules_event_active: index('idx_action_rules_event_active').on(table.eventType, table.isActive)
}));

export const eventActionLogs = pgTable('event_action_logs', {
  id: serial('id').primaryKey(),
  ruleId: integer('rule_id').references(() => eventActionRules.id, { onDelete: 'cascade' }),
  ruleName: text('rule_name').default(''),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  actionType: text('action_type').notNull(),
  status: text('status').notNull(), // 'success', 'failed', 'skipped'
  result: jsonb('result').default({}),
  errorMessage: text('error_message').default(''),
  executionDurationMs: integer('execution_duration_ms').default(0),
  executedAt: timestamp('executed_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_action_logs_rule: index('idx_action_logs_rule').on(table.ruleId, table.executedAt),
  idx_action_logs_event: index('idx_action_logs_event').on(table.eventId)
}));

export const deadLetterEvents = pgTable('dead_letter_events', {
  id: serial('id').primaryKey(),
  originalEventId: text('original_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  source: text('source').notNull().default('outbox'), // 'outbox', 'action_engine', 'webhook', 'manual'
  payload: jsonb('payload').default({}),
  metadata: jsonb('metadata').default({}),
  failureReason: text('failure_reason').notNull(),
  errorStack: text('error_stack').default(''),
  retryCount: integer('retry_count').default(0),
  status: text('status').notNull().default('quarantined'), // 'quarantined', 'replayed', 'dismissed', 'resolved'
  quarantinedAt: timestamp('quarantined_at', { mode: 'string' }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
  resolvedBy: integer('resolved_by').references(() => users.id),
  resolutionNotes: text('resolution_notes').default('')
}, (table) => ({
  idx_dlq_status: index('idx_dlq_status').on(table.status),
  idx_dlq_event_type: index('idx_dlq_event_type').on(table.eventType),
  idx_dlq_aggregate: index('idx_dlq_aggregate').on(table.aggregateType, table.aggregateId)
}));

export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  targetUrl: text('target_url').notNull(),
  secretKey: text('secret_key').notNull(),
  eventPatterns: jsonb('event_patterns').default(['*']), // ['*', 'document.*', 'inventory.stock_alert']
  customHeaders: jsonb('custom_headers').default({}),
  isActive: integer('is_active').default(1),
  retryLimit: integer('retry_limit').default(3),
  timeoutMs: integer('timeout_ms').default(5000),
  totalDeliveries: integer('total_deliveries').default(0),
  successfulDeliveries: integer('successful_deliveries').default(0),
  failedDeliveries: integer('failed_deliveries').default(0),
  lastDeliveryAt: timestamp('last_delivery_at', { mode: 'string' }),
  lastStatus: text('last_status').default('idle'), // 'idle', 'success', 'failed'
  lastError: text('last_error').default(''),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_webhook_subs_active: index('idx_webhook_subs_active').on(table.isActive)
}));

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: serial('id').primaryKey(),
  subscriptionId: integer('subscription_id').notNull().references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
  subscriptionName: text('subscription_name').default(''),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  targetUrl: text('target_url').notNull(),
  statusCode: integer('status_code').default(0),
  status: text('status').notNull(), // 'success', 'failed', 'timeout'
  responseBody: text('response_body').default(''),
  errorMessage: text('error_message').default(''),
  signature: text('signature').default(''),
  attempt: integer('attempt').default(1),
  durationMs: integer('duration_ms').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_webhook_deliv_sub: index('idx_webhook_deliv_sub').on(table.subscriptionId, table.createdAt),
  idx_webhook_deliv_event: index('idx_webhook_deliv_event').on(table.eventId)
}));

export const woocommerceOrderLogs = pgTable('woocommerce_order_logs', {
  id: serial('id').primaryKey(),
  wcOrderId: text('wc_order_id').notNull().unique(),
  erpDocumentId: integer('erp_document_id'),
  status: text('status').notNull(), // 'processed', 'failed', 'already_exists'
  buyerName: text('buyer_name').default(''),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).default('0'),
  payload: jsonb('payload'),
  errorMessage: text('error_message').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wc_order_id: index('idx_wc_order_id').on(table.wcOrderId),
  idx_wc_status: index('idx_wc_status').on(table.status)
}));

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  scope: text('scope').notNull().default('global'), // 'document', 'voucher', 'treasury', 'workflow', 'inventory', 'woocommerce', 'general'
  status: text('status').notNull().default('processing'), // 'processing', 'completed', 'failed'
  requestMethod: text('request_method'),
  requestPath: text('request_path'),
  requestPayload: jsonb('request_payload'),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdById: integer('created_by_id'),
  lockedAt: timestamp('locked_at', { mode: 'string' }),
  lockedUntil: timestamp('locked_until', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  expiresAt: timestamp('expires_at', { mode: 'string' })
}, (table) => ({
  idx_idempotency_key: index('idx_idempotency_key').on(table.key),
  idx_idempotency_scope_status: index('idx_idempotency_scope_status').on(table.scope, table.status)
}));

export const projectBomAllocations = pgTable('project_bom_allocations', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  projectCode: text('project_code').notNull(),
  itemId: integer('item_id').notNull().references(() => items.id),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).$type<number>().notNull(),
  unit: text('unit').default('عدد'),
  sourceTransactionId: integer('source_transaction_id').references(() => transactions.id),
  sourceLocation: text('source_location').default('main'),
  status: text('status').notNull().default('allocated'), // 'allocated', 'consumed', 'released'
  userId: integer('user_id').references(() => users.id),
  username: text('username').default(''),
  notes: text('notes').default(''),
  allocatedAt: timestamp('allocated_at', { mode: 'string' }).defaultNow(),
  consumedAt: timestamp('consumed_at', { mode: 'string' }),
  releasedAt: timestamp('released_at', { mode: 'string' }),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_bom_alloc_proj: index('idx_bom_alloc_proj').on(table.projectId),
  idx_bom_alloc_item: index('idx_bom_alloc_item').on(table.itemId),
  idx_bom_alloc_status: index('idx_bom_alloc_status').on(table.status),
  idx_bom_alloc_src_tx: index('idx_bom_alloc_src_tx').on(table.sourceTransactionId),
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



