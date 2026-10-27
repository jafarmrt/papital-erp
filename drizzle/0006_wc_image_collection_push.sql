-- v11 phase 6.5 (D-04 part D, decisions ت۴۴ to ت۴۶): the online shop's featured image and product tags on each product link.
--
-- Adds columns with defaults to wc_product_links and widens one CHECK of wc_sync_runs; no existing row is rewritten.
-- 1. wc_product_links: the id of the shop product's featured image as last read or written (site_image_id: 0 for none,
--    null until read), the SHA-256 of the item cover the automatic image push last brought in line (cover_sent_sha256:
--    '' never compared yet, 'none' compared while the item had no cover), the product tag ids the collection push added
--    and the collections it sent them for (sent_tag_ids, sent_collections: null until compared), and for each send its
--    last refusal and refusals in a row (image_error / image_failure_count, collection_error / collection_failure_count).
-- 2. wc_sync_runs.kind also takes 'image_push' and 'collection_push'.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS site_image_id integer;
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS cover_sent_sha256 text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS image_error text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS image_failure_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS sent_tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS sent_collections text;
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS collection_error text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE wc_product_links ADD COLUMN IF NOT EXISTS collection_failure_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wc_product_links_media_failure_counts' AND conrelid = 'wc_product_links'::regclass
  ) THEN
    ALTER TABLE wc_product_links ADD CONSTRAINT chk_wc_product_links_media_failure_counts
      CHECK (image_failure_count >= 0 AND collection_failure_count >= 0);
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE wc_sync_runs DROP CONSTRAINT IF EXISTS chk_wc_sync_runs_kind;
--> statement-breakpoint
ALTER TABLE wc_sync_runs ADD CONSTRAINT chk_wc_sync_runs_kind
  CHECK (kind IN ('refresh', 'stock_push', 'price_push', 'sku_push', 'image_push', 'collection_push'));
