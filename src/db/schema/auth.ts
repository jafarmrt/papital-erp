import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  fullName: text('full_name').notNull(),
  role: text('role').notNull(), // 'admin', 'warehouse_keeper', 'accountant', etc. or role code
  avatarUrl: text('avatar_url').default(''),
  mustResetPassword: integer('must_reset_password').default(0),
  failedLoginCount: integer('failed_login_count').default(0),
  lockedUntil: text('locked_until'),
  // V9-2.2: ابطال نشست با نسخه توکن و حذف نرم کاربران
  tokenVersion: integer('token_version').default(0),
  isDeleted: integer('is_deleted').default(0),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
});

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
  userId: integer('user_id').references(() => users.id),
  username: text('username').notNull(),
  userFullName: text('user_full_name').default(''),
  action: text('action').notNull(), // 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', etc.
  entity: text('entity').notNull(), // 'کالا', 'فاکتور', 'کاربر', 'نقش', 'مشتری', 'تنظیمات', etc.
  entityId: text('entity_id').default(''),
  description: text('description').notNull(),
  details: jsonb('details').default({}),
  ipAddress: text('ip_address').default(''),
  timestamp: timestamp('timestamp', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_username: index('activity_logs_username').on(table.username),
  idx_action: index('activity_logs_action').on(table.action),
  idx_entity: index('activity_logs_entity').on(table.entity),
  idx_timestamp: index('activity_logs_timestamp').on(table.timestamp),
  idx_act_log_user: index('idx_act_log_user').on(table.userId),
}));

export const migrationsLog = pgTable('migrations_log', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  appliedAt: timestamp('applied_at', { mode: 'string' }).defaultNow()
});

export const changelogs = pgTable('changelogs', {
  id: serial('id').primaryKey(),
  version: text('version').notNull(),
  date: timestamp('date', { withTimezone: false, mode: 'string' }).notNull(),
  features: text('features').notNull(),
  fixes: text('fixes').notNull()
});

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: serial('id').primaryKey(),
  key: text('key').notNull(),
  scope: text('scope').notNull().default('global'), // 'documents', 'treasury', 'vouchers', 'cheques', 'payroll', 'transfers', etc.
  status: text('status').notNull().default('processing'), // 'processing', 'completed', 'failed'
  requestMethod: text('request_method'),
  requestPath: text('request_path'),
  requestPayload: jsonb('request_payload'),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdById: integer('created_by_id').references(() => users.id),
  lockedAt: timestamp('locked_at', { mode: 'string' }),
  lockedUntil: timestamp('locked_until', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  expiresAt: timestamp('expires_at', { mode: 'string' })
}, (table) => ({
  idx_idempotency_key: index('idx_idempotency_key').on(table.key),
  idx_idempotency_scope_status: index('idx_idempotency_scope_status').on(table.scope, table.status),
  idx_idemp_created_by: index('idx_idemp_created_by').on(table.createdById),
  idx_idemp_user_scope_key: uniqueIndex('idx_idemp_user_scope_key').on(table.createdById, table.scope, table.key),
}));
