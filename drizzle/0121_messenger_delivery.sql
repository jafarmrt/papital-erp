-- Drizzle Migration 0121: messenger delivery jobs and per-category notification choices (v10.1.39, messenger
-- notifications plan part 2)
--
-- Every in-app notification is now written through one function, which in the same transaction queues one delivery job
-- of the new kind `messenger` for each active messenger link of the recipient. The kind CHECK of integration_delivery_jobs
-- only widens; every stored row already satisfies the new list, so it is added valid.
-- user_notification_preferences holds a user's choice per notification category: a missing row means «send to the
-- messenger too» (the default), a row with send_to_messenger = 0 keeps that category in the app's bell only.
-- New table only: its foreign key is validated at once and its unique index leads with user_id (TD-614). No existing row
-- is written. Runs inside the Drizzle migrator transaction.

ALTER TABLE integration_delivery_jobs DROP CONSTRAINT IF EXISTS chk_integration_delivery_jobs_kind;
--> statement-breakpoint
ALTER TABLE integration_delivery_jobs ADD CONSTRAINT chk_integration_delivery_jobs_kind
  CHECK (kind IN ('webhook', 'rule_action', 'messenger'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  category text NOT NULL,
  send_to_messenger integer NOT NULL DEFAULT 1,
  updated_at timestamp DEFAULT now(),
  CONSTRAINT chk_user_notification_preferences_category CHECK (category IN (
    'workflow_task', 'workflow_sla', 'payslip', 'mention', 'daily_log_review', 'crm_followup', 'crm_won', 'event_rule'
  )),
  CONSTRAINT chk_user_notification_preferences_send_to_messenger_flag CHECK (send_to_messenger IN (0, 1)),
  CONSTRAINT uq_user_notification_preferences_user_category UNIQUE (user_id, category),
  CONSTRAINT fk_user_notification_preferences_user FOREIGN KEY (user_id) REFERENCES users (id)
);
