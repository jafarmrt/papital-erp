-- V5.0.16 (TD-119): اصلاح رکوردهای تاریخی با سال جلالی در ستون‌های تاریخ + پشتیبان + گارد اعتبارسنجی میلادی
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS _repair_0011_timestamps_backup (
    id serial PRIMARY KEY,
    table_name text NOT NULL,
    row_id int NOT NULL,
    column_name text NOT NULL,
    original_date text,
    repaired_date text,
    backed_up_at timestamp DEFAULT now()
  );
END $$;

-- تابع موقت تبدیل جلالی به میلادی استاندارد با الگوریتم دقیق Borkowski
CREATE OR REPLACE FUNCTION _repair_jalali_to_gregorian(jdate text) RETURNS text AS $$
DECLARE
  clean_str text;
  time_part text := '00:00:00';
  parts text[];
  jy int;
  jm int;
  jd int;
  gy int;
  jYear int;
  days int;
  sal_a int[];
  gm int;
  gd int;
  res_date text;
BEGIN
  IF jdate IS NULL OR trim(jdate) = '' THEN
    RETURN jdate;
  END IF;

  clean_str := trim(jdate);
  IF position(' ' in clean_str) > 0 THEN
    time_part := split_part(clean_str, ' ', 2);
    clean_str := split_part(clean_str, ' ', 1);
  ELSIF position('T' in clean_str) > 0 THEN
    time_part := split_part(clean_str, 'T', 2);
    clean_str := split_part(clean_str, 'T', 1);
  END IF;

  clean_str := replace(clean_str, '/', '-');
  parts := string_to_array(clean_str, '-');

  IF array_length(parts, 1) < 3 THEN
    RETURN jdate;
  END IF;

  IF NOT (parts[1] ~ '^[0-9]+$' AND parts[2] ~ '^[0-9]+$' AND parts[3] ~ '^[0-9]+$') THEN
    RETURN jdate;
  END IF;

  jy := parts[1]::int;
  jm := parts[2]::int;
  jd := parts[3]::int;

  IF jy < 1300 OR jy > 1500 THEN
    RETURN clean_str || ' ' || time_part;
  END IF;

  IF jy > 979 THEN
    gy := 1600;
    jYear := jy - 979;
  ELSE
    gy := 621;
    jYear := jy;
  END IF;

  days := (365 * jYear) + (floor(jYear / 33.0)::int * 8) + floor(((jYear % 33) + 3) / 4.0)::int + 78 + jd;
  IF jm < 7 THEN
    days := days + (jm - 1) * 31;
  ELSE
    days := days + ((jm - 7) * 30) + 186;
  END IF;

  gy := gy + 400 * floor(days / 146097.0)::int;
  days := days % 146097;

  IF days > 36524 THEN
    days := days - 1;
    gy := gy + 100 * floor(days / 36524.0)::int;
    days := days % 36524;
    IF days >= 365 THEN
      days := days + 1;
    END IF;
  END IF;

  gy := gy + 4 * floor(days / 1461.0)::int;
  days := days % 1461;

  IF days > 365 THEN
    gy := gy + floor((days - 1) / 365.0)::int;
    days := (days - 1) % 365;
  END IF;

  gd := days + 1;

  IF (gy % 4 = 0 AND gy % 100 <> 0) OR (gy % 400 = 0) THEN
    sal_a := ARRAY[0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  ELSE
    sal_a := ARRAY[0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  END IF;

  gm := 0;
  WHILE gm < 13 AND gd > sal_a[gm + 1] LOOP
    gd := gd - sal_a[gm + 1];
    gm := gm + 1;
  END LOOP;

  res_date := lpad(gy::text, 4, '0') || '-' || lpad(gm::text, 2, '0') || '-' || lpad(gd::text, 2, '0');
  RETURN res_date || ' ' || time_part;
END;
$$ LANGUAGE plpgsql;

-- ۱. پالایش و تبدیل جدول documents
DO $$
DECLARE r record; rep text;
BEGIN
  FOR r IN SELECT id, date::text AS d FROM documents WHERE date IS NOT NULL AND SUBSTRING(trim(date::text) FROM 1 FOR 4) ~ '^[0-9]{4}$' AND SUBSTRING(trim(date::text) FROM 1 FOR 4)::int BETWEEN 1300 AND 1500 LOOP
    rep := _repair_jalali_to_gregorian(r.d);
    INSERT INTO _repair_0011_timestamps_backup (table_name, row_id, column_name, original_date, repaired_date)
    VALUES ('documents', r.id, 'date', r.d, rep);
    UPDATE documents SET date = rep::timestamp WHERE id = r.id;
  END LOOP;
END $$;

-- ۲. پالایش و تبدیل جدول transactions
DO $$
DECLARE r record; rep text;
BEGIN
  FOR r IN SELECT id, date::text AS d FROM transactions WHERE date IS NOT NULL AND SUBSTRING(trim(date::text) FROM 1 FOR 4) ~ '^[0-9]{4}$' AND SUBSTRING(trim(date::text) FROM 1 FOR 4)::int BETWEEN 1300 AND 1500 LOOP
    rep := _repair_jalali_to_gregorian(r.d);
    INSERT INTO _repair_0011_timestamps_backup (table_name, row_id, column_name, original_date, repaired_date)
    VALUES ('transactions', r.id, 'date', r.d, rep);
    UPDATE transactions SET date = rep::timestamp WHERE id = r.id;
  END LOOP;
END $$;

-- ۳. پالایش و تبدیل جدول journal_vouchers
DO $$
DECLARE r record; rep text;
BEGIN
  FOR r IN SELECT id, date::text AS d FROM journal_vouchers WHERE date IS NOT NULL AND SUBSTRING(trim(date::text) FROM 1 FOR 4) ~ '^[0-9]{4}$' AND SUBSTRING(trim(date::text) FROM 1 FOR 4)::int BETWEEN 1300 AND 1500 LOOP
    rep := _repair_jalali_to_gregorian(r.d);
    INSERT INTO _repair_0011_timestamps_backup (table_name, row_id, column_name, original_date, repaired_date)
    VALUES ('journal_vouchers', r.id, 'date', r.d, rep);
    UPDATE journal_vouchers SET date = rep::timestamp WHERE id = r.id;
  END LOOP;
END $$;

-- ۴. پالایش و تبدیل جدول treasury_transactions
DO $$
DECLARE r record; rep text;
BEGIN
  FOR r IN SELECT id, date::text AS d FROM treasury_transactions WHERE date IS NOT NULL AND SUBSTRING(trim(date::text) FROM 1 FOR 4) ~ '^[0-9]{4}$' AND SUBSTRING(trim(date::text) FROM 1 FOR 4)::int BETWEEN 1300 AND 1500 LOOP
    rep := _repair_jalali_to_gregorian(r.d);
    INSERT INTO _repair_0011_timestamps_backup (table_name, row_id, column_name, original_date, repaired_date)
    VALUES ('treasury_transactions', r.id, 'date', r.d, rep);
    UPDATE treasury_transactions SET date = rep::timestamp WHERE id = r.id;
  END LOOP;
END $$;

-- ۵. ادغام شمارنده‌های مانده از سال 2026 در سال جلالی 1405
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT doc_type, last_ref_number FROM document_ref_counters WHERE fiscal_year = 2026 LOOP
    INSERT INTO document_ref_counters (doc_type, fiscal_year, last_ref_number)
    VALUES (r.doc_type, 1405, r.last_ref_number)
    ON CONFLICT (doc_type, fiscal_year)
    DO UPDATE SET last_ref_number = GREATEST(document_ref_counters.last_ref_number, EXCLUDED.last_ref_number);
  END LOOP;
  DELETE FROM document_ref_counters WHERE fiscal_year = 2026;
END $$;

-- ۶. اضافه کردن گارد اعتبارسنجی تاریخ میلادی به documents و transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_documents_date_gregorian'
  ) THEN
    ALTER TABLE documents ADD CONSTRAINT chk_documents_date_gregorian CHECK (date IS NULL OR date::text = '' OR (SUBSTRING(trim(date::text) FROM 1 FOR 4) ~ '^[0-9]{4}$' AND SUBSTRING(trim(date::text) FROM 1 FOR 4)::int >= 1900));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_transactions_date_gregorian'
  ) THEN
    ALTER TABLE transactions ADD CONSTRAINT chk_transactions_date_gregorian CHECK (date IS NULL OR date::text = '' OR (SUBSTRING(trim(date::text) FROM 1 FOR 4) ~ '^[0-9]{4}$' AND SUBSTRING(trim(date::text) FROM 1 FOR 4)::int >= 1900));
  END IF;
END $$;

-- پاکسازی تابع موقت
DROP FUNCTION IF EXISTS _repair_jalali_to_gregorian(text);
