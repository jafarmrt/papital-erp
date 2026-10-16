-- Drizzle Migration 0116: petty cash expense lines (v10.1.32, D-16)
--
-- New table only. A petty cash expense statement is one treasury payment from a petty cash fund (bank_accounts.type
-- 'petty_cash') whose voucher debits one expense account per line and credits the fund; petty_cash_expense_lines keeps
-- those lines (account, amount, description, optional seller and invoice number). The foreign keys are validated at once
-- because the table is new, and each foreign key column has an index that leads with it (TD-614). No existing row is
-- written. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS petty_cash_expense_lines (
  id serial PRIMARY KEY,
  treasury_transaction_id integer NOT NULL,
  line_no integer NOT NULL,
  account_id integer NOT NULL,
  amount numeric(18, 4) NOT NULL,
  description text NOT NULL DEFAULT '',
  seller_name text NOT NULL DEFAULT '',
  invoice_number text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_petty_cash_expense_lines_line_no CHECK (line_no >= 1),
  CONSTRAINT chk_petty_cash_expense_lines_amount CHECK (amount > 0),
  CONSTRAINT fk_petty_cash_expense_lines_treasury_transaction FOREIGN KEY (treasury_transaction_id) REFERENCES treasury_transactions (id),
  CONSTRAINT fk_petty_cash_expense_lines_account FOREIGN KEY (account_id) REFERENCES accounts (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_expense_lines_transaction_line ON petty_cash_expense_lines (treasury_transaction_id, line_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_petty_cash_expense_lines_account ON petty_cash_expense_lines (account_id);
