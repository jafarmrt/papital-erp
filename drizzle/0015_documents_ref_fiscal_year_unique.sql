-- Drizzle Migration 0015: Fiscal-Year Scoped Document Reference Uniqueness (v7.0.21 / TD-178 — audit P0-2)
--
-- Problem: document_ref_counters restarts numbering every Jalali fiscal year (TD-152),
-- but uq_documents_type_ref_number_active (0001) enforced UNIQUE (type, ref_number)
-- across ALL years. The first invoice of a new fiscal year ("1") therefore collided
-- with invoice "1" of the previous year (23505) and invoice issuing stopped.
--
-- Fix: documents.ref_fiscal_year stores the numbering partition (the fiscal year the
-- counter used when the reference was allocated) and the unique index becomes
-- (type, ref_fiscal_year, ref_number). Runs inside the Drizzle migrator transaction.

-- 1) Immutable helper mirroring the ISO branch of resolveJalaliFiscalYear()
--    (src/lib/businessClock.ts): Gregorian year - 621, minus one before 21 March.
CREATE OR REPLACE FUNCTION erp_ref_fiscal_year(ts timestamp without time zone)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN ts IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM ts)::integer - 621
         - CASE WHEN EXTRACT(MONTH FROM ts) < 3
                  OR (EXTRACT(MONTH FROM ts) = 3 AND EXTRACT(DAY FROM ts) < 21)
                THEN 1 ELSE 0 END
  END
$$;

-- 2) Column + backfill of existing rows from their stored date
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ref_fiscal_year integer;

UPDATE documents
SET ref_fiscal_year = erp_ref_fiscal_year(date)
WHERE ref_fiscal_year IS NULL;

-- 3) Safety net for insert paths that do not set the column explicitly
--    (the application always sets it from the same fiscal year used by the counter).
CREATE OR REPLACE FUNCTION erp_documents_fill_ref_fiscal_year()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ref_fiscal_year IS NULL THEN
    NEW.ref_fiscal_year := erp_ref_fiscal_year(NEW.date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_fill_ref_fiscal_year ON documents;
CREATE TRIGGER trg_documents_fill_ref_fiscal_year
  BEFORE INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION erp_documents_fill_ref_fiscal_year();

-- 4) Swap the unique index — the old one is dropped ONLY if the new one could be created
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT type, ref_fiscal_year, ref_number FROM documents
    WHERE is_deleted = 0 AND ref_number IS NOT NULL AND ref_number <> ''
    GROUP BY type, ref_fiscal_year, ref_number HAVING COUNT(*) > 1
  ) d;

  IF dup_count = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_documents_type_fy_ref_active') THEN
      EXECUTE 'CREATE UNIQUE INDEX uq_documents_type_fy_ref_active ON documents (type, ref_fiscal_year, ref_number) WHERE is_deleted = 0 AND length(ref_number) > 0';
      RAISE NOTICE 'TD-178: unique index uq_documents_type_fy_ref_active created';
    END IF;
    -- TD-590: named in the current schema, never found along the search path
    EXECUTE format('DROP INDEX IF EXISTS %I.uq_documents_type_ref_number_active', current_schema());
    RAISE NOTICE 'TD-178: legacy cross-year index uq_documents_type_ref_number_active dropped';
  ELSE
    RAISE WARNING 'TD-178: % duplicate (type, ref_fiscal_year, ref_number) groups found — index swap SKIPPED, legacy index kept until data is repaired', dup_count;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_docs_type_ref_fiscal_year ON documents (type, ref_fiscal_year);
