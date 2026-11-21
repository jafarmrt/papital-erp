-- v12 phase 10c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2): a menu link to a page written in «صفحه‌های سایت».
-- The new link kind 'content' («صفحهٔ متنی») names the page by its row (target_page_id), so the link follows the page
-- when its address changes; its address is built when the site reads the menus. Migration 0028 is not edited (§2.11):
-- the two CHECK constraints that list the kinds are replaced here, each with every kind it had and the new one, and
-- every kind that is not 'content' must leave target_page_id empty.
ALTER TABLE storefront_menu_items ADD COLUMN target_page_id integer REFERENCES storefront_pages(id);
--> statement-breakpoint
CREATE INDEX idx_storefront_menu_items_target_page_id ON storefront_menu_items (target_page_id) WHERE target_page_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE storefront_menu_items DROP CONSTRAINT chk_storefront_menu_items_link_kind;
--> statement-breakpoint
ALTER TABLE storefront_menu_items ADD CONSTRAINT chk_storefront_menu_items_link_kind
  CHECK (link_kind IN ('none', 'page', 'category', 'collection', 'campaign', 'product', 'path', 'url', 'content'));
--> statement-breakpoint
ALTER TABLE storefront_menu_items DROP CONSTRAINT chk_storefront_menu_items_target;
--> statement-breakpoint
ALTER TABLE storefront_menu_items ADD CONSTRAINT chk_storefront_menu_items_target CHECK (
  (link_kind = 'none' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL)
  OR (link_kind = 'product' AND target = '' AND target_item_id IS NOT NULL AND target_campaign_id IS NULL AND target_page_id IS NULL)
  OR (link_kind = 'campaign' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NOT NULL AND target_page_id IS NULL)
  OR (link_kind = 'content' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NOT NULL)
  OR (link_kind IN ('page', 'category', 'collection') AND length(target) >= 1 AND length(target) <= 300 AND target !~ '[[:cntrl:]]' AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL)
  OR (link_kind = 'path' AND target LIKE '/%' AND target NOT LIKE '%//%' AND target !~ '[[:space:][:cntrl:]\\]' AND length(target) <= 300 AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL)
  OR (link_kind = 'url' AND target ~ '^https://[^/?#@[:space:][:cntrl:]\\]+([/?#][^[:space:][:cntrl:]\\]*)?$' AND length(target) <= 500 AND target_item_id IS NULL AND target_campaign_id IS NULL AND target_page_id IS NULL)
);
