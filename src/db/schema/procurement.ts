import { pgTable, text, serial, numeric, integer, jsonb, timestamp, index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { productionProjects } from './projects';
import { users } from './auth';
import { workflowInstances } from './workflow';

export const purchaseRequisitions = pgTable('purchase_requisitions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  title: text('title').notNull(),
  projectId: integer('project_id').references((): AnyPgColumn => productionProjects.id),
  projectCode: text('project_code').default(''),
  projectName: text('project_name').default(''),
  status: text('status').notNull().default('pending'),
  priority: text('priority').notNull().default('normal'),
  requiredDate: text('required_date').default(''),
  requestedById: integer('requested_by_id').references(() => users.id),
  requestedByName: text('requested_by_name').default(''),
  assignedToId: integer('assigned_to_id').references(() => users.id),
  assignedToName: text('assigned_to_name').default(''),
  workflowInstanceId: integer('workflow_instance_id').references((): AnyPgColumn => workflowInstances.id),
  notes: text('notes').default(''),
  totalEstimatedAmount: numeric('total_estimated_amount', { precision: 18, scale: 2, mode: 'number' }).default(0),
  items: jsonb('items').notNull().default([]),
  isDeleted: integer('is_deleted').default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
}, (table) => ({
  idx_pr_code: index('idx_pr_code').on(table.code),
  idx_pr_project: index('idx_pr_project').on(table.projectId),
  idx_pr_status: index('idx_pr_status').on(table.status),
  idx_pr_priority: index('idx_pr_priority').on(table.priority),
  idx_pr_workflow: index('idx_pr_workflow').on(table.workflowInstanceId),
  idx_pr_deleted: index('idx_pr_deleted').on(table.isDeleted),
}));
