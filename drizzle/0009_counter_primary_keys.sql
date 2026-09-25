-- V5.0.13 (TD-113): کلید اصلی جدول‌های شمارنده روی نصب‌های تازه (پایه آن را نداشت)
-- تکرار اجرا بی‌خطر است؛ داخل تراکنش اتمیک مهاجرت Drizzle اجرا می‌شود.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'document_ref_counters'::regclass AND contype = 'p'
  ) THEN
    -- ادغام ردیف‌های تکراری: بزرگ‌ترین شماره نگه داشته می‌شود
    CREATE TEMP TABLE _drc_dedup ON COMMIT DROP AS
      SELECT doc_type, fiscal_year, MAX(last_ref_number) AS last_ref_number
      FROM document_ref_counters GROUP BY doc_type, fiscal_year;
    DELETE FROM document_ref_counters;
    INSERT INTO document_ref_counters (doc_type, fiscal_year, last_ref_number)
      SELECT doc_type, fiscal_year, last_ref_number FROM _drc_dedup;
    ALTER TABLE document_ref_counters
      ADD CONSTRAINT document_ref_counters_pkey PRIMARY KEY (doc_type, fiscal_year);
    RAISE NOTICE 'TD-113: document_ref_counters_pkey created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'item_code_counters'::regclass AND contype = 'p'
  ) THEN
    CREATE TEMP TABLE _icc_dedup ON COMMIT DROP AS
      SELECT scope, prefix_key, MAX(last_number) AS last_number
      FROM item_code_counters GROUP BY scope, prefix_key;
    DELETE FROM item_code_counters;
    INSERT INTO item_code_counters (scope, prefix_key, last_number)
      SELECT scope, prefix_key, last_number FROM _icc_dedup;
    ALTER TABLE item_code_counters
      ADD CONSTRAINT item_code_counters_pkey PRIMARY KEY (scope, prefix_key);
    RAISE NOTICE 'TD-113: item_code_counters_pkey created';
  END IF;
END $$;
