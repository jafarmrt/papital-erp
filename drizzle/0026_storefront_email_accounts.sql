-- v12 phase 8e (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, owner's decision 7): buyer accounts with an email, and the
-- one-time email codes of the new site, owned by package 18.
--
-- storefront_buyer_accounts: an account has a phone, an email or both. email is the address as the buyer typed it,
--   email_key its matching key (lower case); both '' = none. An email is stored only once a code proved it
--   (email_verified_at). The phone key's CHECK now also takes '' (no phone), the phone's unique index covers only accounts
--   with a phone, a new one covers the emails, and a CHECK keeps every account reachable by one of the two. Every account before this one has a phone and no email.
-- storefront_email_codes: like storefront_sms_codes, an HMAC of the code and of the buyer's address, the tries, and the
--   single-use proof's SHA-256; never the code or the address.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE storefront_buyer_accounts ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts ADD COLUMN IF NOT EXISTS email_key text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts DROP CONSTRAINT IF EXISTS chk_storefront_buyer_accounts_phone_key;
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts ADD CONSTRAINT chk_storefront_buyer_accounts_phone_key CHECK (phone_key = '' OR phone_key ~ '^[0-9]{10}$');
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts ADD CONSTRAINT chk_storefront_buyer_accounts_phone_pair CHECK ((phone = '') = (phone_key = ''));
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts ADD CONSTRAINT chk_storefront_buyer_accounts_email_pair CHECK ((email = '') = (email_key = ''));
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts ADD CONSTRAINT chk_storefront_buyer_accounts_reachable CHECK (phone_key <> '' OR email_key <> '');
--> statement-breakpoint
ALTER TABLE storefront_buyer_accounts ADD CONSTRAINT chk_storefront_buyer_accounts_email_verified CHECK (email_key = '' OR email_verified_at IS NOT NULL);
--> statement-breakpoint
DO $$ BEGIN EXECUTE format('DROP INDEX IF EXISTS %I.uq_storefront_buyer_accounts_phone_key', current_schema()); END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_buyer_accounts_phone_key ON storefront_buyer_accounts (phone_key) WHERE phone_key <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_buyer_accounts_email_key ON storefront_buyer_accounts (email_key) WHERE email_key <> '';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_email_codes (
  id serial PRIMARY KEY,
  email_key text NOT NULL,
  code_hash text NOT NULL,
  address_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  proof_hash text,
  proof_expires_at timestamptz,
  proof_used_at timestamptz,
  sent integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_email_codes_sent_flag CHECK (sent IN (0, 1)),
  CONSTRAINT chk_storefront_email_codes_attempts CHECK (attempts >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_email_codes_email ON storefront_email_codes (email_key, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_email_codes_address ON storefront_email_codes (address_key, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_email_codes_created ON storefront_email_codes (created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_email_codes_proof ON storefront_email_codes (proof_hash) WHERE proof_hash IS NOT NULL;
