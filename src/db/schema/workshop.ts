import { pgTable, text, serial, numeric, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';
import { documents } from './documents';
import { productionProjects, projectStages, projectBomAllocations } from './projects';
import { personnel, pieceworkTasks, pieceworkLogs } from './personnel';

/**
 * v10.1.35 (N-01 بخش ۱، TD-1283، طرح کارتابل کارگاه): داده کارتابل کارگاه (مهاجرت 0117).
 * - مسئولان پروژه (تصمیم ت۳ الف): کاربرانی که گزارش پایان کار پرسنل همان پروژه را بررسی می‌کنند.
 * - تأیید دریافت (ت۱ الف): پاسخ «تحویل گرفتم» یا «مغایرت دارد» پرسنل به حواله یا تخصیص قطعی؛ موجودی را عوض نمی‌کند.
 * - گزارش پایان کار (ت۲ الف و ت۵ الف): تعداد نهایی یک ردیف برنامه کارگاه، که با تأیید مسئول کارکرد کارمزدی می‌سازد؛
 *   هر ردیف یک گزارش زنده (ثبت‌شده یا تأییدشده) دارد.
 */
export const projectManagers = pgTable('project_managers', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  userId: integer('user_id').notNull().references(() => users.id),
  createdById: integer('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_project_managers_project_user: uniqueIndex('uq_project_managers_project_user').on(table.projectId, table.userId),
  idx_project_managers_user: index('idx_project_managers_user').on(table.userId),
  idx_project_managers_created_by: index('idx_project_managers_created_by').on(table.createdById).where(sql`${table.createdById} IS NOT NULL`),
}));

export const stockReceiptConfirmations = pgTable('stock_receipt_confirmations', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').references(() => documents.id),
  bomAllocationId: integer('bom_allocation_id').references(() => projectBomAllocations.id),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  status: text('status').notNull(),
  note: text('note').notNull().default(''),
  confirmedById: integer('confirmed_by_id').notNull().references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  uq_stock_receipt_confirmations_document: uniqueIndex('uq_stock_receipt_confirmations_document').on(table.documentId).where(sql`${table.documentId} IS NOT NULL`),
  uq_stock_receipt_confirmations_allocation: uniqueIndex('uq_stock_receipt_confirmations_allocation').on(table.bomAllocationId).where(sql`${table.bomAllocationId} IS NOT NULL`),
  idx_stock_receipt_confirmations_personnel: index('idx_stock_receipt_confirmations_personnel').on(table.personnelId),
  idx_stock_receipt_confirmations_confirmed_by: index('idx_stock_receipt_confirmations_confirmed_by').on(table.confirmedById),
}));

export const workshopTaskReports = pgTable('workshop_task_reports', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => productionProjects.id),
  stageId: integer('stage_id').notNull().references(() => projectStages.id),
  productId: text('product_id').notNull(),
  rowId: text('row_id').notNull(),
  personnelId: integer('personnel_id').notNull().references(() => personnel.id),
  taskId: integer('task_id').references(() => pieceworkTasks.id),
  quantity: numeric('quantity', { precision: 18, scale: 4, mode: 'number' }).notNull(),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('submitted'),
  approvedQuantity: numeric('approved_quantity', { precision: 18, scale: 4, mode: 'number' }),
  reviewNote: text('review_note').notNull().default(''),
  reviewedById: integer('reviewed_by_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { mode: 'string' }),
  pieceworkLogId: integer('piecework_log_id').references(() => pieceworkLogs.id),
  createdById: integer('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
}, (table) => ({
  uq_workshop_task_reports_live_row: uniqueIndex('uq_workshop_task_reports_live_row').on(table.projectId, table.stageId, table.productId, table.rowId)
    .where(sql`${table.status} IN ('submitted', 'approved')`),
  idx_workshop_task_reports_project: index('idx_workshop_task_reports_project').on(table.projectId),
  idx_workshop_task_reports_stage: index('idx_workshop_task_reports_stage').on(table.stageId),
  idx_workshop_task_reports_personnel: index('idx_workshop_task_reports_personnel').on(table.personnelId),
  idx_workshop_task_reports_task: index('idx_workshop_task_reports_task').on(table.taskId).where(sql`${table.taskId} IS NOT NULL`),
  idx_workshop_task_reports_reviewed_by: index('idx_workshop_task_reports_reviewed_by').on(table.reviewedById).where(sql`${table.reviewedById} IS NOT NULL`),
  idx_workshop_task_reports_piecework_log: index('idx_workshop_task_reports_piecework_log').on(table.pieceworkLogId).where(sql`${table.pieceworkLogId} IS NOT NULL`),
  idx_workshop_task_reports_created_by: index('idx_workshop_task_reports_created_by').on(table.createdById),
}));
