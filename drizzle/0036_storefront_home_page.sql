-- v12 phase 10e, part 2 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): «صفحهٔ اصلی» in the ERP.
--
-- The home page is one more row of storefront_pages, of a fourth kind, 'home': it is written with the same builder and
-- published the same way as every other page, and its sections may be of the kinds only the home page takes (a slider,
-- a banner, «معرفی کالکشن», «تازه‌ترین خبرها» and the parts the site's own home page has today; the server checks every
-- one before it is written). The row starts unpublished, and while it is unpublished the site keeps the home page in
-- its own code, so this migration changes nothing on the site. Like a base and a fixed row it is never removed
-- (chk_storefront_pages_base_kept of 0032 already keeps every row that is not 'custom'). Its name is under `fixed-`, a
-- start no page of the shop may take since 0032. A page someone named `fixed-home` before 0032 (possible only on a test
-- install, as 0032 says of its own rows) keeps its row; the home row is then not made, and the screen and the site go
-- on without it until that page is moved or removed and the row is written by hand.
-- Migrations 0029 and 0032 are not edited (AGENTS.md §2.11): the CHECK that lists the kinds is replaced with every kind
-- it had and the new one. No existing row is changed. Runs inside the Drizzle migrator transaction.
ALTER TABLE storefront_pages DROP CONSTRAINT chk_storefront_pages_kind;
--> statement-breakpoint
ALTER TABLE storefront_pages ADD CONSTRAINT chk_storefront_pages_kind CHECK (kind IN ('base', 'custom', 'fixed', 'home'));
--> statement-breakpoint
-- one home page: a second row of the kind cannot be written by any path
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_pages_home ON storefront_pages (kind) WHERE kind = 'home';
--> statement-breakpoint
INSERT INTO storefront_pages (kind, slug, title) VALUES ('home', 'fixed-home', 'صفحهٔ اصلی')
ON CONFLICT (slug) WHERE is_deleted = 0 DO NOTHING;
