-- Drizzle Migration 0069: unique code and name among active items (v9.0.160 / TD-653, product-owner decision t4 option a)
--
-- Two active items (is_deleted = 0) must never share a code or a name. The code key is upper(btrim(code)): codes that
-- differ only in letter case or surrounding spaces are one code (WooCommerce matches orders to items.code and project
-- reservations key codes in upper case). The name key is lower(btrim(name)), as for customers (TD-420). Soft-deleted
-- items do not count. The application checks the same expressions before insert/update
-- (src/services/items/itemIdentity.ts) and maps a violation of these indexes to the Persian duplicate error (409), so
-- concurrent requests can no longer create two rows.
--
-- Each index is created only when existing active items have no duplicate for its key: old rows are never renamed or
-- recoded here. When duplicates exist the index is skipped (startup is not blocked) and the financial health check lists
-- them (item_identity_uniqueness). Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass('uq_items_code_active') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM items WHERE is_deleted = 0 GROUP BY upper(btrim(code)) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'items has duplicate codes among active items; uq_items_code_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_items_code_active ON items (upper(btrim(code))) WHERE is_deleted = 0;
    END IF;
  END IF;
  IF to_regclass('uq_items_name_active') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM items WHERE is_deleted = 0 GROUP BY lower(btrim(name)) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'items has duplicate names among active items; uq_items_name_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_items_name_active ON items (lower(btrim(name))) WHERE is_deleted = 0;
    END IF;
  END IF;
END $$;
