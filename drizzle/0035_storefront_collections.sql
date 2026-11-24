-- v12 phase 10e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «متن و تصویر کالکشن‌ها», owned by package 18.
--
-- storefront_collections: the shop's own words for a collection of the site: a few paragraphs of introduction, an image
-- of the media library with its alternative text, and an optional link «آشنایی بیشتر» to a page of «صفحه‌های سایت».
-- A collection itself is a name on the items (`items.collections`); a row here is found by that name, one per name. A
-- row is never removed: emptied, it shows nothing. The site shows a row's words above the collection's own page, only
-- while the collection has an item on the site.
-- A new table; no existing row is changed, and nothing on the site changes until the shop writes a text. Runs inside
-- the Drizzle migrator transaction.
CREATE TABLE IF NOT EXISTS storefront_collections (
  id serial PRIMARY KEY,
  name text NOT NULL,
  intro text NOT NULL DEFAULT '',
  image_asset_id integer REFERENCES media_assets(id),
  image_alt text NOT NULL DEFAULT '',
  more_page_id integer REFERENCES storefront_pages(id),
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_collections_name CHECK (length(name) >= 1 AND length(name) <= 120 AND name !~ '[[:cntrl:]]'),
  -- a line break is the one control character a text of paragraphs holds
  CONSTRAINT chk_storefront_collections_intro CHECK (length(intro) <= 1500 AND replace(intro, E'\n', '') !~ '[[:cntrl:]]'),
  CONSTRAINT chk_storefront_collections_image_alt CHECK (length(image_alt) <= 120 AND image_alt !~ '[[:cntrl:]]'),
  CONSTRAINT chk_storefront_collections_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_collections_name ON storefront_collections (name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_collections_image_asset_id ON storefront_collections (image_asset_id) WHERE image_asset_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_collections_more_page_id ON storefront_collections (more_page_id) WHERE more_page_id IS NOT NULL;
