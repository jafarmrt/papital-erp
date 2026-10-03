-- Drizzle Migration 0038: tools for unifying text date columns on Gregorian ISO storage (v7.0.131 / TD-232)
--
-- Product-owner decision (1405-07-11): users see and enter Jalali dates everywhere; text date columns store
-- Gregorian ISO "YYYY-MM-DD" (journal_vouchers.date stays Jalali). This migration changes no data. It adds:
--   erp_text_date_to_iso(v)   — any well-formed Jalali (1300..1500) or Gregorian (1900..2199) date, '-' or '/',
--                               Latin/Persian/Arabic digits, optional time -> ISO; NULL when empty or invalid
--                               (month 13, day 31 of Mehr, 30 Esfand of a common year ...). Same rules as
--                               toStorageDate in src/utils/calendarDate.ts.
--   erp_text_date_kind(v)     — 'empty' | 'iso' | 'gregorian' (valid, not canonical) | 'jalali' | 'invalid', for the
--                               read-only calendar report (npm run dates:report).
--   erp_unify_text_date_column(table, column) — converts one column to ISO; every changed or refused row is first
--                               recorded in legacy_date_repairs (repair_kind 'calendar') with its old value.
--   erp_set_iso_date_constraint(table, column) — replaces chk_<table>_<column>_datefmt with the 'iso' kind,
--                               validated only when no row violates it.
-- Later migrations call the last two per column.

ALTER TABLE legacy_date_repairs ADD COLUMN IF NOT EXISTS repair_kind text NOT NULL DEFAULT 'mdy';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_legacy_date_repairs_repair_kind' AND conrelid = 'legacy_date_repairs'::regclass) THEN
    ALTER TABLE legacy_date_repairs ADD CONSTRAINT chk_legacy_date_repairs_repair_kind CHECK (repair_kind IN ('mdy', 'calendar'));
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_text_date_to_iso(v text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  s text;
  m text[];
  y integer;
  mo integer;
  d integer;
  g date;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  s := btrim(translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
  IF s = '' THEN RETURN NULL; END IF;
  m := regexp_match(s, '^([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$');
  IF m IS NULL THEN RETURN NULL; END IF;
  y := m[1]::integer;
  mo := m[2]::integer;
  d := m[3]::integer;
  IF mo < 1 OR mo > 12 OR d < 1 THEN RETURN NULL; END IF;
  IF y BETWEEN 1900 AND 2199 THEN
    BEGIN
      g := make_date(y, mo, d);
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    RETURN to_char(g, 'YYYY-MM-DD');
  ELSIF y BETWEEN 1300 AND 1500 THEN
    IF (mo <= 6 AND d > 31) OR (mo > 6 AND d > 30) THEN RETURN NULL; END IF;
    g := erp_jalali_to_gregorian(y, mo, d);
    -- 30 Esfand of a common year falls on 1 Farvardin of the next year
    IF mo = 12 AND d = 30 AND g = erp_jalali_to_gregorian(y + 1, 1, 1) THEN RETURN NULL; END IF;
    RETURN to_char(g, 'YYYY-MM-DD');
  END IF;
  RETURN NULL;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_text_date_kind(v text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN v IS NULL OR btrim(v) = '' THEN 'empty'
    WHEN erp_text_date_to_iso(v) IS NULL THEN 'invalid'
    WHEN erp_text_date_to_iso(v) = v THEN 'iso'
    WHEN btrim(translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')) ~ '^1[345][0-9]{2}' THEN 'jalali'
    ELSE 'gregorian'
  END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_unify_text_date_column(p_table text, p_column text) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  n integer;
BEGIN
  -- 1) record every non-empty, non-canonical value once per old value (re-running adds nothing)
  EXECUTE format($q$
    INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
    SELECT %1$L, t.id, %2$L, t.%2$I, COALESCE(x.iso, t.%2$I),
           CASE WHEN x.iso IS NULL THEN 'refused' ELSE 'corrected' END,
           CASE WHEN x.iso IS NULL THEN 'تاریخ قابل تشخیص نیست؛ مقدار قبلی دست نخورد' END,
           'calendar'
      FROM %1$I t
      CROSS JOIN LATERAL (SELECT erp_text_date_to_iso(t.%2$I) AS iso) x
     WHERE btrim(COALESCE(t.%2$I, '')) <> ''
       AND t.%2$I IS DISTINCT FROM x.iso
       AND NOT EXISTS (
         SELECT 1 FROM legacy_date_repairs r
          WHERE r.table_name = %1$L AND r.column_name = %2$L AND r.row_id = t.id
            AND r.repair_kind = 'calendar' AND r.old_value = t.%2$I)
  $q$, p_table, p_column);
  -- 2) apply the corrected values (only where the row still holds the recorded old value)
  EXECUTE format($q$
    UPDATE %1$I t SET %2$I = r.new_value
      FROM legacy_date_repairs r
     WHERE r.table_name = %1$L AND r.column_name = %2$L AND r.row_id = t.id
       AND r.repair_kind = 'calendar' AND r.status = 'corrected' AND t.%2$I = r.old_value
  $q$, p_table, p_column);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_set_iso_date_constraint(p_table text, p_column text) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE
  cname text := 'chk_' || p_table || '_' || p_column || '_datefmt';
  bad boolean;
BEGIN
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', p_table, cname);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (erp_date_text_ok(%I, %L)) NOT VALID', p_table, cname, p_column, 'iso');
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE NOT erp_date_text_ok(%I, %L))', p_table, p_column, 'iso') INTO bad;
  IF bad THEN
    RAISE WARNING '%.%: rows that are not ISO dates kept (see legacy_date_repairs); constraint % left NOT VALID', p_table, p_column, cname;
    RETURN false;
  END IF;
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, cname);
  RETURN true;
END
$fn$;
