-- Drizzle Migration 0105: yearly eidi and bonus on payslips (v10.0.212 / TD-1089, payroll duties plan §3.8)
--
-- Product-owner decisions t14 to t16 (option a): the accountant enters, for each Jalali year, how eidi is computed
-- (payroll_eidi_rates: a percent of each payslip's work up to a yearly cap, the labor-law rule, or a fixed amount). There
-- are no default rates. A regular payslip keeps its eidi share (eidi_amount, eidi_year = the Jalali year of its period end);
-- its voucher debits the eidi expense and credits eidi payable. An eidi payslip (is_eidi = 1) pays the eidi of a year: its
-- eidi_amount is the eidi paid and eidi_from_accrual the part taken from the accrued eidi payable.
--
-- Accounts: the new 3207 «عیدی پرداختنی» under 32 and 7014 «هزینه عیدی و پاداش» under 70 are added to an existing chart
-- when the general account exists and the code is free; a code held by another account is left alone and reported with
-- RAISE WARNING. Runs inside the migrator transaction; the flag CHECK constraint is validated at once because every row
-- takes the default.

CREATE TABLE IF NOT EXISTS payroll_eidi_rates (
  id serial PRIMARY KEY,
  jalali_year integer NOT NULL,
  method text NOT NULL DEFAULT 'percent_of_work',
  percent numeric(7, 4) NOT NULL DEFAULT 0,
  yearly_cap numeric(18, 4) NOT NULL DEFAULT 0,
  labor_days numeric(7, 2) NOT NULL DEFAULT 0,
  labor_cap_days numeric(7, 2) NOT NULL DEFAULT 0,
  min_daily_wage numeric(18, 4) NOT NULL DEFAULT 0,
  fixed_amount numeric(18, 4) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  CONSTRAINT chk_payroll_eidi_rates_method CHECK (method IN ('percent_of_work', 'labor_law', 'fixed_amount'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_eidi_rates_year ON payroll_eidi_rates (jalali_year);
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS eidi_amount numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS eidi_from_accrual numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS eidi_year integer;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS is_eidi integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ppay_eidi_year ON piecework_payrolls (personnel_id, eidi_year) WHERE eidi_year IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_payrolls_is_eidi_flag' AND conrelid = 'piecework_payrolls'::regclass) THEN
    ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_is_eidi_flag CHECK (is_eidi IN (0, 1));
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  spec record;
  parent_ref integer;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('3207', 'عیدی پرداختنی', '32', 'liability', 'credit'),
      ('7014', 'هزینه عیدی و پاداش', '70', 'expense', 'debit')
    ) AS s(code, name, parent_code, account_type, nature)
  LOOP
    SELECT p.id INTO parent_ref FROM accounts p WHERE p.code = spec.parent_code AND COALESCE(p.is_deleted, 0) = 0 ORDER BY p.id LIMIT 1;
    IF parent_ref IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM accounts a WHERE a.code = spec.code AND COALESCE(a.is_deleted, 0) = 0) THEN
      IF NOT EXISTS (SELECT 1 FROM accounts a WHERE a.code = spec.code AND COALESCE(a.is_deleted, 0) = 0
                      AND a.parent_id = parent_ref AND a.account_type = spec.account_type) THEN
        RAISE WARNING 'migration 0105: account code % is held by another account; % was not created and its mapping needs a choice', spec.code, spec.code;
      END IF;
      CONTINUE;
    END IF;
    INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
    VALUES (spec.code, spec.name, 'subsidiary', parent_ref, spec.account_type, spec.nature, 1, 1, 0);
  END LOOP;
END $$;
