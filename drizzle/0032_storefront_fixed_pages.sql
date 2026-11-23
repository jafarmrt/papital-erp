-- v12 phase 10c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2, owner's decision 23): the words of the pages whose work is
-- in the site's code («همهٔ محصولات», «دسته‌ها», «جست‌وجو», «سبد خرید», «درخواست خرید عمده», «هدیهٔ سازمانی», «پیگیری سفارش»,
-- «حساب من» and «پیدا نشد»). Each gets a row of a third kind, 'fixed', in storefront_pages: its title, one text above the
-- page's own work, and the search title and description. The rows start unpublished, and while a row is unpublished the
-- site keeps the words it has today, so this migration changes nothing on the site. A fixed row is never removed, like
-- a base one. Its slug begins with `fixed-`, a start the page rules refuse for every other page from this version on.
-- No existing row is changed. Runs inside the Drizzle migrator transaction.
ALTER TABLE storefront_pages DROP CONSTRAINT chk_storefront_pages_kind;
--> statement-breakpoint
ALTER TABLE storefront_pages ADD CONSTRAINT chk_storefront_pages_kind CHECK (kind IN ('base', 'custom', 'fixed'));
--> statement-breakpoint
ALTER TABLE storefront_pages DROP CONSTRAINT chk_storefront_pages_base_kept;
--> statement-breakpoint
ALTER TABLE storefront_pages ADD CONSTRAINT chk_storefront_pages_base_kept CHECK (kind = 'custom' OR is_deleted = 0);
--> statement-breakpoint
-- A page someone already named `fixed-…` (possible only between 10b and this migration, on a test install) keeps its
-- row, but the name is no longer one a page of the shop may have: the site answers «پیدا نشد» for it and the row can
-- only be moved to another address or removed. The fixed page of that name is then not made, and the screen and the
-- site go on without it.
INSERT INTO storefront_pages (kind, slug, title) VALUES
  ('fixed', 'fixed-products', 'همهٔ محصولات'),
  ('fixed', 'fixed-categories', 'دسته‌ها'),
  ('fixed', 'fixed-search', 'جست‌وجو'),
  ('fixed', 'fixed-cart', 'سبد خرید'),
  ('fixed', 'fixed-wholesale', 'درخواست خرید عمده'),
  ('fixed', 'fixed-corporate-gift', 'هدیهٔ سازمانی'),
  ('fixed', 'fixed-order-track', 'پیگیری سفارش'),
  ('fixed', 'fixed-account', 'حساب من'),
  ('fixed', 'fixed-not-found', 'این صفحه پیدا نشد')
ON CONFLICT (slug) WHERE is_deleted = 0 DO NOTHING;
