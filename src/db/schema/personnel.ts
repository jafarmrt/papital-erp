import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { FinancialAttachment } from '../../types';
import type { FixedSalaryMonthShare } from '../../lib/payroll/fixedSalaryProration';
import type { TaxBracket } from '../../lib/payroll/statutoryDeductions';
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
  // v10.0.199 (TD-1086، طرح حقوق §۳.۴): «آغاز همکاری» میلادی ISO؛ حقوق ثابت از این روز آغاز می‌شود (خالی = رفتار پیشین)
  startDate: text('start_date').default(''),
  // v10.0.210 (TD-1087، طرح حقوق ت۵ الف): «مشمول بیمه» و «مشمول مالیات حقوق»؛ پرسنل موجود خاموش (مهاجرت 0104)
  isInsuranceCovered: integer('is_insurance_covered').notNull().default(0),
  isTaxCovered: integer('is_tax_covered').notNull().default(0),
  // v10.1.35 (TD-1282، تصمیم ت۳۴ الف): «مشمول عیدی»؛ پرسنل موجود و تازه روشن (مهاجرت 0117)
  isEidiCovered: integer('is_eidi_covered').notNull().default(1),
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
  // را مهاجرت 0054 فقط روی داده بی کد تکراری می‌سازد (src/services/personnel/personnelCode.ts)؛ v9.0.448 (TD-613): اعلام‌شده تا اسکیما با پایگاه‌داده بخواند
  uq_personnel_code_active: uniqueIndex('uq_personnel_code_active').on(sql`lower(btrim(${table.personnelCode}))`)
    .where(sql`${table.isDeleted} = 0 AND btrim(${table.personnelCode}) <> ''`),
  idx_personnel_code: index('idx_personnel_code').on(table.personnelCode),
  idx_personnel_user: index('idx_personnel_user').on(table.userId),
  // v9.0.24 (TD-435): ایندکس یکتای جزئی uq_personnel_user_active روی user_id پرسنل فعال را مهاجرت 0053 فقط روی داده
  // بی پیوند تکراری می‌سازد (src/services/personnel/personnelUserLink.ts)؛ v9.0.448 (TD-613): اعلام‌شده تا اسکیما با پایگاه‌داده بخواند
  uq_personnel_user_active: uniqueIndex('uq_personnel_user_active').on(table.userId).where(sql`${table.isDeleted} = 0 AND ${table.userId} IS NOT NULL`),
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
  // بدون کد تکراری می‌سازد (src/services/piecework/taskCode.ts)؛ این ایندکس معمولی برای پایگاه‌داده‌ای است که ساخته نشد؛ v9.0.448 (TD-613): اعلام‌شده تا اسکیما با پایگاه‌داده بخواند
  uq_ptask_code_active: uniqueIndex('uq_ptask_code_active').on(sql`lower(btrim(${table.code}))`).where(sql`${table.isDeleted} = 0`),
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
  // v9.0.448 (TD-613): index of migration 0076, declared so the schema matches the database
  idx_ptrh_personnel: index('idx_ptrh_personnel').on(table.personnelId).where(sql`${table.personnelId} IS NOT NULL`),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_piecework_task_rate_history_changed_by_user_id: index('idx_piecework_task_rate_history_changed_by_user_id').on(table.changedByUserId).where(sql`${table.changedByUserId} IS NOT NULL`),
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
  // v9.0.448 (TD-613): built by migration 0076 only on data without duplicates; declared so the schema matches the database
  uq_piecework_personnel_rates_active: uniqueIndex('uq_piecework_personnel_rates_active').on(table.personnelId, table.taskId).where(sql`${table.isDeleted} = 0`),
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
  // v9.0.329 (TD-861، تصمیم ت۵ الف): شرح «سایر کسورات» (مهاجرت 0079)؛ کسورات بالای صفر بی شرح صادر نمی‌شود
  deductionsDescription: text('deductions_description').notNull().default(''),
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
  // v10.0.199 (TD-1085، طرح حقوق §۳.۴): فیش پیش‌پرداخت (دوره‌ای که پایانش پس از امروز است) و دلیل الزامی آن
  isPrepayment: integer('is_prepayment').notNull().default(0),
  prepaymentReason: text('prepayment_reason').notNull().default(''),
  // v10.0.210 (TD-1087، طرح حقوق §۳.۳): کسورات قانونی فیش؛ سهم کارفرما هزینه کارفرماست و از خالص کم نمی‌شود. شرح، وقتی
  // مبلغی با پیشنهاد سرور فرق دارد؛ is_statutory_split برای فیش‌های پیش از این نسخه صفر است (مهاجرت 0104)
  employeeInsurance: moneyNumeric('employee_insurance').notNull().default(sql`0`),
  employerInsurance: moneyNumeric('employer_insurance').notNull().default(sql`0`),
  incomeTax: moneyNumeric('income_tax').notNull().default(sql`0`),
  statutoryOverrideReason: text('statutory_override_reason').notNull().default(''),
  isStatutorySplit: integer('is_statutory_split').notNull().default(1),
  // v10.0.222 (TD-1089، طرح حقوق §۳.۸، ت۱۴ تا ت۱۶ الف): فیش عادی سهم عیدی خود را نگه می‌دارد (سال = سال جلالی پایان دوره)؛
  // «فیش عیدی» (is_eidi) عیدی یک سال را می‌پردازد و eidi_from_accrual بخشی است که از «عیدی پرداختنی» انباشته برداشته می‌شود
  eidiAmount: moneyNumeric('eidi_amount').notNull().default(sql`0`),
  eidiFromAccrual: moneyNumeric('eidi_from_accrual').notNull().default(sql`0`),
  eidiYear: integer('eidi_year'),
  isEidi: integer('is_eidi').notNull().default(0),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_ppay_personnel: index('idx_ppay_personnel').on(table.personnelId),
  idx_ppay_number: index('idx_ppay_number').on(table.payrollNumber),
  idx_ppay_status: index('idx_ppay_status').on(table.status),
  idx_ppay_deleted: index('idx_ppay_deleted').on(table.isDeleted),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_piecework_payrolls_created_by_id: index('idx_piecework_payrolls_created_by_id').on(table.createdById).where(sql`${table.createdById} IS NOT NULL`),
  idx_ppay_eidi_year: index('idx_ppay_eidi_year').on(table.personnelId, table.eidiYear).where(sql`${table.eidiYear} IS NOT NULL`),
}));
registerColumnRef('pieceworkPayrolls.id', () => pieceworkPayrolls.id);

/**
 * v10.0.210 (TD-1087، طرح حقوق §۳.۳ بند ۱، تصمیم ت۴ الف): نرخ‌های بیمه و مالیات حقوق هر سال جلالی که دارنده
 * `payroll.rates_manage` وارد می‌کند (مهاجرت 0104)؛ پله‌های مالیات ماهانه‌اند (`TaxBracket` در statutoryDeductions.ts).
 */
export const payrollStatutoryRates = pgTable('payroll_statutory_rates', {
  id: serial('id').primaryKey(),
  jalaliYear: integer('jalali_year').notNull(),
  employeeInsurancePercent: numeric('employee_insurance_percent', { precision: 7, scale: 4 }).notNull().default('0'),
  employerInsurancePercent: numeric('employer_insurance_percent', { precision: 7, scale: 4 }).notNull().default('0'),
  insuranceWageCap: moneyNumeric('insurance_wage_cap').notNull().default(sql`0`),
  taxBrackets: jsonb('tax_brackets').$type<TaxBracket[]>().notNull().default([]),
  isInsuranceDeductedFromTax: integer('is_insurance_deducted_from_tax').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  uq_payroll_statutory_rates_year: uniqueIndex('uq_payroll_statutory_rates_year').on(table.jalaliYear),
}));

/**
 * v10.0.222 (TD-1089، طرح حقوق §۳.۸، ت۱۴ الف): روش و نرخ عیدی هر سال جلالی (مهاجرت 0105) که دارنده `payroll.rates_manage`
 * وارد می‌کند؛ قاعده‌ها در `src/lib/payroll/eidi.ts`.
 */
export const payrollEidiRates = pgTable('payroll_eidi_rates', {
  id: serial('id').primaryKey(),
  jalaliYear: integer('jalali_year').notNull(),
  method: text('method').notNull().default('percent_of_work'),
  percent: numeric('percent', { precision: 7, scale: 4 }).notNull().default('0'),
  yearlyCap: moneyNumeric('yearly_cap').notNull().default(sql`0`),
  laborDays: numeric('labor_days', { precision: 7, scale: 2 }).notNull().default('0'),
  laborCapDays: numeric('labor_cap_days', { precision: 7, scale: 2 }).notNull().default('0'),
  minDailyWage: moneyNumeric('min_daily_wage').notNull().default(sql`0`),
  fixedAmount: moneyNumeric('fixed_amount').notNull().default(sql`0`),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  uq_payroll_eidi_rates_year: uniqueIndex('uq_payroll_eidi_rates_year').on(table.jalaliYear),
}));

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
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_piecework_logs_created_by_id: index('idx_piecework_logs_created_by_id').on(table.createdById).where(sql`${table.createdById} IS NOT NULL`),
}));
