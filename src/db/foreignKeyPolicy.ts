/**
 * v9.0.430 (TD-612, B01-32, decision t6 «الف»): columns that hold another table's id on purpose without a foreign key.
 * Every other reference declared in the Drizzle schema has a database constraint (the regression test
 * `reg_foreign_key_inventory_td_612` checks both lists against the migrated schema). A new reference either gets its
 * constraint in its migration or is added here with its reason in the same change.
 */
export interface ForeignKeyException {
  table: string;
  column: string;
  referencedTable: string;
  reason: string;
}

const SNAPSHOT_STEP =
  'a step id of the instance\'s own snapshot (AGENTS §14.3 / §14.8): saving the design replaces the step rows and their ids, while a running instance and its history keep the ids of its snapshot';
const SNAPSHOT_ACTION =
  'an action id of the instance\'s own snapshot (AGENTS §14.3 / §14.8): saving the design replaces the action rows and their ids';
const WORKFLOW_USER =
  'a user id kept by the workflow engine without a foreign key by the package 14 decision (AGENTS §14.3): history, tasks, approvals and delegations outlive the user record';

export const FOREIGN_KEY_EXCEPTIONS: readonly ForeignKeyException[] = [
  { table: 'workflow_instances', column: 'current_state_id', referencedTable: 'workflow_states', reason: SNAPSHOT_STEP },
  { table: 'workflow_history_logs', column: 'from_state_id', referencedTable: 'workflow_states', reason: SNAPSHOT_STEP },
  { table: 'workflow_history_logs', column: 'to_state_id', referencedTable: 'workflow_states', reason: SNAPSHOT_STEP },
  { table: 'workflow_history_logs', column: 'transition_id', referencedTable: 'workflow_transitions', reason: SNAPSHOT_ACTION },
  { table: 'workflow_tasks', column: 'transition_id', referencedTable: 'workflow_transitions', reason: SNAPSHOT_ACTION },
  { table: 'workflow_pending_approvals', column: 'transition_id', referencedTable: 'workflow_transitions', reason: SNAPSHOT_ACTION },
  { table: 'workflow_instances', column: 'started_by', referencedTable: 'users', reason: WORKFLOW_USER },
  { table: 'workflow_history_logs', column: 'performed_by', referencedTable: 'users', reason: WORKFLOW_USER },
  { table: 'workflow_tasks', column: 'assigned_user_id', referencedTable: 'users', reason: WORKFLOW_USER },
  { table: 'workflow_tasks', column: 'delegated_to_user_id', referencedTable: 'users', reason: WORKFLOW_USER },
  { table: 'workflow_pending_approvals', column: 'assigned_user_id', referencedTable: 'users', reason: WORKFLOW_USER },
  { table: 'workflow_definition_versions', column: 'created_by', referencedTable: 'users', reason: WORKFLOW_USER },
  { table: 'workflow_delegations', column: 'from_user_id', referencedTable: 'users', reason: WORKFLOW_USER },
  { table: 'workflow_delegations', column: 'to_user_id', referencedTable: 'users', reason: WORKFLOW_USER },
  {
    table: 'workflow_task_reopen_log', column: 'task_id', referencedTable: 'workflow_tasks',
    reason: 'a one-off repair record (TD-085): it keeps the id of every task it reopened or kept, whatever happens to the task later',
  },
  {
    table: 'workflow_task_reopen_log', column: 'instance_id', referencedTable: 'workflow_instances',
    reason: 'a one-off repair record (TD-085): it keeps the id of the instance of every task it handled',
  },
];
