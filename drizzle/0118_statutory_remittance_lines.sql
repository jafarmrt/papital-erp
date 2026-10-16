-- Drizzle Migration 0118: per-person lines of a monthly insurance or payroll tax remittance (v10.1.36, TD-1243,
-- product-owner decision ت۳۳ الف)
--
-- One treasury payment pays the insurance (3204) or payroll tax (3206) of a month's list; its voucher debits the mapped
-- account once per person with the personnel detail. statutory_remittance_lines keeps, for that payment, each person,
-- the list month and the amount, so the remittance window shows what each person's month has already received. A line
-- is live while its treasury row is completed; a void leaves the lines as they are. New table only: the foreign keys
-- are validated at once and each foreign key column has an index that leads with it (TD-614). No existing row is
-- written. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS statutory_remittance_lines (
  id serial PRIMARY KEY,
  treasury_transaction_id integer NOT NULL,
  kind text NOT NULL,
  jalali_year integer NOT NULL,
  jalali_month integer NOT NULL,
  personnel_id integer NOT NULL,
  amount numeric(18, 4) NOT NULL,
  created_at timestamp DEFAULT now(),
  CONSTRAINT chk_statutory_remittance_lines_kind CHECK (kind IN ('insurance', 'tax')),
  CONSTRAINT chk_statutory_remittance_lines_month CHECK (jalali_month BETWEEN 1 AND 12),
  CONSTRAINT chk_statutory_remittance_lines_amount CHECK (amount > 0),
  CONSTRAINT fk_statutory_remittance_lines_treasury_transaction FOREIGN KEY (treasury_transaction_id) REFERENCES treasury_transactions (id),
  CONSTRAINT fk_statutory_remittance_lines_personnel FOREIGN KEY (personnel_id) REFERENCES personnel (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_statutory_remittance_lines_treasury_transaction_id ON statutory_remittance_lines (treasury_transaction_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_statutory_remittance_lines_personnel_id ON statutory_remittance_lines (personnel_id);
