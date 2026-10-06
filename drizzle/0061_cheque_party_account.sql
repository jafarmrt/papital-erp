-- Drizzle Migration 0061: party account and purpose of cheques (v9.0.84 / TD-497, finding B04-01, product-owner decision t2 option A)
--
-- A cheque voucher ignored the cheque's party type: a received cheque always credited trade receivables with a customer
-- detail and a paid cheque always debited trade payables with a supplier detail, so a personnel cheque landed on the
-- customer with the same id. A new cheque now posts to the account of its party type (customer, supplier, personnel by
-- purpose, or the counter account the user chose for «other» / personnel «other»), and its bounce and return vouchers use
-- that same account and party. The account used at registration is kept in party_account_id and the personnel purpose in
-- purpose ('settlement' | 'advance' | 'other').
--
-- Both columns are new and nullable: old cheques keep NULL and their later vouchers follow the old rule, so their ledger
-- rows are never rewritten. Old cheques whose party type differs from what the old rule posted are listed by the financial
-- health check (cheque_party_account_legacy). Runs inside the Drizzle migrator transaction.

ALTER TABLE cheques ADD COLUMN IF NOT EXISTS purpose text;
--> statement-breakpoint
ALTER TABLE cheques ADD COLUMN IF NOT EXISTS party_account_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_purpose') THEN
    ALTER TABLE cheques ADD CONSTRAINT chk_cheques_purpose
      CHECK (purpose IS NULL OR purpose IN ('settlement', 'advance', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cheques_party_account') THEN
    ALTER TABLE cheques ADD CONSTRAINT fk_cheques_party_account
      FOREIGN KEY (party_account_id) REFERENCES accounts(id);
  END IF;
END $$;
