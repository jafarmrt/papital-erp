-- v12 phase 8d review (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, site review 2.2): whether a site order's phone was
-- proven when it was placed, owned by package 18. Only such an order may be opened on another device with that phone
-- and a fresh code. Orders before this migration stay 0: before phase 8c an order's phone was its recipient's, and with
-- the texts off nobody proved it, so they open only with their own tracking key, as before.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS phone_proven integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_phone_proven_flag CHECK (phone_proven IN (0, 1));
