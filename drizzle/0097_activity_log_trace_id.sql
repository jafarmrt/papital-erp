-- v10.0.25 (TD-963, OBS-R2-07): every audit row carries the trace id of the request that wrote it, the id the
-- error answer and the log files carry, so support can find the audit rows of one failed or suspicious request.
-- Rows written before stay with an empty trace id; nothing is backfilled.
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS trace_id text DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_logs_trace_id ON activity_logs (trace_id) WHERE trace_id <> '';
