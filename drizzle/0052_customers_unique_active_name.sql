-- Drizzle Migration 0052: unique names among active customers (v9.0.8 / TD-420, product-owner decision t3 «الف»)
--
-- Two active parties (is_deleted = 0) must never share a name. The key is lower(btrim(name)): names that differ only
-- in letter case or surrounding spaces look the same to users and are treated as one name (the Excel import already
-- matched names this way). Soft-deleted parties do not count, so the name of a deleted party can be reused. The
-- application checks the same expression before insert/update (src/services/customers/customerIdentity.ts) and maps a
-- violation of this index to the Persian duplicate-name error, so concurrent requests can no longer create two rows.
--
-- The index is created only when existing active parties have no duplicate name: old rows are never renamed or merged
-- here. When duplicates exist the index is skipped (startup is not blocked) and the financial health check lists them
-- (customer_name_uniqueness). Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass('uq_customers_name_active') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM customers WHERE is_deleted = 0 GROUP BY lower(btrim(name)) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'customers has duplicate names among active parties; uq_customers_name_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_customers_name_active ON customers (lower(btrim(name))) WHERE is_deleted = 0;
    END IF;
  END IF;
END $$;
