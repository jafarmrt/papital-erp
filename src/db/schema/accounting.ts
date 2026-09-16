import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FinancialAttachment } from '../../types';
import { users } from './auth';
import { documents } from './documents';
import { pieceworkPayrolls } from './personnel';

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
  totalDebit: numeric('total_debit', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  totalCredit: numeric('total_credit', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  description: text('description').notNull(),
  referenceModule: text('reference_module').default('manual'), // 'manual', 'invoice', 'payroll', 'cheque', 'treasury', 'inventory'
  referenceId: integer('reference_id'),
  referenceNumber: text('reference_number').default(''),
  currency: text('currency').default('IRR'),
  attachments: jsonb('attachments').$type<FinancialAttachment[]>().default([]),
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
  debit: numeric('debit', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  credit: numeric('credit', { precision: 18, scale: 4, mode: 'number' }).notNull().default(0),
  currency: text('currency').default('IRR'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 4, mode: 'number' }).default(1),
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
  initialBalance: numeric('initial_balance', { precision: 18, scale: 4, mode: 'number' }).default(0),
  currentBalance: numeric('current_balance', { precision: 18, scale: 4, mode: 'number' }).default(0),
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
  amount: numeric('amount', { precision: 18, scale: 4, mode: 'number' }).notNull(),
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
}));

export const treasuryTransactions = pgTable('treasury_transactions', {
  id: serial('id').primaryKey(),
  transactionNumber: text('transaction_number').notNull(),
  type: text('type').notNull(), // 'receipt', 'payment'
  date: text('date').notNull(),
  method: text('method').notNull(), // 'cash', 'bank_transfer', 'pos', 'cheque'
  amount: numeric('amount', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  currency: text('currency').default('IRR'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 4, mode: 'number' }).default(1),
  bankAccountId: integer('bank_account_id').references(() => bankAccounts.id),
  partyType: text('party_type').default('customer'), // 'customer', 'personnel', 'supplier', 'other'
  partyId: integer('party_id'),
  partyName: text('party_name').notNull(),
  trackingNumber: text('tracking_number').default(''),
  voucherId: integer('voucher_id').references(() => journalVouchers.id),
  chequeId: integer('cheque_id').references(() => cheques.id),
  documentId: integer('document_id').references((): AnyPgColumn => documents.id),
  // V10-4.4: لینک رسمی تراکنش خزانه به فیش حقوقی (پرداخت حقوق فقط از این مسیر)
  payrollId: integer('payroll_id').references((): AnyPgColumn => pieceworkPayrolls.id),
  // V1.4.0: ابطال با سند معکوس (DB-009) — تراکنش معکوس به اصل اشاره می‌کند
  reversalOfId: integer('reversal_of_id'),
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
}));

export const accountingSettings = pgTable('accounting_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  accountId: integer('account_id').references(() => accounts.id),
  description: text('description').default(''),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});
