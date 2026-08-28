-- Migration 0007: Composite Kardex Indexes on transactions (DB-015)
-- Optimizes Kardex queries, stock-by-location queries, and date-range lookups.

-- 1. Composite index for Kardex event log retrieval (WHERE item_id = ? AND is_deleted = 0 ORDER BY date, id)
CREATE INDEX IF NOT EXISTS tx_item_date_id_active 
  ON transactions(item_id, is_deleted, date, id);

-- 2. Composite index for stock-by-location lookups
CREATE INDEX IF NOT EXISTS tx_item_loc_active 
  ON transactions(item_id, location, is_deleted);

-- 3. Composite index for date-range and descending chronological history
CREATE INDEX IF NOT EXISTS tx_item_active_date 
  ON transactions(item_id, is_deleted, date DESC);

-- 4. Drop redundant single-column index as item_id is the leftmost column of the composite indexes
DROP INDEX IF EXISTS tx_item_id;

-- 5. Update PostgreSQL table statistics
ANALYZE transactions;
