-- v11 (the 1405 replay, tool 4): expenses a colleague paid for the company from their own pocket.
--
-- An expense paid by a colleague moves no money: its draft voucher debits each line's expense account and credits the
-- colleague's running account (mapped colleague current account, 3208) on their detail. A treasury payment or receipt of the
-- new personnel purpose 'colleague_account' (petty cash in hand, a payback, money handed back) moves the same account, which
-- may stand on either side (owner's decision 7 Aban 1405). The record and its lines are kept here
-- (like petty cash statement lines), and the voucher is changed only by voiding the record. New tables and one wider
-- CHECK; no existing row is read or changed.
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS colleague_expenses (
  id serial PRIMARY KEY,
  personnel_id integer NOT NULL REFERENCES personnel(id),
  date text NOT NULL,
  description text NOT NULL DEFAULT '',
  total numeric(18,4) NOT NULL,
  voucher_id integer REFERENCES journal_vouchers(id),
  status text NOT NULL DEFAULT 'active',
  void_reason text NOT NULL DEFAULT '',
  voided_at timestamptz,
  voided_by_id integer REFERENCES users(id),
  created_by_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_colleague_expenses_date_datefmt CHECK (erp_date_text_ok(date, 'iso'::text)),
  CONSTRAINT chk_colleague_expenses_total CHECK (total > 0),
  CONSTRAINT chk_colleague_expenses_status CHECK (status = ANY (ARRAY['active'::text, 'voided'::text]))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_colleague_expenses_personnel ON colleague_expenses (personnel_id, date);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_colleague_expenses_voucher ON colleague_expenses (voucher_id) WHERE voucher_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_colleague_expenses_created_by_id ON colleague_expenses (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_colleague_expenses_voided_by_id ON colleague_expenses (voided_by_id) WHERE voided_by_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS colleague_expense_lines (
  id serial PRIMARY KEY,
  colleague_expense_id integer NOT NULL REFERENCES colleague_expenses(id),
  line_no integer NOT NULL,
  account_id integer NOT NULL REFERENCES accounts(id),
  amount numeric(18,4) NOT NULL,
  description text NOT NULL DEFAULT '',
  seller_name text NOT NULL DEFAULT '',
  invoice_number text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_colleague_expense_lines_amount CHECK (amount > 0),
  CONSTRAINT chk_colleague_expense_lines_line_no CHECK (line_no >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_colleague_expense_lines_expense_line ON colleague_expense_lines (colleague_expense_id, line_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_colleague_expense_lines_account ON colleague_expense_lines (account_id);
--> statement-breakpoint
ALTER TABLE treasury_transactions DROP CONSTRAINT IF EXISTS chk_treasury_transactions_purpose;
--> statement-breakpoint
ALTER TABLE treasury_transactions ADD CONSTRAINT chk_treasury_transactions_purpose CHECK ((purpose IS NULL) OR (purpose = ANY (ARRAY['settlement'::text, 'advance'::text, 'deductions'::text, 'colleague_account'::text, 'other'::text])));
