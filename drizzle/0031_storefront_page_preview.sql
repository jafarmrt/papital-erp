-- v12 phase 10c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, «پیش‌نمایش»): a one-hour link on the site that shows a
-- page's draft. The key of the link is never kept, only its SHA-256 (preview_hash) and the time it ends
-- (preview_expires_at); a page has at most one link, and a new one replaces the old. The two columns are set together
-- or not at all, and a key belongs to one page.
ALTER TABLE storefront_pages ADD COLUMN preview_hash text;
--> statement-breakpoint
ALTER TABLE storefront_pages ADD COLUMN preview_expires_at timestamptz;
--> statement-breakpoint
-- A CHECK passes when its condition is NULL, so «a AND b OR c AND d» lets through a row with one of a pair empty (the
-- comparison with the empty one is NULL). Each pair is therefore said as «both empty or both set», which is never NULL.
ALTER TABLE storefront_pages ADD CONSTRAINT chk_storefront_pages_preview
  CHECK ((preview_hash IS NULL) = (preview_expires_at IS NULL) AND (preview_hash IS NULL OR preview_hash ~ '^[0-9a-f]{64}$'));
--> statement-breakpoint
-- The same mistake was in 0029's check of the published copy (found by the review of 10c): `published` empty with
-- `published_at` set passed. 0029 is not edited (§2.11); its constraint is replaced here with the form that holds. The
-- page service always sets or empties the two together, so no row it wrote is refused.
ALTER TABLE storefront_pages DROP CONSTRAINT chk_storefront_pages_published;
--> statement-breakpoint
ALTER TABLE storefront_pages ADD CONSTRAINT chk_storefront_pages_published
  CHECK ((published IS NULL) = (published_at IS NULL) AND (published IS NULL OR jsonb_typeof(published) = 'object'));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_storefront_pages_preview_hash ON storefront_pages (preview_hash) WHERE preview_hash IS NOT NULL;
