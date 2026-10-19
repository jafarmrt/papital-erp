-- Drizzle Migration 0131: the online shop's price and SKU on each product link (10.2 package 6, D-04 part C)
--
-- Adds columns with defaults to wc_product_links and widens one CHECK of wc_sync_runs; no existing row is rewritten.
-- 1. wc_product_links: the shop product's type as last read (site_type: simple, variable, variation …), its regular
--    price as the shop holds it (site_regular_price, null until read), and for the automatic price push and SKU rename
--    the last refusal and the refusals in a row of each (price_error / price_failure_count, sku_error /
--    sku_failure_count), kept apart from the stock push's own last_error / failure_count.
-- 2. wc_sync_runs.kind also takes 'price_push' and 'sku_push' (one row per automatic price or SKU run).
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS site_type text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS site_regular_price text;
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS price_error text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS price_failure_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS sku_error text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS sku_failure_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wc_product_links_field_failure_counts' AND conrelid = 'wc_product_links'::regclass
  ) THEN
    ALTER TABLE wc_product_links ADD CONSTRAINT chk_wc_product_links_field_failure_counts
      CHECK (price_failure_count >= 0 AND sku_failure_count >= 0);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE wc_sync_runs DROP CONSTRAINT IF EXISTS chk_wc_sync_runs_kind;
--> statement-breakpoint
ALTER TABLE wc_sync_runs ADD CONSTRAINT chk_wc_sync_runs_kind
  CHECK (kind IN ('refresh', 'stock_push', 'price_push', 'sku_push'));
