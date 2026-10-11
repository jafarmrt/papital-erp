-- Drizzle Migration 0109: personnel purpose «deductions» on treasury rows and cheques (v10.0.255, TD-952 / P5-W08)
--
-- A payslip credits «other payroll deductions payable» (3205) with the personnel detail, but no treasury purpose debited
-- 3205 with that detail, so a personnel stayed in credit after the deductions were remitted and could not be deleted.
-- The new purpose posts a payment to 3205 with the personnel detail. Both CHECK constraints only widen; every stored row
-- already satisfies the new list, so they are added valid. Runs inside the Drizzle migrator transaction.

ALTER TABLE treasury_transactions DROP CONSTRAINT IF EXISTS chk_treasury_transactions_purpose;
--> statement-breakpoint
ALTER TABLE treasury_transactions ADD CONSTRAINT chk_treasury_transactions_purpose
  CHECK (purpose IS NULL OR purpose IN ('settlement', 'advance', 'deductions', 'other'));
--> statement-breakpoint
ALTER TABLE cheques DROP CONSTRAINT IF EXISTS chk_cheques_purpose;
--> statement-breakpoint
ALTER TABLE cheques ADD CONSTRAINT chk_cheques_purpose
  CHECK (purpose IS NULL OR purpose IN ('settlement', 'advance', 'deductions', 'other'));
