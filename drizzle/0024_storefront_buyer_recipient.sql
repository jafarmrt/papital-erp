-- v12 phase 8c (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, site review 2.5, owner's decision 13): the buyer apart from
-- the recipient, the gift option and the address book of the new site, owned by package 18.
--
-- storefront_orders: buyer_name is the buyer the ERP's customer is named after ('' = the recipient, as every order before
--   this one); phone stays the buyer's mobile (texts, proof, limits); recipient_phone is the recipient's own mobile, a
--   contact for the courier only ('' = the buyer's); is_gift and gift_message are a free gift and its card's message.
--   Existing orders were placed by their recipient and were no gifts: the defaults describe them.
-- storefront_buyer_addresses: the addresses a buyer account keeps (at most BUYER_ADDRESSES_MAX live, one of them the
--   default), the account's own only; removing one is a soft delete.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS buyer_name text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS recipient_phone text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS is_gift integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS gift_message text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_is_gift_flag CHECK (is_gift IN (0, 1));
--> statement-breakpoint
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_gift_message CHECK (is_gift = 1 OR gift_message = '');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_buyer_addresses (
  id serial PRIMARY KEY,
  account_id integer NOT NULL REFERENCES storefront_buyer_accounts(id),
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL DEFAULT '',
  province text NOT NULL,
  city text NOT NULL,
  address text NOT NULL,
  postal_code text NOT NULL,
  is_default integer NOT NULL DEFAULT 0,
  is_deleted integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_storefront_buyer_addresses_is_default_flag CHECK (is_default IN (0, 1)),
  CONSTRAINT chk_storefront_buyer_addresses_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_storefront_buyer_addresses_postal_code CHECK (postal_code ~ '^[0-9]{10}$'),
  CONSTRAINT chk_storefront_buyer_addresses_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_buyer_addresses_account_id ON storefront_buyer_addresses (account_id, is_deleted);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_buyer_addresses_default ON storefront_buyer_addresses (account_id) WHERE is_default = 1 AND is_deleted = 0;
