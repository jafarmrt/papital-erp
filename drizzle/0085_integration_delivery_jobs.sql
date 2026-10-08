-- Drizzle Migration 0085: durable delivery jobs for webhooks and rule actions (v9.0.365 / TD-705, product-owner decision t2 a)
--
-- A webhook delivery to a subscription and a rule's action for one event were attempted in memory only: the event's
-- outbox handlers reported success at once, webhook retries were three timers lost on a restart, a failed rule action
-- was never run again, and neither ever reached the dead letter queue. Each delivery (subscription x event, rule x
-- event) now has its own row here, unique per (kind, target_id, event_id), so a successful delivery is never repeated.
-- The integration delivery worker retries a failed row with a growing delay (next_attempt_at) and after max_attempts
-- moves it to the dead letter queue (status failed). Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS integration_delivery_jobs (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  target_id integer NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  event jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamp without time zone DEFAULT now(),
  locked_at timestamp without time zone,
  last_error text NOT NULL DEFAULT '',
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT uq_integration_delivery_jobs_target_event UNIQUE (kind, target_id, event_id),
  CONSTRAINT chk_integration_delivery_jobs_kind CHECK (kind IN ('webhook', 'rule_action')),
  CONSTRAINT chk_integration_delivery_jobs_status CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT chk_integration_delivery_jobs_attempts CHECK (attempts >= 0 AND max_attempts >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_integration_delivery_jobs_due ON integration_delivery_jobs (status, next_attempt_at);
