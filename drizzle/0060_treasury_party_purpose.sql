-- Drizzle Migration 0060: purpose and chosen counter account of treasury receipts and payments
-- (v9.0.72 / TD-507, finding B04-11, product-owner decision t4 option A)
--
-- A receipt or payment of party type «other» was posted to trade receivables (1201) and a personnel payment with purpose
-- «other» to wages payable (3201); the purpose of a personnel payment was not stored at all. The form now asks the counter
-- account for «other» and personnel «other», and the purpose of a personnel receipt or payment is required. Both are kept
-- on the treasury row: purpose ('settlement' | 'advance' | 'other') and contra_account_id (the account the user chose).
--
-- Both columns are new and nullable, so existing rows keep their values and the constraints are valid at once; old rows
-- are never rewritten. Runs inside the Drizzle migrator transaction.

ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS purpose text;
--> statement-breakpoint
ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS contra_account_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_treasury_transactions_purpose') THEN
    ALTER TABLE treasury_transactions ADD CONSTRAINT chk_treasury_transactions_purpose
      CHECK (purpose IS NULL OR purpose IN ('settlement', 'advance', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_treasury_transactions_contra_account') THEN
    ALTER TABLE treasury_transactions ADD CONSTRAINT fk_treasury_transactions_contra_account
      FOREIGN KEY (contra_account_id) REFERENCES accounts(id);
  END IF;
END $$;
