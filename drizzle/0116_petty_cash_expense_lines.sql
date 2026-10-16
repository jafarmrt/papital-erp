-- Drizzle Migration 0116: petty cash expense lines (v10.1.32, D-16)
--
-- A petty cash expense statement is one treasury payment from a petty cash fund (bank_accounts.type 'petty_cash') whose
-- voucher debits one expense account per line and credits the fund; petty_cash_expense_lines keeps those lines (account,
-- amount paid, optional VAT inside that amount, description, optional seller and invoice number). The foreign keys are
-- validated at once because the table is new, and each foreign key column has an index that leads with it (TD-614).
--
-- A line's optional VAT goes to the account mapping key purchaseVatAccountCode, whose default is the new standard
-- subsidiary account 1303 «مالیات بر ارزش افزوده خرید» (asset, debit, under the general account 13). It is created only
-- when the chart already has the general account 13 and no active account uses code 1303; on an empty database the
-- standard chart seed creates it. No existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS petty_cash_expense_lines (
  id serial PRIMARY KEY,
  treasury_transaction_id integer NOT NULL,
  line_no integer NOT NULL,
  account_id integer NOT NULL,
  amount numeric(18, 4) NOT NULL,
  vat_amount numeric(18, 4) NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  seller_name text NOT NULL DEFAULT '',
  invoice_number text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_petty_cash_expense_lines_line_no CHECK (line_no >= 1),
  CONSTRAINT chk_petty_cash_expense_lines_amount CHECK (amount > 0),
  CONSTRAINT chk_petty_cash_expense_lines_vat_amount CHECK (vat_amount >= 0 AND vat_amount < amount),
  CONSTRAINT fk_petty_cash_expense_lines_treasury_transaction FOREIGN KEY (treasury_transaction_id) REFERENCES treasury_transactions (id),
  CONSTRAINT fk_petty_cash_expense_lines_account FOREIGN KEY (account_id) REFERENCES accounts (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_expense_lines_transaction_line ON petty_cash_expense_lines (treasury_transaction_id, line_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_petty_cash_expense_lines_account ON petty_cash_expense_lines (account_id);
--> statement-breakpoint
INSERT INTO "accounts" ("code", "name", "level", "parent_id", "account_type", "nature", "is_system", "is_active", "is_deleted")
SELECT '1303', 'مالیات بر ارزش افزوده خرید', 'subsidiary', p."id", 'asset', 'debit', 1, 1, 0
FROM "accounts" p
WHERE p."code" = '13' AND COALESCE(p."is_deleted", 0) = 0
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."code" = '1303' AND COALESCE(a."is_deleted", 0) = 0)
ORDER BY p."id"
LIMIT 1;
