-- Drizzle Migration 0103: prepayment payslips and the personnel service start date (v10.0.199 / TD-1085, TD-1086,
-- payroll duties plan §3.4)
--
-- A payslip whose period ends after the business today was always refused (TD-808), so a salary paid ahead (before a
-- holiday) had no record. Such a payslip is now accepted only as a prepayment with a reason: is_prepayment marks it and
-- prepayment_reason holds the reason, shown in its notes, audit row and print. Fixed salary used to start on the first
-- day of any payslip period, even for someone hired mid-month; personnel.start_date («آغاز همکاری», ISO, empty = as
-- before) is where fixed salary starts, the first month counted by days. Existing rows keep the defaults, so the new
-- flag and date CHECK constraints (AGENTS.md §1.9 / §1.10) are validated at once. Runs inside the migrator transaction.

ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS is_prepayment integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS prepayment_reason text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS start_date text DEFAULT '';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_payrolls_is_prepayment_flag' AND conrelid = 'piecework_payrolls'::regclass) THEN
    ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_is_prepayment_flag CHECK (is_prepayment IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_start_date_datefmt' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'iso'));
  END IF;
END $$;
