import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';

/** In-app notifications (the bell); their own file since OBS-R2-19 (they were declared in dailyLogs.ts) */
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
  // v9.0.434 (TD-717): «حذف» در زنگ اعلان ردیف را نگه می‌دارد و فقط این زمان (UTC کارساز) را می‌نویسد؛ اعلان کنارگذاشته فهرست و شمرده نمی‌شود
  dismissedAt: timestamp('dismissed_at', { mode: 'string' }),
}, (table) => ({
  idx_notif_user: index('idx_notif_user').on(table.userId),
  idx_notif_read: index('idx_notif_read').on(table.isRead),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_notifications_sender_id: index('idx_notifications_sender_id').on(table.senderId).where(sql`${table.senderId} IS NOT NULL`),
  // v9.0.434 (TD-717): ایندکس یکتای جزئی uq_notifications_due_reminder روی (user_id, type, link) یادآوری‌های crm_due_task
  // (مهاجرت 0089، فقط روی داده بی تکرار ساخته شد؛ تکراری‌های قدیمی را بررسی سلامت مالی فهرست می‌کند)
  uq_notifications_due_reminder: uniqueIndex('uq_notifications_due_reminder').on(table.userId, table.type, table.link).where(sql`${table.type} = 'crm_due_task'`),
  // v10.1.37 (N-01، TD-1283، تصمیم ت۸ الف): هر یادآوری مهلت کار کارگاه یک بار برای هر کاربر و ردیف برنامه (مهاجرت 0119)
  uq_notifications_workshop_reminder: uniqueIndex('uq_notifications_workshop_reminder').on(table.userId, table.type, table.link)
    .where(sql`${table.type} IN ('workshop_task_due_soon', 'workshop_task_overdue')`),
}));
