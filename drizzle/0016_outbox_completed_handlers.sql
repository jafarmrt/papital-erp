-- Drizzle Migration 0016: Per-handler completion tracking for the Transactional Outbox (v7.0.25 / TD-183 — audit P1-1)
--
-- The outbox worker now awaits every domain-event handler and retries failed ones with backoff.
-- completed_handlers stores the names of handlers that already succeeded for this event so a
-- retry (or a DLQ replay) re-runs only the failed handlers and never duplicates side effects
-- (audit rows, webhook deliveries, notifications) of the successful ones.
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS completed_handlers jsonb NOT NULL DEFAULT '[]'::jsonb;
