-- Drizzle Migration 0108: cleared cheques in bank statement reconciliation (v10.0.254, TD-971 / OBS-R1-66)
--
-- A cleared cheque counts in its bank account's treasury balance (TD-276) but had no reconciliation state, so the bank
-- statement window could never mark its line as matched. The cheque gets the same three columns as a treasury row:
-- the flag, the server UTC time of the match (kind isots) and the statement batch. New columns, so both constraints are
-- valid at once. Runs inside the Drizzle migrator transaction.

ALTER TABLE cheques ADD COLUMN IF NOT EXISTS reconciled integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS reconciled_at text DEFAULT '';
--> statement-breakpoint
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS reconciled_batch text DEFAULT '';
--> statement-breakpoint
ALTER TABLE cheques ADD CONSTRAINT chk_cheques_reconciled_flag CHECK (reconciled IN (0, 1));
--> statement-breakpoint
ALTER TABLE cheques ADD CONSTRAINT chk_cheques_reconciled_at_datefmt CHECK (erp_date_text_ok(reconciled_at, 'isots'));
