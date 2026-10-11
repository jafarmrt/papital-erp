import { pgTable, text, serial, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// v9.0.51 (TD-461، B14-19، مهاجرت 0059): کلید خارجی فقط میان جدول‌های گردش کار که برنامه نگهشان می‌دارد. شناسه گام و اقدام
// در فرایند، تاریخچه، کار و تأیید در انتظار از تصویر نسخه فرایند است (ذخیره طرح ردیف‌های گام و اقدام را عوض می‌کند) و
// شناسه کاربر ممکن است به کاربر حذف‌شده برسد؛ این ستون‌ها کلید خارجی ندارند.

export const workflowDefinitions = pgTable('workflow_definitions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  entityType: text('entity_type').notNull(),
  version: integer('version').default(1),
  isActive: integer('is_active').default(1),
  description: text('description').default(''),
  dslJson: jsonb('dsl_json').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const workflowStates = pgTable('workflow_states', {
  id: serial('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  stateKey: text('state_key').notNull(),
  title: text('title').notNull(),
  stateType: text('state_type').default('intermediate'), // 'initial', 'intermediate', 'terminal'
  color: text('color').default('gray'),
  stepOrder: integer('step_order').default(0),
  slaHours: integer('sla_hours').default(24),
  positionX: integer('position_x').default(100),
  positionY: integer('position_y').default(100),
}, (table) => ({
  idx_wfs_definition: index('idx_wfs_definition').on(table.workflowDefinitionId),
}));

export const workflowTransitions = pgTable('workflow_transitions', {
  id: serial('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  fromStateId: integer('from_state_id').notNull().references(() => workflowStates.id),
  toStateId: integer('to_state_id').notNull().references(() => workflowStates.id),
  actionKey: text('action_key').notNull(),
  title: text('title').notNull(),
  requiredRole: text('required_role').default(''),
  requiredPermission: text('required_permission').default(''),
  approvalRuleType: text('approval_rule_type').default('SINGLE'), // 'SINGLE', 'AND_ALL', 'OR_ANY', 'K_OF_N'
  kValue: integer('k_value').default(1),
  ruleConditionsJson: jsonb('rule_conditions_json').default([]),
  autoActionKey: text('auto_action_key').default(''),
  // v8.0.102 (TD-392): آغازکننده فرایند این انتقال را اجرا نمی‌کند (جداسازی وظایف، تیک طراح)
  isInitiatorExcluded: integer('is_initiator_excluded').notNull().default(0),
  // v10.0.120 (TD-1220): فقط آغازکننده فرایند (یا جانشین او) این انتقال را اجرا می‌کند؛ مدیر سیستم مستثناست
  isInitiatorOnly: integer('is_initiator_only').notNull().default(0),
}, (table) => ({
  idx_wftr_definition: index('idx_wftr_definition').on(table.workflowDefinitionId),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_workflow_transitions_from_state_id: index('idx_workflow_transitions_from_state_id').on(table.fromStateId),
  idx_workflow_transitions_to_state_id: index('idx_workflow_transitions_to_state_id').on(table.toStateId),
}));

export const workflowInstances = pgTable('workflow_instances', {
  id: serial('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  definitionVersion: integer('definition_version').default(1),
  snapshotDsl: jsonb('snapshot_dsl').default({}),
  approvalProgressJson: jsonb('approval_progress_json').default({}),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  currentStateId: integer('current_state_id').notNull(),
  status: text('status').default('IN_PROGRESS'), // 'IN_PROGRESS', 'COMPLETED', 'TERMINATED', 'REJECTED'
  startedBy: integer('started_by'),
  startedByName: text('started_by_name').default(''),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_wfi_entity: index('idx_wfi_entity').on(table.entityType, table.entityId),
  // v9.0.448 (TD-613): built by migration 0056 only on data without duplicates; declared so the schema matches the database
  uq_workflow_instances_open_entity: uniqueIndex('uq_workflow_instances_open_entity').on(table.entityType, table.entityId).where(sql`${table.status} = 'IN_PROGRESS'`),
  // v9.0.449 (TD-614): an index leading with each foreign key column (migration 0094)
  idx_workflow_instances_workflow_definition_id: index('idx_workflow_instances_workflow_definition_id').on(table.workflowDefinitionId),
}));

export const workflowPendingApprovals = pgTable('workflow_pending_approvals', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  transitionId: integer('transition_id').notNull(),
  assignedRole: text('assigned_role').default(''),
  assignedUserId: integer('assigned_user_id'),
  status: text('status').default('PENDING'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_wfpa_instance: index('idx_wfpa_instance').on(table.instanceId),
}));

export const workflowHistoryLogs = pgTable('workflow_history_logs', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  fromStateId: integer('from_state_id'),
  toStateId: integer('to_state_id'),
  transitionId: integer('transition_id'),
  performedBy: integer('performed_by'),
  performedByName: text('performed_by_name').default(''),
  actionKey: text('action_key').notNull(),
  actionTitle: text('action_title').default(''),
  comment: text('comment').default(''),
  snapshotData: jsonb('snapshot_data').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_wfh_instance: index('idx_wfh_instance').on(table.instanceId),
}));

export const workflowDefinitionVersions = pgTable('workflow_definition_versions', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  description: text('description').default(''),
  dslJson: jsonb('dsl_json').default({}),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wdv_def_ver: index('idx_wdv_def_ver').on(table.definitionId, table.version),
  uq_wdv_definition_version: uniqueIndex('uq_wdv_definition_version').on(table.definitionId, table.version),
}));

export const workflowTasks = pgTable('workflow_tasks', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  transitionId: integer('transition_id'),
  assignedUserId: integer('assigned_user_id'),
  assignedRole: text('assigned_role').default(''),
  candidateUsers: jsonb('candidate_users').default([]),
  candidateRoles: jsonb('candidate_roles').default([]),
  delegatedToUserId: integer('delegated_to_user_id'),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'delegated', 'canceled' ('expired' only on pre-v7.0.101 rows)
  title: text('title').notNull(),
  description: text('description').default(''),
  dueAt: timestamp('due_at', { mode: 'string' }),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  // v7.0.101 (TD-085 بند ۴): زمان ارسال یادآوری یک‌باره مهلت به مسئول کار (migration 0032)
  slaRemindedAt: timestamp('sla_reminded_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wft_instance: index('idx_wft_instance').on(table.instanceId),
  idx_wft_assigned_user: index('idx_wft_assigned_user').on(table.assignedUserId),
  idx_wft_status: index('idx_wft_status').on(table.status),
  // v9.0.448 (TD-613): index of migration 0032, declared so the schema matches the database
  idx_wft_sla_due: index('idx_wft_sla_due').on(table.dueAt).where(sql`${table.status} = 'pending' AND ${table.slaRemindedAt} IS NULL`),
}));

// v7.0.101 (TD-085، تصمیم مالک محصول «بازگشایی با گزارش»): کارهای منقضی‌شده خودکار پیش از این نسخه و سرنوشت هرکدام (migration 0032)
export const workflowTaskReopenLog = pgTable('workflow_task_reopen_log', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull(),
  instanceId: integer('instance_id').notNull(),
  taskTitle: text('task_title').notNull().default(''),
  dueAt: timestamp('due_at', { mode: 'string' }),
  action: text('action').notNull(), // 'reopened' | 'kept_expired'
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const workflowDelegations = pgTable('workflow_delegations', {
  id: serial('id').primaryKey(),
  fromUserId: integer('from_user_id').notNull(),
  toUserId: integer('to_user_id').notNull(),
  scope: text('scope').notNull().default('ALL'), // 'ALL', or specific workflow code
  startDate: timestamp('start_date', { mode: 'string' }).notNull(),
  endDate: timestamp('end_date', { mode: 'string' }).notNull(),
  isActive: integer('is_active').default(1),
  reason: text('reason').default(''),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wfd_from_user: index('idx_wfd_from_user').on(table.fromUserId),
  idx_wfd_to_user: index('idx_wfd_to_user').on(table.toUserId),
  idx_wfd_active: index('idx_wfd_active').on(table.isActive)
}));
