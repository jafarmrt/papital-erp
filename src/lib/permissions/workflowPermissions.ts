/**
 * Workflow route keys (v10.0.187, TD-1150). Executing a step (`POST /workflow/tasks/:id/execute`, `/workflow/transition`)
 * needs one of these keys; the inbox (`/workflow/tasks/my-tasks`, `/tasks/stats`) also opens for `workflow.view`, but
 * lists a pending task only to a user who holds one of them, so a reader never gets a card whose decide button is 403.
 */
export const WORKFLOW_EXECUTE_PERMISSIONS = ['workflow.approve', 'workflow.execute', 'workflow.manage', 'workflow.admin'] as const;

/** The keys that open the inbox: the read key plus the execute keys */
export const WORKFLOW_INBOX_PERMISSIONS = ['workflow.view', ...WORKFLOW_EXECUTE_PERMISSIONS] as const;

export function holdsWorkflowExecuteKey(permissions: readonly string[]): boolean {
  return WORKFLOW_EXECUTE_PERMISSIONS.some(p => permissions.includes(p));
}

/**
 * v10.1.5 (TD-1229, D-06 part A, decision ت۴): turning a workflow definition on or off and archiving it; turning off an
 * approval is sensitive, so `workflow.manage` designs but does not switch.
 */
export const WORKFLOW_SWITCH_PERMISSION = 'workflow.admin';
