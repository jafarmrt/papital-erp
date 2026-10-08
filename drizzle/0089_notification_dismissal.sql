-- Drizzle Migration 0089: dismissing a notification keeps its row, and a due reminder is unique per user and link
-- (v9.0.414 / TD-717, product-owner decision t8 a)
--
-- «حذف» in the notification bell deleted the row, and the CRM due reminder was created by "read, then write" on every
-- GET /notifications and GET /notifications/unread-count with no constraint and no transaction: four concurrent requests
-- (the bell and its counter ask together) made two reminders of one follow-up, and a reminder the user had deleted came
-- back on the next request. A dismissed notification now keeps its row with dismissed_at (server UTC, like created_at)
-- and is never listed or counted; the reminder insert is ON CONFLICT DO NOTHING on a unique (user_id, type, link) of
-- 'crm_due_task' rows, dismissed ones included, so a dismissed reminder never comes back and two cannot be made at once.
--
-- The index is created only when existing reminders have no duplicate: old rows are never deleted here. When duplicates
-- exist the index is skipped with a warning (startup is not blocked) and the financial health check lists them
-- (notification_reminder_uniqueness). The existence check reads only the current schema. Runs inside the Drizzle
-- migrator transaction.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamp;

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_notifications_due_reminder')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM notifications WHERE type = 'crm_due_task'
      GROUP BY user_id, link HAVING COUNT(*) > 1
    ) THEN
      RAISE WARNING 'notifications has duplicate due reminders; uq_notifications_due_reminder not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_notifications_due_reminder ON notifications (user_id, type, link) WHERE type = 'crm_due_task';
    END IF;
  END IF;
END $$;
