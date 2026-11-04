-- v11 phase 8.2c (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6, decision 6): discount codes of the new site, owned by
-- package 18.
--
-- storefront_discount_codes: one live row per code (code: Latin capitals, digits and «-», unique among live rows). A code
--   takes a percent (1 to 90, with an optional cap in max_discount) or an amount in rial (below its minimum order, so an
--   order is never free). It may have a validity window, a total usage limit and a limit per buyer (a phone, and the
--   account when signed in; 0 = none), and may be only for signed-in accounts or only for a buyer's first order.
--   for_retail: guests and retail accounts may use it (the default; decision 6). Removing a code is a soft delete.
--   group_ids: the buyer groups whose buyers may also use it (each must accept discounts when the code is saved and when
--   it is used). Groups are only soft-deleted, so an id never points at another group.
-- storefront_discount_redemptions: one row per order that used a code; released_at is set when the order is cancelled
--   (by a colleague or when its reservation ends), so the use goes back to the code. The order row is locked while a use
--   is counted, under the code's own row lock, so two orders never take the last use of a code.
-- storefront_orders gets the code it used (its id and the code as typed then) and the discount amount, spread over the
--   lines of the proforma as line discounts; payable_amount = items_amount - discount_amount + shipping_amount.
-- The notification category site_inquiry (a corporate gift request from the site's form, a new CRM lead): the category
-- check of user_notification_preferences takes the new value.
-- Existing orders used no code: the new columns' defaults describe them. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_discount_codes (
  id serial PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL DEFAULT '',
  kind text NOT NULL,
  percent integer NOT NULL DEFAULT 0,
  amount numeric(18, 4) NOT NULL DEFAULT 0,
  max_discount numeric(18, 4) NOT NULL DEFAULT 0,
  min_order_amount numeric(18, 4) NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer NOT NULL DEFAULT 0,
  per_buyer_limit integer NOT NULL DEFAULT 1,
  for_retail integer NOT NULL DEFAULT 1,
  group_ids integer[] NOT NULL DEFAULT '{}',
  accounts_only integer NOT NULL DEFAULT 0,
  first_order_only integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_storefront_discount_codes_code CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,29}$'),
  CONSTRAINT chk_storefront_discount_codes_kind CHECK (
    (kind = 'percent' AND percent BETWEEN 1 AND 90 AND amount = 0)
    OR (kind = 'amount' AND percent = 0 AND amount > 0 AND max_discount = 0 AND min_order_amount > amount)
  ),
  CONSTRAINT chk_storefront_discount_codes_amounts CHECK (max_discount >= 0 AND min_order_amount >= 0),
  CONSTRAINT chk_storefront_discount_codes_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT chk_storefront_discount_codes_limits CHECK (usage_limit >= 0 AND per_buyer_limit >= 0),
  CONSTRAINT chk_storefront_discount_codes_for_retail_flag CHECK (for_retail IN (0, 1)),
  CONSTRAINT chk_storefront_discount_codes_accounts_only_flag CHECK (accounts_only IN (0, 1)),
  CONSTRAINT chk_storefront_discount_codes_first_order_only_flag CHECK (first_order_only IN (0, 1)),
  CONSTRAINT chk_storefront_discount_codes_is_active_flag CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_storefront_discount_codes_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_storefront_discount_codes_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_discount_codes_code_live ON storefront_discount_codes (code) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_discount_codes_list ON storefront_discount_codes (is_deleted, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_discount_redemptions (
  id serial PRIMARY KEY,
  code_id integer NOT NULL REFERENCES storefront_discount_codes(id),
  order_id integer NOT NULL REFERENCES storefront_orders(id),
  phone_key text NOT NULL,
  buyer_account_id integer REFERENCES storefront_buyer_accounts(id),
  amount numeric(18, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT chk_storefront_discount_redemptions_amount CHECK (amount > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_discount_redemptions_order_id ON storefront_discount_redemptions (order_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_discount_redemptions_code_id ON storefront_discount_redemptions (code_id, phone_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_discount_redemptions_buyer_account_id ON storefront_discount_redemptions (buyer_account_id);
--> statement-breakpoint
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS discount_code_id integer REFERENCES storefront_discount_codes(id);
--> statement-breakpoint
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS discount_code text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS discount_amount numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE storefront_orders DROP CONSTRAINT IF EXISTS chk_storefront_orders_amounts;
--> statement-breakpoint
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_amounts CHECK (
  shipping_amount >= 0 AND items_amount > 0 AND discount_amount >= 0 AND discount_amount < items_amount
  AND payable_amount = items_amount - discount_amount + shipping_amount
);
--> statement-breakpoint
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_discount CHECK (
  (discount_code_id IS NULL AND discount_code = '' AND discount_amount = 0)
  OR (discount_code_id IS NOT NULL AND discount_code <> '' AND discount_amount > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_orders_discount_code_id ON storefront_orders (discount_code_id);
--> statement-breakpoint
ALTER TABLE user_notification_preferences DROP CONSTRAINT IF EXISTS chk_user_notification_preferences_category;
--> statement-breakpoint
ALTER TABLE user_notification_preferences ADD CONSTRAINT chk_user_notification_preferences_category CHECK ((category = ANY (ARRAY['workflow_task'::text, 'workflow_sla'::text, 'payslip'::text, 'mention'::text, 'daily_log_review'::text, 'crm_followup'::text, 'crm_won'::text, 'event_rule'::text, 'workshop'::text, 'settings_change'::text, 'site_order'::text, 'site_buyer'::text, 'site_inquiry'::text])));
