import { pgTable, text, serial, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './auth';

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
});

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
});

export const workflowInstances = pgTable('workflow_instances', {
  id: serial('id').primaryKey(),
  workflowDefinitionId: integer('workflow_definition_id').notNull().references(() => workflowDefinitions.id),
  definitionVersion: integer('definition_version').default(1),
  snapshotDsl: jsonb('snapshot_dsl').default({}),
  approvalProgressJson: jsonb('approval_progress_json').default({}),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  currentStateId: integer('current_state_id').notNull().references(() => workflowStates.id),
  status: text('status').default('IN_PROGRESS'), // 'IN_PROGRESS', 'COMPLETED', 'TERMINATED', 'REJECTED'
  startedBy: integer('started_by').references(() => users.id),
  startedByName: text('started_by_name').default(''),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
});

export const workflowPendingApprovals = pgTable('workflow_pending_approvals', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  transitionId: integer('transition_id').notNull().references(() => workflowTransitions.id),
  assignedRole: text('assigned_role').default(''),
  assignedUserId: integer('assigned_user_id').references(() => users.id),
  status: text('status').default('PENDING'),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const workflowHistoryLogs = pgTable('workflow_history_logs', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  fromStateId: integer('from_state_id').references(() => workflowStates.id),
  toStateId: integer('to_state_id').references(() => workflowStates.id),
  transitionId: integer('transition_id').references(() => workflowTransitions.id),
  performedBy: integer('performed_by').references(() => users.id),
  performedByName: text('performed_by_name').default(''),
  actionKey: text('action_key').notNull(),
  actionTitle: text('action_title').default(''),
  comment: text('comment').default(''),
  snapshotData: jsonb('snapshot_data').default({}),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
});

export const workflowDefinitionVersions = pgTable('workflow_definition_versions', {
  id: serial('id').primaryKey(),
  definitionId: integer('definition_id').notNull().references(() => workflowDefinitions.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  description: text('description').default(''),
  dslJson: jsonb('dsl_json').default({}),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wdv_def_ver: index('idx_wdv_def_ver').on(table.definitionId, table.version)
}));

export const workflowTasks = pgTable('workflow_tasks', {
  id: serial('id').primaryKey(),
  instanceId: integer('instance_id').notNull().references(() => workflowInstances.id, { onDelete: 'cascade' }),
  transitionId: integer('transition_id').references(() => workflowTransitions.id),
  assignedUserId: integer('assigned_user_id').references(() => users.id),
  assignedRole: text('assigned_role').default(''),
  candidateUsers: jsonb('candidate_users').default([]),
  candidateRoles: jsonb('candidate_roles').default([]),
  delegatedToUserId: integer('delegated_to_user_id').references(() => users.id),
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'delegated', 'expired', 'canceled'
  title: text('title').notNull(),
  description: text('description').default(''),
  dueAt: timestamp('due_at', { mode: 'string' }),
  completedAt: timestamp('completed_at', { mode: 'string' }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow()
}, (table) => ({
  idx_wft_instance: index('idx_wft_instance').on(table.instanceId),
  idx_wft_assigned_user: index('idx_wft_assigned_user').on(table.assignedUserId),
  idx_wft_status: index('idx_wft_status').on(table.status)
}));

export const workflowDelegations = pgTable('workflow_delegations', {
  id: serial('id').primaryKey(),
  fromUserId: integer('from_user_id').notNull().references(() => users.id),
  toUserId: integer('to_user_id').notNull().references(() => users.id),
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
