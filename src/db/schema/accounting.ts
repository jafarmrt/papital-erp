import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { FinancialAttachment } from '../../types';
import { users } from './auth';
import { baseRelations, registerColumnRef } from './baseRelations';
import { moneyNumeric } from './moneyColumn';

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
  // v9.0.448 (TD-613): built by migration 0012 only on data without duplicates; declared so the schema matches the database
  uq_accounts_code_active: uniqueIndex('uq_accounts_code_active').on(table.code).where(sql`${table.isDeleted} = 0`),
}));

export const journalVouchers = pgTable('journal_vouchers', {
  id: serial('id').primaryKey(),
  voucherNumber: integer('voucher_number').notNull(),
  manualVoucherNumber: text('manual_voucher_number').default(''),
  date: text('date').notNull(),
  voucherType: text('voucher_type').default('general'), // 'general', 'opening', 'closing', 'sales', 'purchase', 'treasury', 'payroll', 'adjustment'
  status: text('status').default('approved'), // 'draft', 'approved', 'permanent'
  totalDebit: moneyNumeric('total_debit').notNull().default(sql`0`),
  totalCredit: moneyNumeric('total_credit').notNull().default(sql`0`),
  description: text('description').notNull(),
  referenceModule: text('reference_module').default('manual'), // 'manual', 'invoice', 'payroll', 'cheque', 'treasury', 'inventory'
  referenceId: integer('reference_id'),
  referenceNumber: text('reference_number').default(''),
  // v7.0.31 (TD-193 / audit P1-8): سند انبار/فاکتوری که VoucherSync این سند حسابداری را برایش صادر کرده است.
  // reference_id در اسناد معکوس/اصلاحی شناسه «سند حسابداری مبدأ» است، پس برای یافتن سند یک فاکتور فقط
  // از این ستون استفاده شود. ایندکس یکتای جزئی uq_jv_source_document_active (مهاجرت 0017).
  sourceDocumentId: integer('source_document_id').references(baseRelations.documentsId, { onDelete: 'set null' }),
  // TD-242: فیش حقوقی‌ای که VoucherSync این سند حسابداری را برایش صادر کرده است (همان الگوی source_document_id)؛
  // سند معکوس/اصلاحی فیش reference_id = شناسه «سند حسابداری مبدأ» دارد، پس سند یک فیش فقط از این ستون یافته شود.
  // ایندکس یکتای جزئی uq_jv_source_payroll_active (مهاجرت 0035).
  sourcePayrollId: integer('source_payroll_id').references(baseRelations.pieceworkPayrollsId, { onDelete: 'set null' }),
  // v8.0.19 (TD-271): چکی که این سند حسابداری در چرخه عمر آن صادر شده است (ثبت، در جریان وصول، وصول، برگشت، خرج).
  // پیش‌تر اسناد چک فقط با شماره چک (reference_number) پیدا می‌شدند و شماره چک یکتا نیست. مهاجرت 0047.
  sourceChequeId: integer('source_cheque_id').references(baseRelations.chequesId, { onDelete: 'set null' }),
  // v8.0.34 (TD-286): سند تخصیص مواد BOM پروژه (مهاجرت 0049)
  sourceBomAllocationId: integer('source_bom_allocation_id').references(baseRelations.projectBomAllocationsId, { onDelete: 'set null' }),
  // v9.0.159 (TD-545، B03-03، ت۳): سال مالی‌ای که «بستن سال مالی» این سند اختتامیه یا افتتاحیه را برایش صادر کرده است
  // (مهاجرت 0069). سند اختتامیه فقط با همین پیوند شناخته می‌شود، نه با نوع `closing` یا شماره مرجع؛ سند برگشت آن در
  // بازگشایی سال همان پیوند و نوع را دارد. کلید خارجی ندارد: شماره سال است و ردیف سال پیش از بستن ساخته شده است.
  sourceFiscalYear: integer('source_fiscal_year'),
  currency: text('currency').default('IRR'),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
  createdById: integer('created_by_id').references(() => users.id),
  createdByUsername: text('created_by_username').default(''),
  approvedById: integer('approved_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  version: integer('version').notNull().default(1),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  uq_jv_source_document_active: uniqueIndex('uq_jv_source_document_active')
    .on(table.sourceDocumentId)
    .where(sql`${table.isDeleted} = 0 AND ${table.sourceDocumentId} IS NOT NULL`),
  uq_jv_source_payroll_active: uniqueIndex('uq_jv_source_payroll_active')
    .on(table.sourcePayrollId)
    .where(sql`${table.isDeleted} = 0 AND ${table.sourcePayrollId} IS NOT NULL`),
  idx_jv_reference: index('idx_jv_reference').on(table.referenceModule, table.referenceId),
  // v8.0.19 (TD-271): مهاجرت 0047
  idx_jv_source_cheque: index('idx_jv_source_cheque').on(table.sourceChequeId).where(sql`${table.sourceChequeId} IS NOT NULL`),
  idx_jv_source_bom_allocation: index('idx_jv_source_bom_allocation').on(table.sourceBomAllocationId).where(sql`${table.sourceBomAllocationId} IS NOT NULL`),
  idx_jv_source_fiscal_year: index('idx_jv_source_fiscal_year').on(table.sourceFiscalYear).where(sql`${table.sourceFiscalYear} IS NOT NULL`),
  // v7.0.91 (TD-195): ایندکس یکتای uq_jv_voucher_number را مهاجرت 0031 فقط روی داده بدون شماره تکراری می‌سازد
  // (voucherNumberIntegrity.ts)؛ این ایندکس معمولی برای پایگاه‌داده‌ای است که ایندکس یکتا ساخته نشد
  idx_jv_number: index('idx_jv_number').on(table.voucherNumber),
  // v9.0.448 (TD-613): built by migration 0031 only on data without duplicates; declared so the schema matches the database
  uq_jv_voucher_number: uniqueIndex('uq_jv_voucher_number').on(table.voucherNumber),
  idx_jv_date: index('idx_jv_date').on(table.date),
  idx_jv_status: index('idx_jv_status').on(table.status),
  idx_jv_module: index('idx_jv_module').on(table.referenceModule),
  idx_jv_deleted: index('idx_jv_deleted').on(table.isDeleted),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_journal_vouchers_approved_by_id: index('idx_journal_vouchers_approved_by_id').on(table.approvedById).where(sql`${table.approvedById} IS NOT NULL`),
  idx_journal_vouchers_created_by_id: index('idx_journal_vouchers_created_by_id').on(table.createdById).where(sql`${table.createdById} IS NOT NULL`),
  idx_journal_vouchers_source_document_id: index('idx_journal_vouchers_source_document_id').on(table.sourceDocumentId).where(sql`${table.sourceDocumentId} IS NOT NULL`),
  idx_journal_vouchers_source_payroll_id: index('idx_journal_vouchers_source_payroll_id').on(table.sourcePayrollId).where(sql`${table.sourcePayrollId} IS NOT NULL`),
}));

/**
 * v7.0.49 (audit P2-5): وضعیت هر سال مالی (سال جلالی). بسته‌بودن سال دیگر از متن شماره مرجع سند اختتامیه
 * (LIKE '%CLOSING-…%') استنباط نمی‌شود؛ ثبت هر سند حسابداری ردیف سال خود را FOR SHARE و بستن سال آن را
 * FOR UPDATE قفل می‌کند تا هیچ سندی همزمان با بستن سال وارد آن نشود.
 */
export const fiscalPeriods = pgTable('fiscal_periods', {
  fiscalYear: integer('fiscal_year').primaryKey(),
  status: text('status').notNull().default('open'), // 'open' | 'closed'
  closedAt: timestamp('closed_at', { mode: 'string' }),
  closedBy: text('closed_by'),
  closingVoucherId: integer('closing_voucher_id').references(() => journalVouchers.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_fiscal_periods_closing_voucher_id: index('idx_fiscal_periods_closing_voucher_id').on(table.closingVoucherId).where(sql`${table.closingVoucherId} IS NOT NULL`),
}));

/**
 * v7.0.82 (TD-231): پشتیبان و گزارش اصلاح تاریخ‌های قدیمی «07-10-1405 AP» (مهاجرت 0030)؛ مقدار قبلی و جدید هر ردیف
 * پیش از تغییر ثبت می‌شود و بازرس سلامت مالی آن را نشان می‌دهد. status: 'corrected' | 'refused' (سند سال مالی بسته)
 */
export const legacyDateRepairs = pgTable('legacy_date_repairs', {
  id: serial('id').primaryKey(),
  tableName: text('table_name').notNull(),
  rowId: integer('row_id').notNull(),
  columnName: text('column_name').notNull(),
  oldValue: text('old_value').notNull(),
  newValue: text('new_value').notNull(),
  status: text('status').notNull(),
  reason: text('reason'),
  // v7.0.131 (TD-232, مهاجرت 0038): 'mdy' اصلاح «07-10-1405 AP» (TD-231)؛ 'calendar' یکسان‌سازی تاریخ متنی به ISO میلادی
  repairKind: text('repair_kind').notNull().default('mdy'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const journalVoucherItems = pgTable('journal_voucher_items', {
  id: serial('id').primaryKey(),
  voucherId: integer('voucher_id').notNull().references(() => journalVouchers.id),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  rowOrder: integer('row_order').default(1),
  detailedType: text('detailed_type').default('none'), // 'none', 'customer', 'personnel', 'project', 'bank_account', 'other'
  detailedId: integer('detailed_id'),
  detailedName: text('detailed_name').default(''),
  debit: moneyNumeric('debit').notNull().default(sql`0`),
  credit: moneyNumeric('credit').notNull().default(sql`0`),
  currency: text('currency').default('IRR'),
  exchangeRate: moneyNumeric('exchange_rate').default(sql`1`),
  description: text('description').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
}, (table) => ({
  idx_jvi_voucher: index('idx_jvi_voucher').on(table.voucherId),
  idx_jvi_account: index('idx_jvi_account').on(table.accountId),
  idx_jvi_detailed: index('idx_jvi_detailed').on(table.detailedType, table.detailedId),
  idx_jvi_deleted: index('idx_jvi_deleted').on(table.isDeleted),
}));

/**
 * v9.0.206 (TD-663، B05-17، تصمیم ت۱۰ بند ۳): کالاهای هر سند افتتاحیه موجودی و سهم هر کالا (مهاجرت 0074). سند افتتاحیه
 * یک کالا (فرم کالا، گردش کار) یک ردیف دارد و سند ورود اکسل یک ردیف برای هر کالای تازه آن فایل؛ سندهای پیشین با
 * `reference_id` = کالا در مهاجرت پر شدند. «سند افتتاحیه این کالا» فقط از همین جدول خوانده می‌شود.
 */
export const itemOpeningVoucherItems = pgTable('item_opening_voucher_items', {
  voucherId: integer('voucher_id').notNull().references(() => journalVouchers.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(baseRelations.itemsId, { onDelete: 'cascade' }),
  amount: moneyNumeric('amount').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.voucherId, table.itemId] }),
  idx_iovi_item: index('idx_iovi_item').on(table.itemId),
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
  initialBalance: moneyNumeric('initial_balance').default(sql`0`),
  currentBalance: moneyNumeric('current_balance').default(sql`0`),
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
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_bank_accounts_account_id: index('idx_bank_accounts_account_id').on(table.accountId).where(sql`${table.accountId} IS NOT NULL`),
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
  amount: moneyNumeric('amount').notNull(),
  currency: text('currency').default('IRR'),
  partyType: text('party_type').default('customer'), // 'customer', 'personnel', 'supplier', 'other'
  partyId: integer('party_id'),
  partyName: text('party_name').notNull(),
  // v9.0.84 (TD-497، ت۲ الف): هدف چک پرسنل و سرفصل طرف حسابی که سند ثبت چک با آن صادر شد (مهاجرت 0061)؛ برگشت و عودت
  // همین سرفصل را می‌گیرند. چک‌های پیشین NULL دارند و قاعده پیشین را ادامه می‌دهند.
  purpose: text('purpose'),
  partyAccountId: integer('party_account_id').references(() => accounts.id),
  status: text('status').default('received'), // 'received', 'in_treasury', 'in_collection', 'passed', 'bounced', 'returned', 'spent'
  drawerName: text('drawer_name').default(''),
  payeeName: text('payee_name').default(''),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  voucherId: integer('voucher_id').references(() => journalVouchers.id),
  description: text('description').default(''),
  statusHistory: jsonb('status_history').default([]),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
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
  // v9.0.448 (TD-613): built by migration 0012 only on data without duplicates; declared so the schema matches the database
  uq_cheques_sayad_number_active: uniqueIndex('uq_cheques_sayad_number_active').on(table.sayadNumber)
    .where(sql`${table.isDeleted} = 0 AND ${table.sayadNumber} IS NOT NULL AND ${table.sayadNumber} <> ''`),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_cheques_bank_account_id: index('idx_cheques_bank_account_id').on(table.bankAccountId).where(sql`${table.bankAccountId} IS NOT NULL`),
  idx_cheques_created_by_id: index('idx_cheques_created_by_id').on(table.createdById).where(sql`${table.createdById} IS NOT NULL`),
  idx_cheques_party_account_id: index('idx_cheques_party_account_id').on(table.partyAccountId).where(sql`${table.partyAccountId} IS NOT NULL`),
  idx_cheques_voucher_id: index('idx_cheques_voucher_id').on(table.voucherId).where(sql`${table.voucherId} IS NOT NULL`),
}));
registerColumnRef('cheques.id', () => cheques.id);


export const treasuryTransactions = pgTable('treasury_transactions', {
  id: serial('id').primaryKey(),
  transactionNumber: text('transaction_number').notNull(),
  type: text('type').notNull(), // 'receipt', 'payment'
  date: text('date').notNull(),
  method: text('method').notNull(), // 'cash', 'bank_transfer', 'pos', 'cheque'
  amount: moneyNumeric('amount').notNull(),
  currency: text('currency').default('IRR'),
  exchangeRate: moneyNumeric('exchange_rate').default(sql`1`),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  partyType: text('party_type').default('customer'), // 'customer', 'personnel', 'supplier', 'other'
  partyId: integer('party_id'),
  partyName: text('party_name').notNull(),
  trackingNumber: text('tracking_number').default(''),
  voucherId: integer('voucher_id').references(() => journalVouchers.id),
  chequeId: integer('cheque_id').references(() => cheques.id),
  documentId: integer('document_id').references(baseRelations.documentsId),
  // V10-4.4 / TD-169: لینک رسمی تراکنش خزانه به فیش حقوقی (پرداخت حقوق فقط از این مسیر)
  payrollId: integer('payroll_id').references(baseRelations.pieceworkPayrollsId),
  // V1.4.0: ابطال با سند معکوس (DB-009) — تراکنش معکوس به اصل اشاره می‌کند
  reversalOfId: integer('reversal_of_id'),
  // v9.0.82 (TD-507، ت۴ الف): هدف دریافت و پرداخت پرسنل ('settlement' | 'advance' | 'other'، مهاجرت 0060) و سرفصل طرف
  // مقابلی که کاربر برای «متفرقه» و «سایر» انتخاب کرده است
  purpose: text('purpose'),
  contraAccountId: integer('contra_account_id').references(() => accounts.id),
  description: text('description').default(''),
  status: text('status').default('completed'), // 'completed' | 'voided'
  // V1.6.0: آشتی‌سنجی بانکی (صورت‌حساب بیرونی)
  reconciled: integer('reconciled').default(0),
  reconciledAt: text('reconciled_at').default(''),
  reconciledBatch: text('reconciled_batch').default(''),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
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
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_treasury_transactions_cheque_id: index('idx_treasury_transactions_cheque_id').on(table.chequeId).where(sql`${table.chequeId} IS NOT NULL`),
  idx_treasury_transactions_contra_account_id: index('idx_treasury_transactions_contra_account_id').on(table.contraAccountId).where(sql`${table.contraAccountId} IS NOT NULL`),
  idx_treasury_transactions_created_by_id: index('idx_treasury_transactions_created_by_id').on(table.createdById).where(sql`${table.createdById} IS NOT NULL`),
  idx_treasury_transactions_document_id: index('idx_treasury_transactions_document_id').on(table.documentId).where(sql`${table.documentId} IS NOT NULL`),
  idx_treasury_transactions_payroll_id: index('idx_treasury_transactions_payroll_id').on(table.payrollId).where(sql`${table.payrollId} IS NOT NULL`),
  idx_treasury_transactions_voucher_id: index('idx_treasury_transactions_voucher_id').on(table.voucherId).where(sql`${table.voucherId} IS NOT NULL`),
}));

export const accountingSettings = pgTable('accounting_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  accountId: integer('account_id').references(() => accounts.id),
  description: text('description').default(''),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_accounting_settings_account_id: index('idx_accounting_settings_account_id').on(table.accountId).where(sql`${table.accountId} IS NOT NULL`),
}));
