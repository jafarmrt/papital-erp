-- Drizzle Migration 0134: the start date of a treasury account (10.3 package 4, OBS-R1-65, TD-986, decision ت۴۷ item 2)
--
-- The opening voucher of a bank or cash account with an opening balance was dated the day it was issued, not the day the
-- account started. bank_accounts.opening_date («تاریخ آغاز حساب», ISO, empty = not recorded) is the date the user enters
-- when defining the account (default the business today), and the opening voucher, also one issued later by the final
-- approval of the account's workflow or by a first opening balance, carries it. Existing rows keep the empty default
-- (their vouchers, if any, are already issued; a later first opening voucher is dated the business today, as before), so
-- the date CHECK constraint (AGENTS.md §1.10) is valid at once. Runs inside the migrator transaction.

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS opening_date text DEFAULT '';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_accounts_opening_date_datefmt' AND conrelid = 'bank_accounts'::regclass) THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT chk_bank_accounts_opening_date_datefmt CHECK (erp_date_text_ok(opening_date, 'iso'));
  END IF;
END $$;
