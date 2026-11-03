-- v11 phase 8.4a (docs/roadmap/V11_STOREFRONT_8_4_SMS_START_PLAN.md): the site's text messages, owned by package 18.
--
-- 1. storefront_sms_messages: the outbox and the log of every text the shop sends a buyer. An order message is written in
--    the same transaction as the order's change and sent by the minute sender after the commit; a login code is written
--    and sent at once. params holds a template's values (an order number, a tracking code), never a login code. Never
--    deleted.
-- 2. storefront_sms_codes: the login codes buyers asked for, as keyed hashes only, with their tries and deadlines, and
--    the hash of the single-use phone proof a right code gives. address_key is a keyed hash of the buyer's address.
-- New tables only; no existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS storefront_sms_messages (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  phone text NOT NULL,
  phone_key text NOT NULL,
  order_id integer REFERENCES storefront_orders(id),
  params text NOT NULL DEFAULT '{}',
  is_test integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL DEFAULT '',
  provider_message_id text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT chk_storefront_sms_messages_kind CHECK (kind IN ('otp', 'order_placed', 'receipt_rejected', 'order_paid', 'order_shipped', 'order_delivered', 'order_cancelled')),
  CONSTRAINT chk_storefront_sms_messages_phone CHECK (phone ~ '^09[0-9]{9}$'),
  CONSTRAINT chk_storefront_sms_messages_phone_key CHECK (phone_key ~ '^[0-9]{10}$'),
  CONSTRAINT chk_storefront_sms_messages_is_test_flag CHECK (is_test IN (0, 1)),
  CONSTRAINT chk_storefront_sms_messages_status CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  CONSTRAINT chk_storefront_sms_messages_attempts CHECK (attempts >= 0),
  CONSTRAINT chk_storefront_sms_messages_provider CHECK (provider IN ('', 'smsir', 'kavenegar')),
  CONSTRAINT chk_storefront_sms_messages_sent CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT chk_storefront_sms_messages_otp_params CHECK (kind <> 'otp' OR params = '{}')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_messages_due ON storefront_sms_messages (status, next_attempt_at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_messages_order_id ON storefront_sms_messages (order_id) WHERE order_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_messages_created ON storefront_sms_messages (created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_messages_phone ON storefront_sms_messages (phone_key, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_sms_codes (
  id serial PRIMARY KEY,
  phone_key text NOT NULL,
  purpose text NOT NULL DEFAULT 'phone',
  code_hash text NOT NULL,
  address_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  proof_hash text,
  proof_expires_at timestamptz,
  proof_used_at timestamptz,
  message_id integer REFERENCES storefront_sms_messages(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_sms_codes_phone_key CHECK (phone_key ~ '^[0-9]{10}$'),
  CONSTRAINT chk_storefront_sms_codes_purpose CHECK (purpose IN ('phone')),
  CONSTRAINT chk_storefront_sms_codes_code_hash CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storefront_sms_codes_address_key CHECK (address_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storefront_sms_codes_attempts CHECK (attempts >= 0),
  CONSTRAINT chk_storefront_sms_codes_proof CHECK (
    (verified_at IS NULL AND proof_hash IS NULL AND proof_expires_at IS NULL AND proof_used_at IS NULL)
    OR (verified_at IS NOT NULL AND proof_hash ~ '^[0-9a-f]{64}$' AND proof_expires_at IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_codes_phone ON storefront_sms_codes (phone_key, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_codes_address ON storefront_sms_codes (address_key, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_codes_created ON storefront_sms_codes (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_sms_codes_message_id ON storefront_sms_codes (message_id) WHERE message_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_sms_codes_proof ON storefront_sms_codes (proof_hash) WHERE proof_hash IS NOT NULL;
