-- v11 phase 8.1 (docs/roadmap/V11_STOREFRONT_START_PLAN.md): the base of the storefront on the ERP, owned by package 18.
--
-- 1. storefront_products: one row per item that has ever been prepared for the site (its own table, so the item package
--    is not touched): whether it is shown, its latin address (slug, unique), its SEO title and description and its order.
--    Unpublishing only turns is_published off; the row is never deleted.
-- 2. storefront_shipping_methods: the delivery methods the site offers (post, Snapp box, courier, pickup and any new one),
--    each priced flat, by a weight and province table, paid by the buyer on delivery, or free; soft deleted.
-- 3. storefront_shipping_rates: the table rows of a method priced by weight and province ('' = every other province,
--    max_weight_grams null = no upper bound); a save replaces a method's rows by soft deleting the old ones.
-- 4. The four default methods, inactive, inserted only where their code is missing.
-- New tables only; no existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_products (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id),
  is_published integer NOT NULL DEFAULT 0,
  slug text NOT NULL,
  seo_title text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_storefront_products_is_published_flag CHECK (is_published IN (0, 1)),
  CONSTRAINT chk_storefront_products_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
  CONSTRAINT chk_storefront_products_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_products_item ON storefront_products (item_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_products_slug ON storefront_products (slug);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_products_published ON storefront_products (is_published, sort_order, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_shipping_methods (
  id serial PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  pricing text NOT NULL,
  flat_rate numeric(18, 4) NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 0,
  is_free_shipping_eligible integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  CONSTRAINT chk_storefront_shipping_methods_is_active_flag CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_storefront_shipping_methods_is_free_shipping_eligible_flag CHECK (is_free_shipping_eligible IN (0, 1)),
  CONSTRAINT chk_storefront_shipping_methods_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_storefront_shipping_methods_code_format CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(code) <= 40),
  CONSTRAINT chk_storefront_shipping_methods_pricing CHECK (pricing IN ('flat', 'table', 'on_delivery', 'free')),
  CONSTRAINT chk_storefront_shipping_methods_flat_rate CHECK (flat_rate >= 0),
  CONSTRAINT chk_storefront_shipping_methods_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_shipping_methods_code_active ON storefront_shipping_methods (code) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_shipping_rates (
  id serial PRIMARY KEY,
  method_id integer NOT NULL REFERENCES storefront_shipping_methods(id),
  province text NOT NULL DEFAULT '',
  max_weight_grams integer,
  rate numeric(18, 4) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_deleted integer NOT NULL DEFAULT 0,
  CONSTRAINT chk_storefront_shipping_rates_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_storefront_shipping_rates_rate CHECK (rate >= 0),
  CONSTRAINT chk_storefront_shipping_rates_weight CHECK (max_weight_grams IS NULL OR max_weight_grams > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_shipping_rates_method_id ON storefront_shipping_rates (method_id, is_deleted, sort_order);
--> statement-breakpoint
INSERT INTO storefront_shipping_methods (code, title, description, pricing, is_free_shipping_eligible, sort_order)
SELECT v.code, v.title, v.description, v.pricing, v.free_eligible, v.sort_order
FROM (VALUES
  ('post', 'پست پیشتاز', 'ارسال به همه شهرها با کد رهگیری', 'flat', 1, 1),
  ('snapp-box', 'اسنپ‌باکس', 'تهران، همان روز؛ هزینه را خریدار در محل می‌پردازد', 'on_delivery', 0, 2),
  ('courier', 'پیک', 'تهران؛ هزینه را خریدار در محل می‌پردازد', 'on_delivery', 0, 3),
  ('pickup', 'تحویل حضوری از گالری', 'رایگان', 'free', 0, 4)
) AS v(code, title, description, pricing, free_eligible, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM storefront_shipping_methods m WHERE m.code = v.code AND m.is_deleted = 0);
