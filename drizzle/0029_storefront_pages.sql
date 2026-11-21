-- v12 phase 10b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, owner's decisions 4, 23 and 24): the pages of the site,
-- owned by package 18.
--
-- storefront_pages: one row per page. `sections` is the draft the builder edits (an ordered list of sections of fixed
-- kinds; the server checks every one before it is written). `published` is the copy on the site, null while the page is
-- not on the site: saving a draft never changes it, «انتشار» copies the draft into it, taking it off the site empties
-- it. A page is 'base' (the five every shop needs; never removed, their address fixed) or 'custom'. Removing a custom
-- page is a soft delete.
-- storefront_content_assets: which image of the media library a published content names (content_kind 'page' now; news
-- and the home page later). The site may read an image only while such a row is live (10c), so an image of a draft is
-- never served. A row that is no longer named is switched off (is_deleted = 1), never removed.
-- The five base pages start unpublished, and while a page is unpublished the site keeps its own fixed text
-- (storefront/app/content/pages.ts), so this migration changes nothing on the site.
-- New tables only; no existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_pages (
  id serial PRIMARY KEY,
  kind text NOT NULL DEFAULT 'custom',
  slug text NOT NULL,
  title text NOT NULL,
  seo_title text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  noindex integer NOT NULL DEFAULT 0,
  share_image_asset_id integer REFERENCES media_assets(id),
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  published jsonb,
  published_at timestamptz,
  published_by text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_pages_kind CHECK (kind IN ('base', 'custom')),
  CONSTRAINT chk_storefront_pages_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  CONSTRAINT chk_storefront_pages_title CHECK (length(title) >= 1 AND length(title) <= 120 AND title !~ '[[:cntrl:]]'),
  CONSTRAINT chk_storefront_pages_seo CHECK (length(seo_title) <= 200 AND length(seo_description) <= 400),
  CONSTRAINT chk_storefront_pages_noindex_flag CHECK (noindex IN (0, 1)),
  CONSTRAINT chk_storefront_pages_sections CHECK (jsonb_typeof(sections) = 'array'),
  CONSTRAINT chk_storefront_pages_published CHECK (
    (published IS NULL AND published_at IS NULL) OR (jsonb_typeof(published) = 'object' AND published_at IS NOT NULL)
  ),
  CONSTRAINT chk_storefront_pages_base_kept CHECK (kind <> 'base' OR is_deleted = 0),
  CONSTRAINT chk_storefront_pages_version CHECK (version >= 1),
  CONSTRAINT chk_storefront_pages_is_deleted_flag CHECK (is_deleted IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_pages_slug_live ON storefront_pages (slug) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_pages_share_image_asset_id ON storefront_pages (share_image_asset_id) WHERE share_image_asset_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO storefront_pages (kind, slug, title) VALUES
  ('base', 'about', 'درباره ما'),
  ('base', 'contact', 'تماس با ما'),
  ('base', 'shipping', 'ارسال و پرداخت'),
  ('base', 'terms', 'قوانین خرید'),
  ('base', 'privacy', 'حریم خصوصی')
ON CONFLICT (slug) WHERE is_deleted = 0 DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_content_assets (
  id serial PRIMARY KEY,
  content_kind text NOT NULL,
  content_id integer NOT NULL,
  asset_id integer NOT NULL REFERENCES media_assets(id),
  is_deleted integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_content_assets_kind CHECK (content_kind IN ('page')),
  CONSTRAINT chk_storefront_content_assets_content_id CHECK (content_id >= 1),
  CONSTRAINT chk_storefront_content_assets_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT uq_storefront_content_assets UNIQUE (content_kind, content_id, asset_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_content_assets_asset_id ON storefront_content_assets (asset_id) WHERE is_deleted = 0;
