-- v11 phase 8.5b (docs/roadmap/V11_STOREFRONT_8_5_START_PLAN.md §5, owner's decision 2026-11-04): «صفحه‌های ویژه», the
-- campaign pages of the new site (Yalda first), owned by package 18.
--
-- storefront_campaigns: one live row per page (slug: Latin small letters, digits and «-», unique among live rows; the site
--   shows it at /campaigns/<slug>). A page has a title, a short summary (its search description), a plain-text body, an
--   optional hero image of the media library (hero_asset_id), and its products: the items of one ERP collection
--   (source = 'collection') or up to 48 chosen items in the owner's order (source = 'products', item_ids). discount_code
--   is only shown on the page (the code itself lives in storefront_discount_codes and is checked when an order uses it;
--   the site shows it only while that code is open to retail buyers). starts_at / ends_at are the page's window, Tehran
--   days as in the discount codes; home_banner puts the page on the home page while it is open. Removing a page is a soft
--   delete. Nothing existing changes. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_campaigns (
  id serial PRIMARY KEY,
  slug text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  hero_asset_id integer REFERENCES media_assets(id),
  source text NOT NULL,
  collection text NOT NULL DEFAULT '',
  item_ids integer[] NOT NULL DEFAULT '{}',
  discount_code text NOT NULL DEFAULT '',
  starts_at timestamptz,
  ends_at timestamptz,
  home_banner integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_storefront_campaigns_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  CONSTRAINT chk_storefront_campaigns_texts CHECK (
    length(title) BETWEEN 1 AND 120 AND length(summary) <= 300 AND length(body) <= 6000
  ),
  CONSTRAINT chk_storefront_campaigns_source CHECK (
    (source = 'collection' AND length(collection) BETWEEN 1 AND 120 AND cardinality(item_ids) = 0)
    OR (source = 'products' AND collection = '' AND cardinality(item_ids) BETWEEN 1 AND 48)
  ),
  CONSTRAINT chk_storefront_campaigns_discount_code CHECK (discount_code = '' OR discount_code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  CONSTRAINT chk_storefront_campaigns_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT chk_storefront_campaigns_home_banner_flag CHECK (home_banner IN (0, 1)),
  CONSTRAINT chk_storefront_campaigns_is_active_flag CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_storefront_campaigns_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_storefront_campaigns_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_campaigns_slug_live ON storefront_campaigns (slug) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_campaigns_list ON storefront_campaigns (is_deleted, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_campaigns_hero_asset_id ON storefront_campaigns (hero_asset_id) WHERE hero_asset_id IS NOT NULL;
