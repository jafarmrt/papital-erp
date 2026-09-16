import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FinancialAttachment } from '../../types';
import { users } from './auth';
import { productionProjects } from './projects';

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
  monthlySalary: numeric('monthly_salary', { precision: 18, scale: 4, mode: 'number' }).default(0),
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
  defaultRate: numeric('default_rate', { precision: 18, scale: 4, mode: 'number' }).default(0),
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
  oldRate: numeric('old_rate', { precision: 18, scale: 4, mode: 'number' }).default(0),
  newRate: numeric('new_rate', { precision: 18, scale: 4, mode: 'number' }).notNull(),
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
  customRate: numeric('custom_rate', { precision: 18, scale: 4, mode: 'number' }).notNull(),
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
  totalPieceworkAmount: numeric('total_piecework_amount', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  totalBonuses: numeric('total_bonuses', { precision: 18, scale: 4, mode: 'number' }).default(0),
  totalDeductions: numeric('total_deductions', { precision: 18, scale: 4, mode: 'number' }).default(0),
  netPayable: numeric('net_payable', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  // V10-4.4: سهم حقوق ثابت در این فیش (برای salaryType = monthly_fixed / mixed)
  totalFixedAmount: numeric('total_fixed_amount', { precision: 18, scale: 4, mode: 'number' }).default(0),
  // V1.9.0: کسر از مساعده/وام پرسنل — در سند تسویه از حساب مساعده (1301) بستانکار می‌شود
  advanceDeduction: numeric('advance_deduction', { precision: 18, scale: 4, mode: 'number' }).default(0),
  status: text('status').default('draft'),
  paymentDate: text('payment_date').default(''),
  paymentMethod: text('payment_method').default(''),
  paymentReference: text('payment_reference').default(''),
  notes: text('notes').default(''),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_ppay_personnel: index('idx_ppay_personnel').on(table.personnelId),
  idx_ppay_number: index('idx_ppay_number').on(table.payrollNumber),
  idx_ppay_status: index('idx_ppay_status').on(table.status),
  idx_ppay_deleted: index('idx_ppay_deleted').on(table.isDeleted),
}));

export const pieceworkLogs = pgTable('piecework_logs', {
  id: serial('id').primaryKey(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  taskId: integer('task_id').notNull().references(() => pieceworkTasks.id),
  projectId: integer('project_id').references((): AnyPgColumn => productionProjects.id),
  date: text('date').notNull(),
  dateIso: text('date_iso').default(''),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  unitRate: numeric('unit_rate', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4, mode: 'number' }).notNull(),
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
