-- Drizzle Migration 0073: unique name among live item categories (v9.0.205 / TD-658, product-owner decision t8 option a)
--
-- Items point to their category by name (items.category), so two live categories with one name made the item's
-- category ambiguous. The key is lower(btrim(name)), as for item and customer names; soft-deleted categories
-- (is_deleted = 1, migration 0072) do not count, so a deleted name can be used again. The application checks the same
-- expression before insert/update (src/services/items/itemCategoryIdentity.ts) and maps a violation of this index to
-- the Persian duplicate error (409), so concurrent requests can no longer create two rows.
--
-- The index is created only when existing live categories have no duplicate name: old rows are never renamed here.
-- When duplicates exist the index is skipped (startup is not blocked) and the financial health check lists them
-- (category_name_uniqueness). Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass('uq_categories_name_active') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM categories WHERE is_deleted = 0 GROUP BY lower(btrim(name)) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'categories has duplicate names among live rows; uq_categories_name_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_categories_name_active ON categories (lower(btrim(name))) WHERE is_deleted = 0;
    END IF;
  END IF;
END $$;
