import { sql } from 'drizzle-orm';
import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  fullName: text('full_name').notNull(),
  // v10.0.164 (TD-962، مهاجرت 0100): کد نقش با کلید خارجی به roles.code؛ فقط کاربر حذف‌شده ممکن است نقش نداشته باشد
  // (chk_users_role_active)، چون حذف نقش نقش کاربران حذف‌شده‌اش را پاک می‌کند و بازگرداندن کاربر نقش تازه می‌خواهد
  role: text('role').references((): AnyPgColumn => roles.code, { onUpdate: 'cascade' }),
  avatarUrl: text('avatar_url').default(''),
  mustResetPassword: integer('must_reset_password').default(0),
  failedLoginCount: integer('failed_login_count').default(0),
  lockedUntil: text('locked_until'),
  // v7.0.70 (TD-187): زمان آخرین ورود ناموفق برای شروع دوباره شمارش قفل کل حساب پس از ۲۴ ساعت
  lastFailedLoginAt: text('last_failed_login_at'),
  // V9-2.2: ابطال نشست با نسخه توکن و حذف نرم کاربران
  tokenVersion: integer('token_version').default(0),
  // v10.2.0 (migration 0126): NOT NULL; a NULL was live for login but not for the profile, health check or restore
  isDeleted: integer('is_deleted').default(0).notNull(),
  // v10.2 package 9 (group dashboard, migration 0128): colleagues see «برخط است» / «امروز آمده» unless turned off, and
  // the version whose «تازه‌های این نسخه» card the user closed
  isPresenceVisible: integer('is_presence_visible').notNull().default(1),
  whatsNewSeenVersion: text('whats_new_seen_version').notNull().default(''),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_users_role: index('idx_users_role').on(table.role).where(sql`${table.role} IS NOT NULL`),
  // OBS-R1-30 (ت۴۰): نام کاربری کاربران فعال بی توجه به بزرگی و کوچکی حروف یکتاست؛ ایندکس را مهاجرت 0124 فقط روی داده
  // بی تکرار می‌سازد (src/services/users/usernameUniqueness.ts)
  uq_users_username_key: uniqueIndex('uq_users_username_key').on(sql`lower(btrim(${table.username}))`).where(sql`${table.isDeleted} = 0`),
}));

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  description: text('description').default(''),
  permissions: jsonb('permissions').default([]),
  isSystem: integer('is_system').default(0)
});

export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  username: text('username').notNull(),
  userFullName: text('user_full_name').default(''),
  action: text('action').notNull(), // 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', etc.
  entity: text('entity').notNull(), // 'کالا', 'فاکتور', 'کاربر', 'نقش', 'مشتری', 'تنظیمات', etc.
  entityId: text('entity_id').default(''),
  description: text('description').notNull(),
  details: jsonb('details').default({}),
  ipAddress: text('ip_address').default(''),
  timestamp: timestamp('timestamp', { mode: 'string' }).defaultNow(),
  // v10.0.198 (TD-963): trace id of the request that wrote the row (migration 0102)
  traceId: text('trace_id').default(''),
}, (table) => ({
  idx_username: index('activity_logs_username').on(table.username),
  idx_action: index('activity_logs_action').on(table.action),
  idx_entity: index('activity_logs_entity').on(table.entity),
  idx_timestamp: index('activity_logs_timestamp').on(table.timestamp),
  idx_act_log_user: index('idx_act_log_user').on(table.userId),
  idx_trace_id: index('activity_logs_trace_id').on(table.traceId).where(sql`${table.traceId} <> ''`),
}));

export const migrationsLog = pgTable('migrations_log', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  appliedAt: timestamp('applied_at', { mode: 'string' }).defaultNow()
});

// (v4.0.29) جدول changelogs حذف شد — dual-storage زیان‌بار با منبع حقیقت واحد
// (src/data/changelogs/*.ts) جایگزین شد؛ مهاجرت 0008 جدول را از DB برمی‌دارد.

