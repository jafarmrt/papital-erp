-- Drizzle Migration 0021: drop the items.stocks JSONB cache; current_stock maintained by the database
-- (v7.0.48 / TD-214, product-owner request)
--
-- Since v7.0.45 (migration 0020) item_warehouse_stocks is the only source of per-warehouse stock and
-- items.stocks / items.current_stock were a read cache rebuilt by the application after every change.
-- This migration removes the cache column and makes current_stock a database-maintained derived value:
--   1) every items.stocks value is copied to items_stocks_archive (nothing is lost);
--   2) any current_stock that differs from SUM(item_warehouse_stocks) is corrected and recorded in
--      inventory_reconciliation_anomalies (run_id 'migration-0021');
--   3) the old trigger trg_sync_item_current_stock (current_stock := SUM(stocks JSONB)) and the 0020 backfill
--      function are dropped, then the column items.stocks;
--   4) new triggers: any write to item_warehouse_stocks recomputes items.current_stock, and a direct write to
--      items.current_stock is replaced by SUM(item_warehouse_stocks) — the column can never diverge.

CREATE TABLE IF NOT EXISTS items_stocks_archive (
  item_id integer PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  stocks jsonb,
  current_stock numeric(18, 4),
  archived_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
INSERT INTO items_stocks_archive (item_id, stocks, current_stock)
SELECT id, stocks, current_stock FROM items
ON CONFLICT (item_id) DO NOTHING;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_sync_item_current_stock ON items;
--> statement-breakpoint
DROP FUNCTION IF EXISTS sync_item_current_stock();
--> statement-breakpoint
DROP FUNCTION IF EXISTS erp_backfill_item_warehouse_stocks(integer, text);
--> statement-breakpoint
WITH table_totals AS (
  SELECT i.id AS item_id,
         i.current_stock AS old_total,
         COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.item_id = i.id), 0) AS new_total
  FROM items i
), differing AS (
  SELECT * FROM table_totals WHERE old_total IS DISTINCT FROM new_total
), logged AS (
  INSERT INTO inventory_reconciliation_anomalies (run_id, item_id, kind, before_qty, after_qty, details, created_by)
  SELECT 'migration-0021', d.item_id, 'current_stock_resynced', d.old_total, d.new_total,
         'items.current_stock set to SUM(item_warehouse_stocks) before the JSONB cache was dropped', 'migration 0021'
  FROM differing d
  RETURNING item_id
)
UPDATE items i
SET current_stock = d.new_total
FROM differing d
WHERE i.id = d.item_id;
--> statement-breakpoint
ALTER TABLE items DROP COLUMN IF EXISTS stocks;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_items_current_stock_from_table()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.current_stock := COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.item_id = NEW.id), 0);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_items_current_stock_from_table
BEFORE INSERT OR UPDATE OF current_stock ON items
FOR EACH ROW
EXECUTE FUNCTION erp_items_current_stock_from_table();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_iws_refresh_item_current_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_id integer;
BEGIN
  v_item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  -- the BEFORE trigger on items recomputes the value from item_warehouse_stocks
  UPDATE items SET current_stock = 0 WHERE id = v_item_id;
  IF TG_OP = 'UPDATE' AND OLD.item_id IS DISTINCT FROM NEW.item_id THEN
    UPDATE items SET current_stock = 0 WHERE id = OLD.item_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_iws_refresh_item_current_stock
AFTER INSERT OR UPDATE OF current_stock, item_id OR DELETE ON item_warehouse_stocks
FOR EACH ROW
EXECUTE FUNCTION erp_iws_refresh_item_current_stock();
