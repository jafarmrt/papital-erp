-- Drizzle Migration 0030: repair of the legacy "MM-DD-YYYY AP" dates (v7.0.82 / TD-231)
--
-- Until v7.0.73 businessTodayJalaliDash() returned "07-10-1405 AP" instead of "1405-07-10": item / bank / cash
-- opening and opening-adjustment vouchers and payroll payment vouchers were dated "07-10-1405", the payroll treasury
-- row and the payroll payment_date "07-10-1405 AP". Product-owner decision (2026-10-02): repair them with a backup
-- and a report.
--   journal_vouchers.date, piecework_payrolls.payment_date -> Jalali "1405-07-10" (what the fixed function writes)
--   treasury_transactions.date                            -> Gregorian ISO "2026-10-02" (TD-105 contract, v7.0.74)
-- Every row is recorded in legacy_date_repairs with its old and new value before it is changed (the backup and the
-- report shown by the financial health check). A voucher whose repaired date falls in a closed fiscal year
-- (fiscal_periods) is not changed and is recorded as refused. Then the three columns get the date-format CHECK of
-- migration 0028 (validated only when no row violates it).

CREATE OR REPLACE FUNCTION erp_jalali_to_gregorian(jy integer, jm integer, jd integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  -- Nowruz (1 Farvardin) from erp_nowruz_march_day (migration 0024), plus the day of the Jalali year
  SELECT make_date(jy + 621, 3, erp_nowruz_march_day(jy + 621))
         + (CASE WHEN jm <= 6 THEN (jm - 1) * 31 ELSE 186 + (jm - 7) * 30 END + jd - 1)
$$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS legacy_date_repairs (
  id serial PRIMARY KEY,
  table_name text NOT NULL,
  row_id integer NOT NULL,
  column_name text NOT NULL,
  old_value text NOT NULL,
  new_value text NOT NULL,
  status text NOT NULL,
  reason text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT chk_legacy_date_repairs_status CHECK (status IN ('corrected', 'refused'))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_repair_legacy_mdy_dates()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  pat constant text := '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-(1[345][0-9]{2})( AP)?$';
  fixed integer := 0;
  n integer;
BEGIN
  -- 1) journal_vouchers.date -> Jalali YYYY-MM-DD; refused when that Jalali fiscal year is closed
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason)
  SELECT 'journal_vouchers', v.id, 'date', v.date, x.m[3] || '-' || x.m[1] || '-' || x.m[2],
         CASE WHEN fp.status = 'closed' THEN 'refused' ELSE 'corrected' END,
         CASE WHEN fp.status = 'closed' THEN 'سال مالی ' || x.m[3] || ' بسته است' END
    FROM journal_vouchers v
    CROSS JOIN LATERAL (SELECT regexp_match(v.date, pat) AS m) x
    LEFT JOIN fiscal_periods fp ON fp.fiscal_year = x.m[3]::integer
   WHERE x.m IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'journal_vouchers' AND r.row_id = v.id AND r.column_name = 'date');
  UPDATE journal_vouchers v SET date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'journal_vouchers' AND r.column_name = 'date' AND r.row_id = v.id
     AND r.status = 'corrected' AND v.date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  fixed := fixed + n;

  -- 2) treasury_transactions.date -> Gregorian ISO
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status)
  SELECT 'treasury_transactions', t.id, 'date', t.date,
         to_char(erp_jalali_to_gregorian(x.m[3]::integer, x.m[1]::integer, x.m[2]::integer), 'YYYY-MM-DD'), 'corrected'
    FROM treasury_transactions t
    CROSS JOIN LATERAL (SELECT regexp_match(t.date, pat) AS m) x
   WHERE x.m IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'treasury_transactions' AND r.row_id = t.id AND r.column_name = 'date');
  UPDATE treasury_transactions t SET date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'treasury_transactions' AND r.column_name = 'date' AND r.row_id = t.id
     AND r.status = 'corrected' AND t.date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  fixed := fixed + n;

  -- 3) piecework_payrolls.payment_date -> Jalali YYYY-MM-DD
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status)
  SELECT 'piecework_payrolls', p.id, 'payment_date', p.payment_date, x.m[3] || '-' || x.m[1] || '-' || x.m[2], 'corrected'
    FROM piecework_payrolls p
    CROSS JOIN LATERAL (SELECT regexp_match(p.payment_date, pat) AS m) x
   WHERE x.m IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'piecework_payrolls' AND r.row_id = p.id AND r.column_name = 'payment_date');
  UPDATE piecework_payrolls p SET payment_date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'piecework_payrolls' AND r.column_name = 'payment_date' AND r.row_id = p.id
     AND r.status = 'corrected' AND p.payment_date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  fixed := fixed + n;

  RETURN fixed;
END;
$$;
--> statement-breakpoint
SELECT erp_repair_legacy_mdy_dates();
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_vouchers_date_datefmt' AND conrelid = 'journal_vouchers'::regclass) THEN
    ALTER TABLE journal_vouchers ADD CONSTRAINT chk_journal_vouchers_date_datefmt CHECK (erp_date_text_ok(date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM journal_vouchers WHERE NOT erp_date_text_ok(date, 'any')) THEN
    RAISE WARNING 'journal_vouchers.date: rows with an invalid date format kept; constraint chk_journal_vouchers_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE journal_vouchers VALIDATE CONSTRAINT chk_journal_vouchers_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_treasury_transactions_date_datefmt' AND conrelid = 'treasury_transactions'::regclass) THEN
    ALTER TABLE treasury_transactions ADD CONSTRAINT chk_treasury_transactions_date_datefmt CHECK (erp_date_text_ok(date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM treasury_transactions WHERE NOT erp_date_text_ok(date, 'any')) THEN
    RAISE WARNING 'treasury_transactions.date: rows with an invalid date format kept; constraint chk_treasury_transactions_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE treasury_transactions VALIDATE CONSTRAINT chk_treasury_transactions_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_payrolls_payment_date_datefmt' AND conrelid = 'piecework_payrolls'::regclass) THEN
    ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_payment_date_datefmt CHECK (erp_date_text_ok(payment_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_payrolls WHERE NOT erp_date_text_ok(payment_date, 'any')) THEN
    RAISE WARNING 'piecework_payrolls.payment_date: rows with an invalid date format kept; constraint chk_piecework_payrolls_payment_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE piecework_payrolls VALIDATE CONSTRAINT chk_piecework_payrolls_payment_date_datefmt;
  END IF;
END $$;
