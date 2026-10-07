-- Drizzle Migration 0074: items of each item opening voucher (v9.0.206 / TD-663, product-owner decision t10 item 3)
--
-- An Excel import used to issue one opening voucher per new item (999 vouchers for a 1,000-row file, each approved
-- one by one). It now issues one voucher for the whole file, with one debit row per item, so "the opening voucher of
-- item X" can no longer be found by journal_vouchers.reference_id. This table holds each opening voucher's items and the
-- amount of each item; the single-item voucher of the item form and the item workflow writes its one row too.
--
-- Existing opening vouchers (reference_module = 'item_opening', reference_id = the item) are copied in with their total
-- debit, live or voided alike (readers join the voucher and skip deleted ones). Nothing in journal_vouchers changes.
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS item_opening_voucher_items (
  voucher_id integer NOT NULL REFERENCES journal_vouchers(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  amount numeric(18, 4) NOT NULL,
  created_at timestamp DEFAULT now(),
  CONSTRAINT item_opening_voucher_items_pk PRIMARY KEY (voucher_id, item_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_iovi_item ON item_opening_voucher_items (item_id);
--> statement-breakpoint
INSERT INTO item_opening_voucher_items (voucher_id, item_id, amount)
SELECT jv.id, jv.reference_id,
       COALESCE((SELECT SUM(jvi.debit) FROM journal_voucher_items jvi WHERE jvi.voucher_id = jv.id AND jvi.is_deleted = 0), 0)
  FROM journal_vouchers jv
 WHERE jv.reference_module = 'item_opening'
   AND jv.reference_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM items i WHERE i.id = jv.reference_id)
ON CONFLICT DO NOTHING;
