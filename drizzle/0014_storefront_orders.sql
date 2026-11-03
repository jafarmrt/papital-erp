-- v11 phase 8.2a (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md): the site's orders and card-to-card receipts, owned by
-- package 18.
--
-- 1. storefront_order_number_seq: the order numbers the buyer sees (AGENTS.md §2.3: a sequence, never MAX() + 1).
-- 2. storefront_orders: one row per site order. The order itself is a sales proforma of the ERP (document_id, which
--    reserves the stock); this row holds what the ERP document does not: the buyer's address and postal code, the
--    shipping method, the order's status on the site, its reservation deadline and the salt of its tracking key (the key
--    itself is a keyed hash of the salt and is never stored). request_key and request_hash answer a repeated request with
--    the same order. Never deleted: a cancelled order keeps its row and its voided proforma.
-- 3. storefront_payment_receipts: the card-to-card receipts a buyer sends for an order; only the last four digits of the
--    paying card are kept. An accepted receipt points to the treasury receipt the confirmation posted.
-- New tables only; no existing row is changed. Runs inside the Drizzle migrator transaction.

CREATE SEQUENCE IF NOT EXISTS storefront_order_number_seq START WITH 100001;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_orders (
  id serial PRIMARY KEY,
  order_number text NOT NULL,
  access_salt text NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  document_id integer NOT NULL REFERENCES documents(id),
  customer_id integer NOT NULL REFERENCES customers(id),
  status text NOT NULL DEFAULT 'awaiting_payment',
  cancel_reason text NOT NULL DEFAULT '',
  recipient_name text NOT NULL,
  phone text NOT NULL,
  phone_key text NOT NULL,
  province text NOT NULL,
  city text NOT NULL,
  address text NOT NULL,
  postal_code text NOT NULL,
  buyer_note text NOT NULL DEFAULT '',
  shipping_method_code text NOT NULL,
  shipping_method_title text NOT NULL,
  shipping_on_delivery integer NOT NULL DEFAULT 0,
  shipping_amount numeric(18, 4) NOT NULL DEFAULT 0,
  items_amount numeric(18, 4) NOT NULL,
  payable_amount numeric(18, 4) NOT NULL,
  tracking_code text NOT NULL DEFAULT '',
  reserve_until timestamptz NOT NULL,
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_storefront_orders_number_format CHECK (order_number ~ '^[0-9]{6,12}$'),
  CONSTRAINT chk_storefront_orders_access_salt CHECK (access_salt ~ '^[0-9a-f]{32}$'),
  CONSTRAINT chk_storefront_orders_request_key CHECK (length(request_key) BETWEEN 8 AND 80),
  CONSTRAINT chk_storefront_orders_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storefront_orders_status CHECK (status IN ('awaiting_payment', 'payment_submitted', 'paid', 'shipped', 'delivered', 'cancelled')),
  CONSTRAINT chk_storefront_orders_cancel_reason CHECK (
    (status = 'cancelled' AND cancel_reason IN ('expired', 'staff')) OR (status <> 'cancelled' AND cancel_reason = '')
  ),
  CONSTRAINT chk_storefront_orders_phone_key CHECK (phone_key ~ '^[0-9]{10}$'),
  CONSTRAINT chk_storefront_orders_postal_code CHECK (postal_code ~ '^[0-9]{10}$'),
  CONSTRAINT chk_storefront_orders_on_delivery_flag CHECK (shipping_on_delivery IN (0, 1)),
  CONSTRAINT chk_storefront_orders_amounts CHECK (shipping_amount >= 0 AND items_amount > 0 AND payable_amount = items_amount + shipping_amount),
  CONSTRAINT chk_storefront_orders_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_orders_number ON storefront_orders (order_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_orders_request_key ON storefront_orders (request_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_orders_document ON storefront_orders (document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_orders_customer_id ON storefront_orders (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_orders_status_reserve ON storefront_orders (status, reserve_until);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_orders_phone_status ON storefront_orders (phone_key, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_orders_created ON storefront_orders (created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS storefront_payment_receipts (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES storefront_orders(id),
  reference text NOT NULL,
  paid_at timestamptz NOT NULL,
  card_last4 text NOT NULL,
  amount numeric(18, 4) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reject_reason text NOT NULL DEFAULT '',
  reviewed_by text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  treasury_transaction_id integer REFERENCES treasury_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_payment_receipts_reference CHECK (reference ~ '^[0-9A-Za-z-]{4,40}$'),
  CONSTRAINT chk_storefront_payment_receipts_card_last4 CHECK (card_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT chk_storefront_payment_receipts_amount CHECK (amount > 0),
  CONSTRAINT chk_storefront_payment_receipts_status CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT chk_storefront_payment_receipts_review CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND reject_reason = '')
    OR (status = 'accepted' AND reviewed_at IS NOT NULL AND treasury_transaction_id IS NOT NULL)
    OR (status = 'rejected' AND reviewed_at IS NOT NULL AND length(reject_reason) > 0)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_payment_receipts_order_id ON storefront_payment_receipts (order_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_payment_receipts_treasury_transaction_id ON storefront_payment_receipts (treasury_transaction_id) WHERE treasury_transaction_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_payment_receipts_pending ON storefront_payment_receipts (order_id) WHERE status = 'pending';
