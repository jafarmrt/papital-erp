-- v12 phase 10d (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the news of the site («خبرهای سایت»), owned by package 18.
--
-- storefront_news: one row per news item. Like a page (0029), `sections` is the draft the editor saves and `published`
-- the copy on the site (null = not on the site); saving a draft never changes the site, «انتشار» copies the draft into
-- `published`. `news_date` is the day (in Tehran) the draft is dated; `published_date` is that day as it was when the
-- item was published; both are text days `YYYY-MM-DD` with their format checks, as every day in this database
-- (AGENTS.md §2.10), and null (never '') when there is none. A news item is on the site from its `published_date` on, so a day in the future means the item
-- comes on by itself that day. Removing a news item is a soft delete.
-- storefront_content_assets now also names the images of a published news item (content_kind 'news'), so the site may
-- be given those and no other (the site's reading of news comes in the next part of 10d).
-- A new table and a wider check; no existing row is changed, and nothing on the site changes. Runs inside the Drizzle
-- migrator transaction.
CREATE TABLE IF NOT EXISTS storefront_news (
  id serial PRIMARY KEY,
  slug text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  cover_asset_id integer REFERENCES media_assets(id),
  news_date text,
  seo_title text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  published jsonb,
  published_at timestamptz,
  published_date text,
  published_by text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_news_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60),
  CONSTRAINT chk_storefront_news_title CHECK (length(title) >= 1 AND length(title) <= 120 AND title !~ '[[:cntrl:]]'),
  CONSTRAINT chk_storefront_news_summary CHECK (length(summary) <= 300),
  CONSTRAINT chk_storefront_news_seo CHECK (length(seo_title) <= 200 AND length(seo_description) <= 400),
  CONSTRAINT chk_storefront_news_sections CHECK (jsonb_typeof(sections) = 'array'),
  CONSTRAINT chk_storefront_news_news_date_datefmt CHECK (erp_date_text_ok(news_date, 'iso'::text)),
  CONSTRAINT chk_storefront_news_published_date_datefmt CHECK (erp_date_text_ok(published_date, 'iso'::text)),
  -- the format check lets '' pass; a day that is not there is null here
  CONSTRAINT chk_storefront_news_days_not_empty CHECK ((news_date IS NULL OR news_date <> '') AND (published_date IS NULL OR published_date <> '')),
  -- a CHECK passes on NULL, so each is said as «all empty or all set» (see 0031)
  CONSTRAINT chk_storefront_news_published CHECK (
    (published IS NULL) = (published_at IS NULL) AND (published IS NULL) = (published_date IS NULL)
    AND (published IS NULL OR jsonb_typeof(published) = 'object')
  ),
  CONSTRAINT chk_storefront_news_version CHECK (version >= 1),
  CONSTRAINT chk_storefront_news_is_deleted_flag CHECK (is_deleted IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_news_slug_live ON storefront_news (slug) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_news_cover_asset_id ON storefront_news (cover_asset_id) WHERE cover_asset_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_news_on_site ON storefront_news (published_date DESC, id DESC) WHERE is_deleted = 0 AND published IS NOT NULL;
--> statement-breakpoint
ALTER TABLE storefront_content_assets DROP CONSTRAINT chk_storefront_content_assets_kind;
--> statement-breakpoint
ALTER TABLE storefront_content_assets ADD CONSTRAINT chk_storefront_content_assets_kind CHECK (content_kind IN ('page', 'news'));
