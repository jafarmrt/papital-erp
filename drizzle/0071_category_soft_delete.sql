-- Drizzle Migration 0071: categories are soft-deleted (v9.0.177 / TD-659, product-owner decision t8 option a)
--
-- DELETE /categories/:id used to remove the row physically, so a deleted category left no trace. A category is now
-- deleted by setting is_deleted = 1; reads list only is_deleted = 0 and the boot seed still sees the table as not empty.
-- The flag carries the standard 0/1 CHECK (AGENTS.md section 1.9); the new column has only the default, so it is
-- validated. Existing rows stay as they are. Runs inside the migrator transaction.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_deleted integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_categories_is_deleted_flag' AND conrelid = 'categories'::regclass) THEN
    ALTER TABLE categories ADD CONSTRAINT chk_categories_is_deleted_flag CHECK (is_deleted IN (0, 1));
  END IF;
END $$;
