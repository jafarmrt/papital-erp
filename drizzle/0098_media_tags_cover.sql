-- Drizzle Migration 0098: tags and the single cover of the media library (v10.0.27, N-05 PR 3)
--
-- Adds a tag list to media_assets (at most 20 tags, the limit of src/lib/media/mediaTags.ts) with a gin index for the tag
-- filter, and makes the cover of a product unique: one live file per item may carry is_cover = 1. No code wrote is_cover
-- before this release (it was only read, default 0), so the unique index is built on clean data. Runs inside the Drizzle
-- migrator transaction.

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint
ALTER TABLE media_assets ADD CONSTRAINT chk_media_assets_tags_count CHECK (cardinality(tags) <= 20);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_media_assets_tags ON media_assets USING gin (tags);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_cover_item ON media_assets (item_id) WHERE is_cover = 1 AND is_deleted = 0 AND item_id IS NOT NULL;
