-- Drizzle Migration 0054: unique personnel code among active personnel (v9.0.28 / TD-439, product-owner decision D6 «الف»)
--
-- The personnel code was checked with "read, then write" and no lock or constraint, so concurrent requests with one
-- code created two active personnel, and the Excel import (which finds an existing personnel by its code) then updated
-- only one of them. A non-empty personnel code is now unique among active personnel (is_deleted = 0), compared as
-- lower(btrim(personnel_code)) like the application (src/services/personnel/personnelCode.ts), which maps a violation of
-- this index to the Persian duplicate-code error. Soft-deleted personnel do not count, so a deleted person's code can be
-- reused; an empty code is not a code.
--
-- The index is created only when existing active personnel have no duplicate code: old codes are never changed here.
-- When duplicates exist the index is skipped (startup is not blocked) and the financial health check lists them
-- (personnel_code_uniqueness). Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_personnel_code_active')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM personnel WHERE is_deleted = 0 AND btrim(personnel_code) <> ''
      GROUP BY lower(btrim(personnel_code)) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'personnel has duplicate codes among active personnel; uq_personnel_code_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_personnel_code_active ON personnel (lower(btrim(personnel_code)))
        WHERE is_deleted = 0 AND btrim(personnel_code) <> '';
    END IF;
  END IF;
END $$;
