import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';
import { baseRelations } from './baseRelations';

export const dailyWorkLogs = pgTable('daily_work_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  username: text('username').notNull(),
  userFullName: text('user_full_name').default(''),
  date: text('date').notNull(),
  dateIso: text('date_iso').default(''),
  startTime: text('start_time').default('08:00'),
  endTime: text('end_time').default('17:00'),
  workHours: numeric('work_hours', { precision: 18, scale: 4, mode: 'number' }).default(8),
  workMode: text('work_mode').default('onsite'), // 'onsite', 'remote', 'hybrid'
  title: text('title').notNull(),
  content: text('content').notNull(),
  projectId: integer('project_id').references(baseRelations.productionProjectsId),
  projectName: text('project_name').default(''),
  tags: jsonb('tags').default([]),
  mentions: jsonb('mentions').default([]), // array of user IDs
  // v9.0.236 (TD-900): 'mentioned_only' | 'private' | 'managers' | 'custom' (chk_daily_work_logs_visibility); no public logs
  visibility: text('visibility').notNull().default('mentioned_only'),
  allowedUsers: jsonb('allowed_users').default([]),
  status: text('status').default('submitted'), // 'submitted', 'reviewed'
  managerNotes: text('manager_notes').default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  isDeleted: integer('is_deleted').default(0),
  // v10.2.32 (TD-1327, OBS-R2-58, migration 0133): an edit sends the version it was built from (409 OCC_CONFLICT when stale)
  version: integer('version').notNull().default(1),
}, (table) => ({
  idx_dwl_user: index('idx_dwl_user').on(table.userId),
  idx_dwl_date: index('idx_dwl_date').on(table.date),
  idx_dwl_date_iso: index('idx_dwl_date_iso').on(table.dateIso),
  idx_dwl_vis: index('idx_dwl_vis').on(table.visibility),
  idx_dwl_deleted: index('idx_dwl_deleted').on(table.isDeleted),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_daily_work_logs_project_id: index('idx_daily_work_logs_project_id').on(table.projectId).where(sql`${table.projectId} IS NOT NULL`),
}));

/** v9.0.236 (TD-900, migration 0075): the old visibility of each log the removal of «public» moved to mentioned_only */
export const dailyLogVisibilityRepairs = pgTable('daily_log_visibility_repairs', {
  id: serial('id').primaryKey(),
  dailyLogId: integer('daily_log_id').notNull().unique('uq_daily_log_visibility_repairs_log'),
  oldVisibility: text('old_visibility'),
  newVisibility: text('new_visibility').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

