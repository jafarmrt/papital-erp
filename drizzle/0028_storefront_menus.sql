-- v12 phase 9b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §6, owner's decisions 3 and 15): the menus of the site, owned by
-- package 18.
--
-- storefront_menus: one row per place on the site (header, drawer = the phone's menu, footer, bottom = the phone's bottom
-- bar) with its switch and the version a whole save of that place checks. The four rows start off (is_enabled = 0), and
-- while a place is off the site keeps its fixed menu, so this migration changes nothing on the site.
-- storefront_menu_items: the items of a place, one submenu level (parent_id names an item of the first level). An item
-- leads to a fixed page of the site (target = its key), a category or a collection (target = its name), a path of the
-- site (target starts with one «/», no «//», space, control character or backslash), an https address without a user
-- name, a product (target_item_id) or a campaign page
-- (target_campaign_id); 'none' is a heading that only opens its children. Removing an item is a soft delete.
-- New tables only; no existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_menus (
  location text PRIMARY KEY,
  is_enabled integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_menus_location CHECK (location IN ('header', 'drawer', 'footer', 'bottom')),
  CONSTRAINT chk_storefront_menus_is_enabled_flag CHECK (is_enabled IN (0, 1)),
  CONSTRAINT chk_storefront_menus_version CHECK (version >= 1)
);
--> statement-breakpoint
INSERT INTO storefront_menus (location) VALUES ('header'), ('drawer'), ('footer'), ('bottom') ON CONFLICT (location) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_menu_items (
  id serial PRIMARY KEY,
  location text NOT NULL REFERENCES storefront_menus(location),
  parent_id integer REFERENCES storefront_menu_items(id),
  position integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  link_kind text NOT NULL,
  target text NOT NULL DEFAULT '',
  target_item_id integer REFERENCES items(id),
  target_campaign_id integer REFERENCES storefront_campaigns(id),
  icon text NOT NULL DEFAULT '',
  is_active integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_menu_items_label CHECK (length(label) >= 1 AND length(label) <= 40 AND label !~ '[[:cntrl:]]'),
  CONSTRAINT chk_storefront_menu_items_position CHECK (position >= 0),
  CONSTRAINT chk_storefront_menu_items_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT chk_storefront_menu_items_link_kind CHECK (link_kind IN ('none', 'page', 'category', 'collection', 'campaign', 'product', 'path', 'url')),
  CONSTRAINT chk_storefront_menu_items_target CHECK (
    (link_kind = 'none' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NULL)
    OR (link_kind = 'product' AND target = '' AND target_item_id IS NOT NULL AND target_campaign_id IS NULL)
    OR (link_kind = 'campaign' AND target = '' AND target_item_id IS NULL AND target_campaign_id IS NOT NULL)
    OR (link_kind IN ('page', 'category', 'collection') AND length(target) >= 1 AND length(target) <= 300 AND target !~ '[[:cntrl:]]' AND target_item_id IS NULL AND target_campaign_id IS NULL)
    OR (link_kind = 'path' AND target LIKE '/%' AND target NOT LIKE '%//%' AND target !~ '[[:space:][:cntrl:]\\]' AND length(target) <= 300 AND target_item_id IS NULL AND target_campaign_id IS NULL)
    OR (link_kind = 'url' AND target ~ '^https://[^/?#@[:space:][:cntrl:]\\]+([/?#][^[:space:][:cntrl:]\\]*)?$' AND length(target) <= 500 AND target_item_id IS NULL AND target_campaign_id IS NULL)
  ),
  CONSTRAINT chk_storefront_menu_items_icon CHECK (icon = '' OR (location = 'bottom' AND icon ~ '^[a-z]{1,20}$')),
  CONSTRAINT chk_storefront_menu_items_is_active_flag CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_storefront_menu_items_is_deleted_flag CHECK (is_deleted IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_menu_items_location ON storefront_menu_items (location, parent_id, position);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_menu_items_parent_id ON storefront_menu_items (parent_id) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_menu_items_target_item_id ON storefront_menu_items (target_item_id) WHERE target_item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_menu_items_target_campaign_id ON storefront_menu_items (target_campaign_id) WHERE target_campaign_id IS NOT NULL;
