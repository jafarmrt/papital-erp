-- Drizzle Migration 0043: final step of the calendar unification (v7.0.136 / TD-232 step 6)
--
-- 1) erp_date_text_ok gets the 'isots' kind: a valid Gregorian ISO date with optional time and zone, never Jalali.
--    It is used for the three server timestamps kept as text: treasury_transactions.reconciled_at,
--    project_stages.completed_at and users.last_failed_login_at (all written by the server as Gregorian ISO).
-- 2) treasury_transactions.date (Gregorian ISO since v7.0.74, TD-105) is checked with erp_unify_text_date_column and
--    gets the 'iso' kind.
-- journal_vouchers.date keeps the 'any' kind (product-owner decision 1405-07-11: voucher dates stay as they are).
-- Every constraint is replaced NOT VALID and validated only when no row violates it; old rows are never rewritten
-- silently (a non-ISO treasury date is converted with its old value recorded in legacy_date_repairs).

CREATE OR REPLACE FUNCTION erp_date_text_ok(v text, kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT v IS NULL OR v = '' OR CASE kind
    WHEN 'iso' THEN v ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    WHEN 'isots' THEN v ~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'
    ELSE translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
      ~ '^((19|20|21)[0-9]{2}|1[345][0-9]{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'
  END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_set_date_constraint(p_table text, p_column text, p_kind text) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE
  cname text := 'chk_' || p_table || '_' || p_column || '_datefmt';
  bad boolean;
BEGIN
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', p_table, cname);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (erp_date_text_ok(%I, %L)) NOT VALID', p_table, cname, p_column, p_kind);
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE NOT erp_date_text_ok(%I, %L))', p_table, p_column, p_kind) INTO bad;
  IF bad THEN
    RAISE WARNING '%.%: rows that do not match the % date format kept; constraint % left NOT VALID', p_table, p_column, p_kind, cname;
    RETURN false;
  END IF;
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, cname);
  RETURN true;
END
$fn$;
--> statement-breakpoint
SELECT erp_unify_text_date_column('treasury_transactions', 'date');
--> statement-breakpoint
SELECT erp_set_date_constraint('treasury_transactions', 'date', 'iso');
--> statement-breakpoint
SELECT erp_set_date_constraint('treasury_transactions', 'reconciled_at', 'isots');
--> statement-breakpoint
SELECT erp_set_date_constraint('project_stages', 'completed_at', 'isots');
--> statement-breakpoint
SELECT erp_set_date_constraint('users', 'last_failed_login_at', 'isots');
