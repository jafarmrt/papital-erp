import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './auth';

/**
 * Platform tables that belong to no business domain: request idempotency keys and form drafts. Their own file since
 * OBS-R2-19 (they were declared in auth.ts and documents.ts).
 */

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
  createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
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

export const formDrafts = pgTable('form_drafts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  username: text('username').default(''),
  sessionId: text('session_id').default(''),
  entityType: text('entity_type').notNull(), // 'invoice', 'voucher', 'document', 'project', 'cheque', 'treasury'
  draftKey: text('draft_key').default('default'), // e.g. 'new_invoice', 'voucher_create', or entityId for editing
  payload: jsonb('payload').notNull(),
  summary: text('summary').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  expiresAt: timestamp('expires_at', { mode: 'string' }),
  isDeleted: integer('is_deleted').default(0)
}, (table) => ({
  idx_form_drafts_user_entity: index('idx_form_drafts_user_entity').on(table.userId, table.entityType, table.draftKey),
  idx_form_drafts_session: index('idx_form_drafts_session').on(table.sessionId),
  idx_form_drafts_updated: index('idx_form_drafts_updated').on(table.updatedAt),
  // v10.2.31 (TD-1327, OBS-R2-98, migration 0133): one live draft per user, type and key, so a save is one upsert
  uq_form_drafts_live_user_key: uniqueIndex('uq_form_drafts_live_user_key').on(table.userId, table.entityType, table.draftKey)
    .where(sql`${table.isDeleted} = 0 AND ${table.userId} IS NOT NULL`),
}));
