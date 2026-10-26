import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
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
  // v10.2 package 9 (group dashboard, migration 0130): colleagues see «برخط است» / «امروز آمده» unless turned off, and
  // the version whose «تازه‌های این نسخه» card the user closed
  isPresenceVisible: integer('is_presence_visible').notNull().default(1),
  whatsNewSeenVersion: text('whats_new_seen_version').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow()
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

/**
 * OBS-R1-32 (TD-1324): the text the activity log search compares, description, user full name, username and entity
 * joined by the unit separator (chr 31) so a match never spans two columns. The GIN trigram index of migration 0132 is
 * built on exactly this expression, so the query must use this function, never its own spelling.
 */
export function activityLogSearchText(table: { description: AnyColumn; userFullName: AnyColumn; username: AnyColumn; entity: AnyColumn }): SQL {
  const sep = sql.raw(`E'\\x1f'`);
  return sql`coalesce(${table.description}, '') || ${sep} || coalesce(${table.userFullName}, '') || ${sep} || coalesce(${table.username}, '') || ${sep} || coalesce(${table.entity}, '')`;
}

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
  timestamp: timestamp('timestamp', { withTimezone: true, mode: 'string' }).defaultNow(),
  // v10.0.198 (TD-963): trace id of the request that wrote the row (migration 0102)
  traceId: text('trace_id').default(''),
}, (table) => ({
  idx_username: index('activity_logs_username').on(table.username),
  idx_action: index('activity_logs_action').on(table.action),
  idx_entity: index('activity_logs_entity').on(table.entity),
  idx_timestamp: index('activity_logs_timestamp').on(table.timestamp),
  idx_act_log_user: index('idx_act_log_user').on(table.userId),
  idx_trace_id: index('activity_logs_trace_id').on(table.traceId).where(sql`${table.traceId} <> ''`),
  // OBS-R1-32 (TD-1324, migration 0132): the text search's own expression, a GIN trigram index
  idx_search_trgm: index('activity_logs_search_trgm').using('gin', sql`(${activityLogSearchText(table)}) gin_trgm_ops`),
}));

export const migrationsLog = pgTable('migrations_log', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'string' }).defaultNow()
});

// (v4.0.29) جدول changelogs حذف شد — dual-storage زیان‌بار با منبع حقیقت واحد
// (src/data/changelogs/*.ts) جایگزین شد؛ مهاجرت 0008 جدول را از DB برمی‌دارد.


/**
 * 10.2 package 8 (D-07, migration 0129): one row per signed-in device. The session token carries `sid`; a token whose
 * row is closed (`revokedAt`), expired or written under an earlier `users.token_version` is refused on its next
 * request. Rows are never deleted: «خروج» and «بستن» close them.
 */
export const userSessions = pgTable('user_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sid: text('sid').notNull(),
  tokenVersion: integer('token_version').notNull().default(0),
  userAgent: text('user_agent').notNull().default(''),
  ipAddress: text('ip_address').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  revokeReason: text('revoke_reason').notNull().default(''), // '' | 'logout' | 'closed_by_user' | 'closed_by_admin' | 'others_closed'
}, (table) => ({
  uq_user_sessions_sid: uniqueIndex('uq_user_sessions_sid').on(table.sid),
  idx_user_sessions_user_id: index('idx_user_sessions_user_id').on(table.userId, table.id),
}));
