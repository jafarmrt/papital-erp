-- v11 phase 8.5 (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md): the old addresses of the WooCommerce site and where
-- each one goes on the new site, owned by package 18.
--
-- storefront_redirects: one live row per old address (from_path, the key of storefrontSeoRules.legacyPathKey: the path
-- percent-decoded, in lower case, without a trailing slash). A row sends to a product (target_item_id: the item's current
-- address on the site, so a later change of slug keeps the redirect), a collection or a category (target: its name), or
-- another path of the site (target, which always starts with one «/»). source: made by hand, or by the reading of the
-- WooCommerce site, which never changes a row made by hand. Removing a row is a soft delete.
-- A new table only; no existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_redirects (
  id serial PRIMARY KEY,
  from_path text NOT NULL,
  target_kind text NOT NULL,
  target_item_id integer REFERENCES items(id),
  target text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  note text NOT NULL DEFAULT '',
  is_active integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_storefront_redirects_from_path CHECK (from_path LIKE '/%' AND length(from_path) BETWEEN 2 AND 300),
  CONSTRAINT chk_storefront_redirects_target_kind CHECK (target_kind IN ('product', 'collection', 'category', 'path')),
  CONSTRAINT chk_storefront_redirects_target CHECK (
    (target_kind = 'product' AND target_item_id IS NOT NULL AND target = '')
    OR (target_kind IN ('collection', 'category') AND target_item_id IS NULL AND length(target) BETWEEN 1 AND 300)
    OR (target_kind = 'path' AND target_item_id IS NULL AND target LIKE '/%' AND target NOT LIKE '//%' AND length(target) <= 300)
  ),
  CONSTRAINT chk_storefront_redirects_source CHECK (source IN ('manual', 'woocommerce')),
  CONSTRAINT chk_storefront_redirects_is_active_flag CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_storefront_redirects_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_storefront_redirects_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_redirects_from_live ON storefront_redirects (from_path) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_redirects_target_item_id ON storefront_redirects (target_item_id) WHERE target_item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_redirects_list ON storefront_redirects (is_deleted, id DESC);
