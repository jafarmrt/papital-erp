-- Drizzle Migration 0068: price rows that are not price lists (v9.0.144 / TD-647, product-owner decision t1 option a)
--
-- An unchanged re-import of the unified Excel export turned its cost column «قیمت میانگین خرید (WAC)» into the sale
-- price list «میانگین خرید (WAC)», and the pricing page quick import turned «موجودی کل» and «میانگین بهای خرید» into
-- price lists; all three showed in the sales invoice price list. Active rows with exactly these titles are recorded in
-- item_price_title_cleanup (old values kept) and soft-deleted. Any other title outside the configured price lists is
-- left as it is and only listed by the financial health check (item_price_unknown_title).

CREATE TABLE IF NOT EXISTS item_price_title_cleanup (
  id serial PRIMARY KEY,
  item_price_id integer NOT NULL,
  item_id integer NOT NULL,
  title text NOT NULL,
  price numeric(18, 4) NOT NULL,
  currency text,
  reason text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT uq_item_price_title_cleanup_price UNIQUE (item_price_id)
);
--> statement-breakpoint
INSERT INTO item_price_title_cleanup (item_price_id, item_id, title, price, currency, reason)
SELECT p.id, p.item_id, p.title, p.price, p.currency, 'not_a_price_list'
  FROM item_prices p
 WHERE p.is_deleted = 0
   AND btrim(p.title) IN ('میانگین خرید (WAC)', 'موجودی کل', 'میانگین بهای خرید')
ON CONFLICT (item_price_id) DO NOTHING;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('item_prices', $sql$
UPDATE item_prices
   SET is_deleted = 1
 WHERE is_deleted = 0
   AND btrim(title) IN ('میانگین خرید (WAC)', 'موجودی کل', 'میانگین بهای خرید')
$sql$);
