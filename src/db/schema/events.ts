import { pgTable, text, serial, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './auth';

export const outboxEvents = pgTable('outbox_events', {
  id: serial('id').primaryKey(),
  eventId: text('event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  status: text('status').notNull().default('pending'),
  payload: jsonb('payload').default({}),
  metadata: jsonb('metadata').default({}),
  retryCount: integer('retry_count').default(0),
  nextRetryAt: timestamp('next_retry_at', { mode: 'string' }),
  lastError: text('last_error').default(''),
  occurredAt: timestamp('occurred_at', { mode: 'string' }).defaultNow(),
  processedAt: timestamp('processed_at', { mode: 'string' }),
  lockedAt: timestamp('locked_at', { mode: 'string' }),
  lockedBy: text('locked_by').default('')
}, (table) => ({
  idx_outbox_status_next: index('idx_outbox_status_next').on(table.status, table.nextRetryAt),
  idx_outbox_aggregate: index('idx_outbox_aggregate').on(table.aggregateType, table.aggregateId),
  idx_outbox_status_locked: index('idx_outbox_status_locked').on(table.status, table.lockedAt)
}));

export const eventActionRules = pgTable('event_action_rules', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  eventType: text('event_type').notNull(),
  conditionsJson: jsonb('conditions_json').default([]),
  actionType: text('action_type').notNull(),
  actionConfigJson: jsonb('action_config_json').default({}),
  isActive: integer('is_active').default(1),
  executionCount: integer('execution_count').default(0),
  lastExecutedAt: timestamp('last_executed_at', { mode: 'string' }),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_action_rules_event_active: index('idx_action_rules_event_active').on(table.eventType, table.isActive)
}));

export const eventActionLogs = pgTable('event_action_logs', {
  id: serial('id').primaryKey(),
  ruleId: integer('rule_id').references(() => eventActionRules.id, { onDelete: 'set null' }),
  ruleName: text('rule_name').default(''),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  actionType: text('action_type').notNull(),
  status: text('status').notNull(),
  result: jsonb('result').default({}),
  errorMessage: text('error_message').default(''),
  executionDurationMs: integer('execution_duration_ms').default(0),
  executedAt: timestamp('executed_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_action_logs_rule: index('idx_action_logs_rule').on(table.ruleId, table.executedAt),
  idx_action_logs_event: index('idx_action_logs_event').on(table.eventId)
}));

export const deadLetterEvents = pgTable('dead_letter_events', {
  id: serial('id').primaryKey(),
  originalEventId: text('original_event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  source: text('source').notNull().default('outbox'),
  payload: jsonb('payload').default({}),
  metadata: jsonb('metadata').default({}),
  failureReason: text('failure_reason').notNull(),
  errorStack: text('error_stack').default(''),
  retryCount: integer('retry_count').default(0),
  status: text('status').notNull().default('quarantined'),
  quarantinedAt: timestamp('quarantined_at', { mode: 'string' }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { mode: 'string' }),
  resolvedBy: integer('resolved_by').references(() => users.id),
  resolutionNotes: text('resolution_notes').default('')
}, (table) => ({
  idx_dlq_status: index('idx_dlq_status').on(table.status),
  idx_dlq_event_type: index('idx_dlq_event_type').on(table.eventType),
  idx_dlq_aggregate: index('idx_dlq_aggregate').on(table.aggregateType, table.aggregateId)
}));

export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  targetUrl: text('target_url').notNull(),
  secretKey: text('secret_key').notNull(),
  eventPatterns: jsonb('event_patterns').default(['*']),
  customHeaders: jsonb('custom_headers').default({}),
  isActive: integer('is_active').default(1),
  retryLimit: integer('retry_limit').default(3),
  timeoutMs: integer('timeout_ms').default(5000),
  totalDeliveries: integer('total_deliveries').default(0),
  successfulDeliveries: integer('successful_deliveries').default(0),
  failedDeliveries: integer('failed_deliveries').default(0),
  lastDeliveryAt: timestamp('last_delivery_at', { mode: 'string' }),
  lastStatus: text('last_status').default('idle'),
  lastError: text('last_error').default(''),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_webhook_subs_active: index('idx_webhook_subs_active').on(table.isActive)
}));

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: serial('id').primaryKey(),
  subscriptionId: integer('subscription_id').notNull().references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
  subscriptionName: text('subscription_name').default(''),
  eventId: text('event_id').notNull(),
  eventType: text('event_type').notNull(),
  targetUrl: text('target_url').notNull(),
  statusCode: integer('status_code').default(0),
  status: text('status').notNull(),
  responseBody: text('response_body').default(''),
  errorMessage: text('error_message').default(''),
  signature: text('signature').default(''),
  attempt: integer('attempt').default(1),
  durationMs: integer('duration_ms').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_whd_sub_status: index('idx_whd_sub_status').on(table.subscriptionId, table.status),
  idx_whd_event_id: index('idx_whd_event_id').on(table.eventId),
  idx_whd_created_at: index('idx_whd_created_at').on(table.createdAt)
}));
