-- Drizzle Migration 0111: item code history (v10.1.7 / TD-1264, D-15)
--
-- An item's code is the WooCommerce SKU, so a code changed through the item form made the next website order carrying
-- the old SKU fail as a whole. From this version the code changes only through its own operation
-- (POST /items/:id/change-code, permission products.change_code, a required reason), which records each change here in
-- the same transaction as the item update. A WooCommerce order line whose SKU is no live item's current code finds the
-- item through this table (the latest change from that code wins). Nothing is backfilled: earlier code edits left no
-- record. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS item_code_history (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES items(id),
  old_code text NOT NULL,
  new_code text NOT NULL,
  reason text NOT NULL,
  user_id integer REFERENCES users(id),
  username text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_item_code_history_item ON item_code_history (item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_item_code_history_user ON item_code_history (user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_item_code_history_old_code ON item_code_history (old_code);
