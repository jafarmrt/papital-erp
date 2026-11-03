-- v11 phase 8.2b, part 1 (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6): buyer groups and buyer accounts of the
-- site, owned by package 18.
--
-- 1. storefront_buyer_groups: the site's price policies other than the retail one (decision 5). Each group has its own
--    ERP price list, minimum order amount, minimum quantity of each line, payment methods, the products it may see
--    (all, or chosen collections) and whether discount codes apply. The retail policy stays in the settings (its price
--    list is the public catalog's); a group's prices reach only an active account of that group. One inactive group,
--    «خریدار عمده», is seeded with the wholesale price list chosen in the 8.1 settings.
-- 2. storefront_buyer_accounts: a buyer's account, retail (no group) or wholesale (approved into a group). The password
--    is kept only as a scrypt hash. An account made by the wholesale form has no password until a colleague approves it
--    and sends a set-password link. One live account per phone.
-- 3. storefront_buyer_sessions: sign-in sessions; only the SHA-256 of the token is kept.
-- 4. storefront_password_tokens: one-time set-password links a colleague makes; only the SHA-256 of the token is kept.
-- 5. the notification category site_buyer (a new wholesale application): the category check of
--    user_notification_preferences takes the new value.
-- New tables and one widened check; no existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_buyer_groups (
  id serial PRIMARY KEY,
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_list text NOT NULL DEFAULT '',
  min_order_amount numeric(18, 4) NOT NULL DEFAULT 0,
  min_line_quantity integer NOT NULL DEFAULT 0,
  allow_card integer NOT NULL DEFAULT 1,
  allow_on_account integer NOT NULL DEFAULT 0,
  credit_limit numeric(18, 4) NOT NULL DEFAULT 0,
  catalog_scope text NOT NULL DEFAULT 'all',
  collections text[] NOT NULL DEFAULT '{}',
  accepts_discounts integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  CONSTRAINT chk_storefront_buyer_groups_code CHECK (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  CONSTRAINT chk_storefront_buyer_groups_amounts CHECK (min_order_amount >= 0 AND credit_limit >= 0),
  CONSTRAINT chk_storefront_buyer_groups_min_line CHECK (min_line_quantity >= 0),
  CONSTRAINT chk_storefront_buyer_groups_flags CHECK (
    allow_card IN (0, 1) AND allow_on_account IN (0, 1) AND accepts_discounts IN (0, 1) AND is_active IN (0, 1) AND is_deleted IN (0, 1)
  ),
  CONSTRAINT chk_storefront_buyer_groups_payment CHECK (allow_card = 1 OR allow_on_account = 1),
  CONSTRAINT chk_storefront_buyer_groups_scope CHECK (catalog_scope IN ('all', 'collections')),
  CONSTRAINT chk_storefront_buyer_groups_active_price_list CHECK (is_active = 0 OR length(price_list) > 0),
  CONSTRAINT chk_storefront_buyer_groups_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_buyer_groups_code_live ON storefront_buyer_groups (code) WHERE is_deleted = 0;
--> statement-breakpoint
INSERT INTO storefront_buyer_groups (code, title, description, price_list, min_line_quantity, is_active, sort_order)
SELECT 'wholesale', 'خریدار عمده', 'فروشگاه‌ها و خریداران عمده‌ای که همکار حسابشان را تأیید کرده است.',
  COALESCE((SELECT value FROM app_settings WHERE key = 'sf_wholesale_price_list'), ''), 0, 0, 10
WHERE NOT EXISTS (SELECT 1 FROM storefront_buyer_groups WHERE code = 'wholesale' AND is_deleted = 0);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_buyer_accounts (
  id serial PRIMARY KEY,
  group_id integer REFERENCES storefront_buyer_groups(id),
  customer_id integer REFERENCES customers(id),
  name text NOT NULL,
  phone text NOT NULL,
  phone_key text NOT NULL,
  city text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  password_hash text NOT NULL DEFAULT '',
  application_status text NOT NULL DEFAULT 'none',
  company_name text NOT NULL DEFAULT '',
  national_id text NOT NULL DEFAULT '',
  economic_code text NOT NULL DEFAULT '',
  application_note text NOT NULL DEFAULT '',
  applied_at timestamptz,
  reviewed_by text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_storefront_buyer_accounts_phone_key CHECK (phone_key ~ '^[0-9]{10}$'),
  CONSTRAINT chk_storefront_buyer_accounts_status CHECK (status IN ('pending', 'active', 'suspended')),
  CONSTRAINT chk_storefront_buyer_accounts_application CHECK (application_status IN ('none', 'pending', 'approved', 'declined')),
  CONSTRAINT chk_storefront_buyer_accounts_pending CHECK (status <> 'pending' OR (application_status = 'pending' AND password_hash = '')),
  CONSTRAINT chk_storefront_buyer_accounts_group CHECK ((group_id IS NULL) = (application_status <> 'approved')),
  CONSTRAINT chk_storefront_buyer_accounts_approved_customer CHECK (application_status <> 'approved' OR customer_id IS NOT NULL),
  CONSTRAINT chk_storefront_buyer_accounts_password CHECK (password_hash = '' OR password_hash ~ '^scrypt\$'),
  CONSTRAINT chk_storefront_buyer_accounts_failed_logins CHECK (failed_logins >= 0),
  CONSTRAINT chk_storefront_buyer_accounts_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_buyer_accounts_phone_key ON storefront_buyer_accounts (phone_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_buyer_accounts_group_id ON storefront_buyer_accounts (group_id) WHERE group_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_buyer_accounts_customer_id ON storefront_buyer_accounts (customer_id) WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_buyer_accounts_application ON storefront_buyer_accounts (application_status, applied_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_buyer_sessions (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES storefront_buyer_accounts(id),
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT chk_storefront_buyer_sessions_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storefront_buyer_sessions_expiry CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_buyer_sessions_token_hash ON storefront_buyer_sessions (token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_buyer_sessions_account_id ON storefront_buyer_sessions (account_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_password_tokens (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES storefront_buyer_accounts(id),
  token_hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT chk_storefront_password_tokens_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storefront_password_tokens_expiry CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_password_tokens_token_hash ON storefront_password_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_password_tokens_account_id ON storefront_password_tokens (account_id) WHERE used_at IS NULL;
--> statement-breakpoint
ALTER TABLE user_notification_preferences DROP CONSTRAINT IF EXISTS chk_user_notification_preferences_category;
--> statement-breakpoint
ALTER TABLE user_notification_preferences ADD CONSTRAINT chk_user_notification_preferences_category CHECK ((category = ANY (ARRAY['workflow_task'::text, 'workflow_sla'::text, 'payslip'::text, 'mention'::text, 'daily_log_review'::text, 'crm_followup'::text, 'crm_won'::text, 'event_rule'::text, 'workshop'::text, 'settings_change'::text, 'site_order'::text, 'site_buyer'::text])));
