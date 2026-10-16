-- Drizzle Migration 0116: per-person eidi flag (v10.1.32, TD-1282, product-owner decision ت۳۴ الف)
--
-- personnel.is_eidi_covered says whether a regular payslip of the person accrues an eidi share and whether the yearly
-- eidi entitlement applies to the person. The column is added with DEFAULT 1, so every existing person keeps today's
-- behaviour and no payslip changes; the flag has its CHECK (P3-14). No other row is written. Runs inside the Drizzle
-- migrator transaction.

ALTER TABLE personnel ADD COLUMN IF NOT EXISTS is_eidi_covered integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_is_eidi_covered_flag' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_is_eidi_covered_flag CHECK (is_eidi_covered IN (0, 1));
  END IF;
END $$;
