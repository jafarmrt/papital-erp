import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { FinancialAttachment } from '../../types';
import type { FixedSalaryMonthShare } from '../../lib/payroll/fixedSalaryProration';
import { users } from './auth';
import { registerColumnRef, baseRelations } from './baseRelations';
import { moneyNumeric } from './moneyColumn';

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
  monthlySalary: moneyNumeric('monthly_salary').default(sql`0`),
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
  // v9.0.30 (TD-442، تصمیم D5 الف): نسخه قفل خوش‌بینانه ویرایش پرسنل (مهاجرت 0055)
  version: integer('version').notNull().default(1),
}, (table) => ({
  // v9.0.28 (TD-439): ایندکس یکتای جزئی uq_personnel_code_active روی lower(btrim(personnel_code)) پرسنل فعال با کد غیرخالی
  // را مهاجرت 0054 فقط روی داده بی کد تکراری می‌سازد (src/services/personnel/personnelCode.ts)
  idx_personnel_code: index('idx_personnel_code').on(table.personnelCode),
  idx_personnel_user: index('idx_personnel_user').on(table.userId),
  // v9.0.24 (TD-435): ایندکس یکتای جزئی uq_personnel_user_active روی user_id پرسنل فعال را مهاجرت 0053 فقط روی داده
  // بی پیوند تکراری می‌سازد (src/services/personnel/personnelUserLink.ts)
  idx_personnel_status: index('idx_personnel_status').on(table.employmentStatus),
  idx_personnel_deleted: index('idx_personnel_deleted').on(table.isDeleted),
}));
registerColumnRef('personnel.id', () => personnel.id);

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
  defaultRate: moneyNumeric('default_rate').default(sql`0`),
  unit: text('unit').default('عدد'),
  description: text('description').default(''),
  isActive: integer('is_active').default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  // TD-246: ایندکس یکتای جزئی uq_ptask_code_active روی lower(btrim(code)) برای عناوین فعال را مهاجرت 0037 فقط روی داده
  // بدون کد تکراری می‌سازد (src/services/piecework/taskCode.ts)؛ این ایندکس معمولی برای پایگاه‌داده‌ای است که ساخته نشد
  idx_ptask_code: index('idx_ptask_code').on(table.code),
  idx_ptask_cat: index('idx_ptask_cat').on(table.category),
  idx_ptask_deleted: index('idx_ptask_deleted').on(table.isDeleted),
}));

export const pieceworkTaskRateHistory = pgTable('piecework_task_rate_history', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => pieceworkTasks.id),
  taskCode: text('task_code').default(''),
  taskTitle: text('task_title').default(''),
  oldRate: moneyNumeric('old_rate').default(sql`0`),
  newRate: moneyNumeric('new_rate').notNull(),
  changeType: text('change_type').default('rate_change'), // 'create', 'rate_change', 'excel_import', 'title_change', 'archived', 'restored'
  reason: text('reason').default(''),
  changedByUserId: integer('changed_by_user_id').references(() => users.id),
  changedByUsername: text('changed_by_username').default(''),
  effectiveDate: text('effective_date').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  // v9.0.284 (TD-809، مهاجرت 0076): ردیف تغییر نرخ اختصاصی این پرسنل؛ تاریخچه نرخ پایه عنوان کار NULL است
  personnelId: integer('personnel_id'),
}, (table) => ({
  idx_ptrh_task: index('idx_ptrh_task').on(table.taskId),
  idx_ptrh_created: index('idx_ptrh_created').on(table.createdAt),
}));

export const pieceworkPersonnelRates = pgTable('piecework_personnel_rates', {
  id: serial('id').primaryKey(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  taskId: integer('task_id').notNull().references(() => pieceworkTasks.id),
  customRate: moneyNumeric('custom_rate').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_ppr_personnel: index('idx_ppr_personnel').on(table.personnelId),
  idx_ppr_task: index('idx_ppr_task').on(table.taskId),
}));

export const pieceworkPayrolls = pgTable('piecework_payrolls', {
  id: serial('id').primaryKey(),
  payrollNumber: text('payroll_number').notNull(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  title: text('title').notNull(),
  totalPieceworkAmount: moneyNumeric('total_piecework_amount').notNull().default(sql`0`),
  totalBonuses: moneyNumeric('total_bonuses').default(sql`0`),
  totalDeductions: moneyNumeric('total_deductions').default(sql`0`),
  netPayable: moneyNumeric('net_payable').notNull(),
  // V10-4.4: سهم حقوق ثابت در این فیش (برای salaryType = monthly_fixed / mixed)
  totalFixedAmount: moneyNumeric('total_fixed_amount').default(sql`0`),
  // V1.9.0: کسر از مساعده/وام پرسنل — در سند تسویه از حساب مساعده (1301) بستانکار می‌شود
  advanceDeduction: moneyNumeric('advance_deduction').default(sql`0`),
  // V4.0.33: مبلغ پرداخت‌شده تاکنون جهت پشتیبانی از پرداخت‌های چندمرحله‌ای (قسطی / جزئی)
  paidAmount: moneyNumeric('paid_amount').default(sql`0`),
  status: text('status').default('draft'),
  paymentDate: text('payment_date').default(''),
  paymentMethod: text('payment_method').default(''),
  paymentReference: text('payment_reference').default(''),
  notes: text('notes').default(''),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
  // v8.0.30 (TD-284): سهم حقوق ثابت به تفکیک ماه شمسی (مهاجرت 0048)؛ فیش پیشین آرایه خالی دارد
  fixedSalaryMonths: jsonb('fixed_salary_months').$type<FixedSalaryMonthShare[]>().notNull().default([]),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_ppay_personnel: index('idx_ppay_personnel').on(table.personnelId),
  idx_ppay_number: index('idx_ppay_number').on(table.payrollNumber),
  idx_ppay_status: index('idx_ppay_status').on(table.status),
  idx_ppay_deleted: index('idx_ppay_deleted').on(table.isDeleted),
}));
registerColumnRef('pieceworkPayrolls.id', () => pieceworkPayrolls.id);

export const pieceworkLogs = pgTable('piecework_logs', {
  id: serial('id').primaryKey(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  taskId: integer('task_id').notNull().references(() => pieceworkTasks.id),
  projectId: integer('project_id').references(baseRelations.productionProjectsId),
  date: text('date').notNull(),
  dateIso: text('date_iso').default(''),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unitRate: moneyNumeric('unit_rate').notNull(),
  totalAmount: moneyNumeric('total_amount').notNull(),
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
