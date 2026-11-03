-- v11 phase 8.2b, part 2 (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §6): a site order may belong to a buyer account.
--
-- 1. storefront_orders gets buyer_account_id (the signed-in account that placed it, or a guest order a buyer later
--    claimed with its tracking key), buyer_group_id (the buyer group whose prices and rules the order was placed with;
--    null for retail) and payment_method ('card' card-to-card, or 'on_account' for a group that allows it).
-- 2. Two statuses for an order «به حساب»: 'awaiting_approval' (it holds its stock like an unpaid order and waits for a
--    colleague's «تأیید سفارش به حساب») and 'confirmed' (the proforma became the invoice on the customer's account).
--    confirmed_at records when. A card order never takes these two statuses and an on-account order never takes the
--    payment ones.
-- Existing orders are retail card orders: the new columns' defaults describe them. Runs inside the Drizzle migrator
-- transaction.

ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS buyer_account_id integer REFERENCES storefront_buyer_accounts(id);
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS buyer_group_id integer REFERENCES storefront_buyer_groups(id);
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'card';
ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE storefront_orders DROP CONSTRAINT IF EXISTS chk_storefront_orders_status;
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_status CHECK (
  status IN ('awaiting_payment', 'payment_submitted', 'paid', 'awaiting_approval', 'confirmed', 'shipped', 'delivered', 'cancelled')
);
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_payment_method CHECK (payment_method IN ('card', 'on_account'));
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_payment_path CHECK (
  (payment_method = 'card' AND status NOT IN ('awaiting_approval', 'confirmed'))
  OR (payment_method = 'on_account' AND status NOT IN ('awaiting_payment', 'payment_submitted', 'paid'))
);
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_on_account_buyer CHECK (
  payment_method <> 'on_account' OR (buyer_account_id IS NOT NULL AND buyer_group_id IS NOT NULL)
);
ALTER TABLE storefront_orders ADD CONSTRAINT chk_storefront_orders_group_buyer CHECK (buyer_group_id IS NULL OR buyer_account_id IS NOT NULL);

-- an account's order history, newest first; the group's orders for the ERP
CREATE INDEX IF NOT EXISTS idx_storefront_orders_buyer_account_id ON storefront_orders (buyer_account_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_storefront_orders_buyer_group_id ON storefront_orders (buyer_group_id);
