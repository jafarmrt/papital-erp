-- Drizzle Migration 0075: one active custom piecework rate per personnel and task (v9.0.240 / TD-809, package 12 payroll)
--
-- A personnel custom rate was saved with "read, then insert or update" outside any transaction, so concurrent saves
-- created two active rows for one personnel and task: the rates page showed one of them and a work log took the
-- other. The application now saves under the personnel row lock (src/services/piecework/personnelRate.ts) and this
-- partial unique index keeps one active row per (personnel_id, task_id); soft-deleted rows (is_deleted = 1) do not
-- count.
--
-- The index is created only when the existing active rows have no duplicate: old rows are never changed here. When
-- duplicates exist the index is skipped (startup is not blocked) and the financial health check lists them
-- (piecework_personnel_rate_uniqueness); a work log then takes the newest active row, the one the rates page shows.
--
-- piecework_task_rate_history gets a nullable personnel_id: a row with it records a change of that personnel's custom
-- rate (change_type personnel_rate_create / personnel_rate_change); the task base rate history keeps personnel_id NULL.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE piecework_task_rate_history ADD COLUMN IF NOT EXISTS personnel_id integer;
CREATE INDEX IF NOT EXISTS idx_ptrh_personnel ON piecework_task_rate_history (personnel_id) WHERE personnel_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('uq_piecework_personnel_rates_active') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM piecework_personnel_rates WHERE is_deleted = 0 GROUP BY personnel_id, task_id HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'piecework_personnel_rates has more than one active rate for a personnel and task; uq_piecework_personnel_rates_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_piecework_personnel_rates_active ON piecework_personnel_rates (personnel_id, task_id) WHERE is_deleted = 0;
    END IF;
  END IF;
END $$;
