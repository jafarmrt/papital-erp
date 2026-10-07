-- Drizzle Migration 0075: no public daily work logs (v9.0.236 / TD-900, product-owner decision t7)
--
-- A daily work log with visibility «public» (or the legacy values «all» and empty) was readable by every holder of
-- daily_logs.view, and the form offered «public» as one choice among others. The product owner removed the public
-- visibility: every such log moves to «mentioned_only» (the author, the mentioned users and holders of
-- daily_logs.manage_all), and its old value is recorded in daily_log_visibility_repairs first, so nothing is lost.
-- The column then defaults to mentioned_only, is NOT NULL and accepts only the four values the server writes
-- (chk_daily_work_logs_visibility, added NOT VALID and validated when every row holds it).
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS daily_log_visibility_repairs (
  id serial PRIMARY KEY,
  daily_log_id integer NOT NULL,
  old_visibility text,
  new_visibility text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT uq_daily_log_visibility_repairs_log UNIQUE (daily_log_id)
);
--> statement-breakpoint
INSERT INTO daily_log_visibility_repairs (daily_log_id, old_visibility, new_visibility)
SELECT l.id, l.visibility, 'mentioned_only'
  FROM daily_work_logs l
 WHERE l.visibility IS NULL OR btrim(l.visibility) IN ('', 'public', 'all')
ON CONFLICT (daily_log_id) DO NOTHING;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('daily_work_logs', $sql$
UPDATE daily_work_logs
   SET visibility = 'mentioned_only'
 WHERE visibility IS NULL OR btrim(visibility) IN ('', 'public', 'all')
$sql$);
--> statement-breakpoint
ALTER TABLE daily_work_logs ALTER COLUMN visibility SET DEFAULT 'mentioned_only';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM daily_work_logs WHERE visibility IS NULL) THEN
    ALTER TABLE daily_work_logs ALTER COLUMN visibility SET NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_daily_work_logs_visibility' AND conrelid = to_regclass('daily_work_logs')
  ) THEN
    ALTER TABLE daily_work_logs ADD CONSTRAINT chk_daily_work_logs_visibility
      CHECK (visibility IN ('mentioned_only', 'private', 'managers', 'custom')) NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM daily_work_logs WHERE visibility NOT IN ('mentioned_only', 'private', 'managers', 'custom')
  ) THEN
    RAISE NOTICE 'daily_work_logs has rows with an unknown visibility; chk_daily_work_logs_visibility left NOT VALID';
  ELSE
    ALTER TABLE daily_work_logs VALIDATE CONSTRAINT chk_daily_work_logs_visibility;
  END IF;
END $$;
