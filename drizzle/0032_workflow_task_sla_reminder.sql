-- Drizzle Migration 0032: one-time SLA reminder of overdue workflow tasks and reopening of auto-expired tasks (v7.0.101 / TD-085 part 4)
--
-- Product-owner decision: when a workflow task's due time (due_at, from the state's slaHours) passes, its
-- assignee gets one in-app notification, never repeated. sla_reminded_at records that the reminder was sent.

ALTER TABLE workflow_tasks ADD COLUMN IF NOT EXISTS sla_reminded_at timestamp;

CREATE INDEX IF NOT EXISTS idx_wft_sla_due ON workflow_tasks (due_at) WHERE status = 'pending' AND sla_reminded_at IS NULL;

-- Product-owner decision (2026-10-03, «بازگشایی با گزارش»): approval tasks are no longer expired automatically
-- (WorkflowTaskService.markExpiredTasks was removed). Every task it expired is logged in workflow_task_reopen_log;
-- a task of the CURRENT step of a running instance is reopened (status pending, it gets the one-time reminder),
-- every other expired task stays expired and is logged with the reason. Nothing else is changed.

CREATE TABLE IF NOT EXISTS workflow_task_reopen_log (
  id serial PRIMARY KEY,
  task_id integer NOT NULL,
  instance_id integer NOT NULL,
  task_title text NOT NULL DEFAULT '',
  due_at timestamp,
  action text NOT NULL,
  reason text NOT NULL,
  created_at timestamp DEFAULT now(),
  CONSTRAINT chk_wtrl_action CHECK (action IN ('reopened', 'kept_expired'))
);

INSERT INTO workflow_task_reopen_log (task_id, instance_id, task_title, due_at, action, reason)
SELECT t.id, t.instance_id, t.title, t.due_at,
  CASE WHEN i.status = 'IN_PROGRESS' AND tr.from_state_id = i.current_state_id THEN 'reopened' ELSE 'kept_expired' END,
  CASE
    WHEN i.id IS NULL THEN 'فرایند یافت نشد'
    WHEN i.status IS DISTINCT FROM 'IN_PROGRESS' THEN 'فرایند پایان یافته است'
    WHEN tr.id IS NULL THEN 'گذر کار نامشخص است'
    WHEN tr.from_state_id = i.current_state_id THEN 'کار مرحله جاری فرایند در جریان'
    ELSE 'فرایند از مرحله این کار گذشته است'
  END
FROM workflow_tasks t
LEFT JOIN workflow_instances i ON i.id = t.instance_id
LEFT JOIN workflow_transitions tr ON tr.id = t.transition_id
WHERE t.status = 'expired';

UPDATE workflow_tasks t
SET status = 'pending'
FROM workflow_instances i, workflow_transitions tr
WHERE t.status = 'expired'
  AND i.id = t.instance_id
  AND tr.id = t.transition_id
  AND i.status = 'IN_PROGRESS'
  AND tr.from_state_id = i.current_state_id;
