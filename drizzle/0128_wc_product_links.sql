-- Drizzle Migration 0128: links between items and the online shop's products (10.2 package 6, D-04 part A)
--
-- New tables only; no existing row is written.
-- 1. wc_product_links: one live row per item that matches a product (or a product variation) of the WooCommerce
--    shop by SKU, built by «بازخوانی محصولات سایت». It keeps the shop's product id (and variation id, 0 for a simple
--    product), the SKU and the stock the shop holds as last read or written, and the last push error. A link that no
--    longer matches is closed (is_deleted = 1), never deleted; one live link per item and per shop product.
-- 2. wc_sync_runs: one row per catalog refresh or stock push, with its counts and the shop products that matched no
--    item, for the WooCommerce tab.
-- Foreign keys are validated at once because the tables are new, and each foreign key column has an index that leads
-- with it (TD-614). Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS wc_product_links (
  id serial PRIMARY KEY,
  item_id integer NOT NULL,
  wc_product_id integer NOT NULL,
  wc_variation_id integer NOT NULL DEFAULT 0,
  site_sku text NOT NULL DEFAULT '',
  site_stock integer,
  site_manage_stock integer NOT NULL DEFAULT 0,
  last_read_at timestamp,
  last_pushed_at timestamp,
  last_error text NOT NULL DEFAULT '',
  failure_count integer NOT NULL DEFAULT 0,
  is_deleted integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_wc_product_links_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_wc_product_links_site_manage_stock_flag CHECK (site_manage_stock IN (0, 1)),
  CONSTRAINT chk_wc_product_links_ids CHECK (wc_product_id > 0 AND wc_variation_id >= 0),
  CONSTRAINT chk_wc_product_links_failure_count CHECK (failure_count >= 0),
  CONSTRAINT fk_wc_product_links_item FOREIGN KEY (item_id) REFERENCES items (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wc_product_links_item ON wc_product_links (item_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_wc_product_links_item_live ON wc_product_links (item_id) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_wc_product_links_product_live ON wc_product_links (wc_product_id, wc_variation_id) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS wc_sync_runs (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL,
  user_id integer,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text NOT NULL DEFAULT '',
  CONSTRAINT chk_wc_sync_runs_kind CHECK (kind IN ('refresh', 'stock_push')),
  CONSTRAINT chk_wc_sync_runs_status CHECK (status IN ('ok', 'partial', 'failed')),
  CONSTRAINT fk_wc_sync_runs_user FOREIGN KEY (user_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wc_sync_runs_user ON wc_sync_runs (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wc_sync_runs_kind ON wc_sync_runs (kind, id);
