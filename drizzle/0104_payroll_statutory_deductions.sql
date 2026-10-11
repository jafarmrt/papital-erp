-- Drizzle Migration 0104: statutory payslip deductions (v10.0.201 / TD-1087, OBS-R2-49, payroll duties plan §3.3)
--
-- Product-owner decisions t4 to t7 (option a, 18 Mehr 1405): the employee and employer social insurance shares and the
-- payroll income tax are computed on a payslip from the rates the accountant enters for each Jalali year
-- (payroll_statutory_rates: employee and employer insurance percent, the monthly insurable wage cap, the monthly tax
-- brackets and whether the employee insurance share is taken off the tax base). There are no default rates. Each
-- personnel gets two flags, «مشمول بیمه» and «مشمول مالیات حقوق», off for the existing staff. A payslip keeps its three
-- amounts and the reason an amount differs from the suggestion; is_statutory_split marks the payslips issued from this
-- version on (0 for every existing payslip, 1 by default afterwards), so the financial health check can list the
-- deductions the older payslips left on 3205.
--
-- Accounts: 3204 «بیمه پرداختنی» (standard), the new 3206 «مالیات حقوق پرداختنی» under 32 (3203 is the VAT account) and
-- the new 7013 «هزینه بیمه سهم کارفرما» under 70 are added to an existing chart when its general account exists and the
-- code is free; a code held by another active account is left alone and reported with RAISE WARNING (the mapping then
-- points to whatever the accountant picks). 3205 is renamed «سایر کسورات حقوق پرداختنی» only while it still has its
-- standard name. Runs inside the migrator transaction; the new flag CHECK constraints are validated at once because
-- every existing row takes the default.

CREATE TABLE IF NOT EXISTS payroll_statutory_rates (
  id serial PRIMARY KEY,
  jalali_year integer NOT NULL,
  employee_insurance_percent numeric(7, 4) NOT NULL DEFAULT 0,
  employer_insurance_percent numeric(7, 4) NOT NULL DEFAULT 0,
  insurance_wage_cap numeric(18, 4) NOT NULL DEFAULT 0,
  tax_brackets jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_insurance_deducted_from_tax integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  CONSTRAINT chk_payroll_statutory_rates_is_insurance_deducted_from_tax_flag CHECK (is_insurance_deducted_from_tax IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_statutory_rates_year ON payroll_statutory_rates (jalali_year);
--> statement-breakpoint
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS is_insurance_covered integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS is_tax_covered integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS employee_insurance numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS employer_insurance numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS income_tax numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS statutory_override_reason text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS is_statutory_split integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE piecework_payrolls ALTER COLUMN is_statutory_split SET DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_is_insurance_covered_flag' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_is_insurance_covered_flag CHECK (is_insurance_covered IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_is_tax_covered_flag' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_is_tax_covered_flag CHECK (is_tax_covered IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_payrolls_is_statutory_split_flag' AND conrelid = 'piecework_payrolls'::regclass) THEN
    ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_is_statutory_split_flag CHECK (is_statutory_split IN (0, 1));
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
      ('3204', 'بیمه پرداختنی', '32', 'liability', 'credit'),
      ('3206', 'مالیات حقوق پرداختنی', '32', 'liability', 'credit'),
      ('7013', 'هزینه بیمه سهم کارفرما', '70', 'expense', 'debit')
    ) AS s(code, name, parent_code, account_type, nature)
  LOOP
    SELECT p.id INTO parent_ref FROM accounts p WHERE p.code = spec.parent_code AND COALESCE(p.is_deleted, 0) = 0 ORDER BY p.id LIMIT 1;
    IF parent_ref IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM accounts a WHERE a.code = spec.code AND COALESCE(a.is_deleted, 0) = 0) THEN
      IF NOT EXISTS (SELECT 1 FROM accounts a WHERE a.code = spec.code AND COALESCE(a.is_deleted, 0) = 0
                      AND a.parent_id = parent_ref AND a.account_type = spec.account_type) THEN
        RAISE WARNING 'migration 0104: account code % is held by another account; % was not created and its mapping needs a choice', spec.code, spec.code;
      END IF;
      CONTINUE;
    END IF;
    INSERT INTO accounts (code, name, level, parent_id, account_type, nature, is_system, is_active, is_deleted)
    VALUES (spec.code, spec.name, 'subsidiary', parent_ref, spec.account_type, spec.nature, 1, 1, 0);
  END LOOP;
END $$;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('accounts', $sql$
UPDATE accounts SET name = 'سایر کسورات حقوق پرداختنی'
WHERE code = '3205' AND name = 'کسورات حقوق پرداختنی (بیمه و مالیات سهم کارکنان)'
$sql$);
