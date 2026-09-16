import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { productionProjects } from './projects';

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
  projectId: integer('project_id').references((): AnyPgColumn => productionProjects.id),
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
