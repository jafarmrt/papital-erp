-- v12 phase 10d, part 3 (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): the news in the site's menus and the words of
-- the site's list of news.
--
-- 1) A menu link to one news item of «خبرهای سایت»: the new link kind 'news' («خبر») names the item by its row
--    (target_news_id), so its address is built when the site reads the menus, and the link leads nowhere while the item
--    is not on the site. The list of news itself is one of the site's fixed pages (kind 'page', target 'news'), which
--    needs no change here. Migrations 0028 and 0030 are not edited (AGENTS.md §2.11): the two CHECK constraints that
--    list the kinds are replaced, each with every kind it had and the new one, and every kind that is not 'news' must
--    leave target_news_id empty.
-- 2) The tenth fixed page (0032, owner's decision 23): the row of the words above the site's `/news`. Like the nine
--    before it, it is unpublished, so the site keeps the words it has until the shop writes and publishes them.
--
-- No existing row is changed, and nothing on the site changes. Runs inside the Drizzle migrator transaction.
ALTER TABLE storefront_menu_items ADD COLUMN target_news_id integer REFERENCES storefront_news(id);
--> statement-breakpoint
CREATE INDEX idx_storefront_menu_items_target_news_id ON storefront_menu_items (target_news_id) WHERE target_news_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE storefront_menu_items DROP CONSTRAINT chk_storefront_menu_items_link_kind;
--> statement-breakpoint
ALTER TABLE storefront_menu_items ADD CONSTRAINT chk_storefront_menu_items_link_kind
  CHECK (link_kind IN ('none', 'page', 'category', 'collection', 'campaign', 'product', 'path', 'url', 'content', 'news'));
--> statement-breakpoint
ALTER TABLE storefront_menu_items DROP CONSTRAINT chk_storefront_menu_items_target;
--> statement-breakpoint
ALTER TABLE storefront_menu_items ADD CONSTRAINT chk_storefront_menu_items_target CHECK (
  (link_kind = 'none' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL AND target_news_id IS NULL)
  OR (link_kind = 'product' AND target = '' AND target_item_id IS NOT NULL AND target_campaign_id IS NULL AND target_page_id IS NULL AND target_news_id IS NULL)
  OR (link_kind = 'campaign' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NOT NULL AND target_page_id IS NULL AND target_news_id IS NULL)
  OR (link_kind = 'content' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NOT NULL AND target_news_id IS NULL)
  OR (link_kind = 'news' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL AND target_news_id IS NOT NULL)
  OR (link_kind IN ('page', 'category', 'collection') AND length(target) >= 1 AND length(target) <= 300 AND target !~ '[[:cntrl:]]' AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL AND target_news_id IS NULL)
  OR (link_kind = 'path' AND target LIKE '/%' AND target NOT LIKE '%//%' AND target !~ '[[:space:][:cntrl:]\\]' AND length(target) <= 300 AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL AND target_news_id IS NULL)
  OR (link_kind = 'url' AND target ~ '^https://[^/?#@[:space:][:cntrl:]\\]+([/?#][^[:space:][:cntrl:]\\]*)?$' AND length(target) <= 500 AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL AND target_news_id IS NULL)
);
--> statement-breakpoint
INSERT INTO storefront_pages (kind, slug, title) VALUES ('fixed', 'fixed-news', 'خبرها')
ON CONFLICT (slug) WHERE is_deleted = 0 DO NOTHING;
