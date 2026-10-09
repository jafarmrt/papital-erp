-- Drizzle Migration 0097: product fields of the media library (v10.0.17, N-05 PR 2)
--
-- Adds to items the product card of the media library: its collections (a tag list, product-owner decision ت۲: a product
-- may be in several collections), design year, transfer code, description and technical notes. The new columns start
-- empty, and only design_year / transfer_code of active products whose code has the product pattern
-- (YYYY-L-TTT-SS, PRODUCT_CODE_PATTERN in src/lib/items/itemCodeFormat.ts) are filled once from the code (approved plan,
-- section 2); no existing column is changed and both stay editable. The fill runs through
-- erp_update_with_unvalidated_checks (0047) because items can hold NOT VALID CHECK constraints. Runs inside the Drizzle
-- migrator transaction.

ALTER TABLE items ADD COLUMN IF NOT EXISTS collections text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS design_year integer;
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS transfer_code text;
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS product_description text;
--> statement-breakpoint
ALTER TABLE items ADD COLUMN IF NOT EXISTS technical_notes text;
--> statement-breakpoint
ALTER TABLE items ADD CONSTRAINT chk_items_design_year CHECK (design_year IS NULL OR design_year BETWEEN 1300 AND 1500);
--> statement-breakpoint
ALTER TABLE items ADD CONSTRAINT chk_items_collections_count CHECK (cardinality(collections) <= 20);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_items_collections ON items USING gin (collections);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_items_design_year ON items (design_year) WHERE design_year IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_items_transfer_code ON items (transfer_code) WHERE transfer_code IS NOT NULL;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('items', $sql$
  UPDATE items
     SET design_year = substring(btrim(code) from '^(\d{4})-')::integer,
         transfer_code = substring(btrim(code) from '^\d{4}-[A-Za-z]+-(\d{3})-\d{2}$')
   WHERE is_deleted = 0
     AND type = 'product'
     AND btrim(code) ~ '^\d{4}-[A-Za-z]+-\d{3}-\d{2}$'
     AND substring(btrim(code) from '^(\d{4})-')::integer BETWEEN 1300 AND 1500
$sql$);
