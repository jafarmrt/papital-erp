-- Drizzle Migration 0071: CHECK constraints on voucher rows, vouchers and accounts, and a foreign key from an account to its
-- parent (v9.0.202 / TD-562, finding B03-20)
--
-- Only the services checked that a voucher row has a non-negative debit and credit and one of them non-zero, that a voucher
-- has a known status and type, and that an account has a known level, type and nature; accounts.parent_id had no foreign key,
-- so an account could point to a missing parent. Each rule below is enforced by the database from now on.
--
-- A soft-deleted row (is_deleted = 1) is exempt from the CHECK constraints: no report reads it, and a legacy row that breaks a
-- rule can still be soft-deleted (a NOT VALID CHECK applies to every updated row). Each constraint is added NOT VALID (new
-- and updated rows must hold it at once) and validated only when no existing row breaks it; old rows are never changed or
-- deleted here. Whatever is left unvalidated is listed by the financial health check (accounting_integrity_constraints).
-- Runs inside the Drizzle migrator transaction.

DO $$
DECLARE
  rule record;
  broken boolean;
BEGIN
  FOR rule IN
    SELECT * FROM (VALUES
      ('chk_jvi_amounts_non_negative', 'journal_voucher_items',
        'is_deleted = 1 OR (debit >= 0 AND credit >= 0)'),
      ('chk_jvi_amount_present', 'journal_voucher_items',
        'is_deleted = 1 OR debit <> 0 OR credit <> 0'),
      ('chk_jv_status', 'journal_vouchers',
        'is_deleted = 1 OR status IN (''draft'', ''approved'', ''permanent'')'),
      ('chk_jv_voucher_type', 'journal_vouchers',
        'is_deleted = 1 OR voucher_type IN (''general'', ''opening'', ''closing'', ''sales'', ''purchase'', ''treasury'', ''payroll'', ''adjustment'', ''settlement'')'),
      ('chk_accounts_level', 'accounts',
        'is_deleted = 1 OR level IN (''group'', ''general'', ''subsidiary'', ''detailed'')'),
      ('chk_accounts_account_type', 'accounts',
        'is_deleted = 1 OR account_type IN (''asset'', ''liability'', ''equity'', ''revenue'', ''expense'', ''cost_of_sales'')'),
      ('chk_accounts_nature', 'accounts',
        'is_deleted = 1 OR nature IN (''debit'', ''credit'', ''both'')')
    ) AS t(name, tbl, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = rule.name AND conrelid = to_regclass(rule.tbl)
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', rule.tbl, rule.name, rule.expr);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE NOT (%s))', rule.tbl, rule.expr) INTO broken;
    IF broken THEN
      RAISE NOTICE '% has rows that break %; constraint left NOT VALID (see the financial health check)', rule.tbl, rule.name;
    ELSE
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', rule.tbl, rule.name);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_accounts_parent' AND conrelid = to_regclass('accounts')
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT fk_accounts_parent FOREIGN KEY (parent_id) REFERENCES accounts (id) NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM accounts c WHERE c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts p WHERE p.id = c.parent_id)
  ) THEN
    RAISE NOTICE 'accounts has rows whose parent_id points to a missing account; fk_accounts_parent left NOT VALID (see the financial health check)';
  ELSE
    ALTER TABLE accounts VALIDATE CONSTRAINT fk_accounts_parent;
  END IF;
END $$;
