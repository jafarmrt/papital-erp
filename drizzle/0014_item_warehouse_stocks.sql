-- Drizzle Migration 0014: Warehouse Stock Normalization (Version 7 Phase 4.1 / TD-165)
-- Replaces unconstrained JSONB items.stocks with normalized relational table item_warehouse_stocks.

DO $$
DECLARE
  r RECORD;
  wh_id INTEGER;
  wh_code TEXT;
  stk_val NUMERIC;
BEGIN
  -- 1. Create normalized item_warehouse_stocks table
  CREATE TABLE IF NOT EXISTS item_warehouse_stocks (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    warehouse_code TEXT NOT NULL,
    current_stock NUMERIC(18, 4) NOT NULL DEFAULT 0,
    reserved_stock NUMERIC(18, 4) NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
    CONSTRAINT idx_item_warehouse_unique UNIQUE (item_id, warehouse_id)
  );

  -- 2. Create indexes for high-throughput lookup and joins
  CREATE INDEX IF NOT EXISTS idx_iws_item_id ON item_warehouse_stocks (item_id);
  CREATE INDEX IF NOT EXISTS idx_iws_warehouse_id ON item_warehouse_stocks (warehouse_id);
  CREATE INDEX IF NOT EXISTS idx_iws_warehouse_code ON item_warehouse_stocks (warehouse_code);

  -- 3. Ensure default warehouse exists for fallback migration
  SELECT id INTO wh_id FROM warehouses WHERE code = 'main' LIMIT 1;
  IF wh_id IS NULL THEN
    SELECT id INTO wh_id FROM warehouses LIMIT 1;
    IF wh_id IS NULL THEN
      INSERT INTO warehouses (name, code, is_active) VALUES ('انبار مرکزی', 'main', 1) RETURNING id INTO wh_id;
    END IF;
  END IF;

  -- 4. Historical Data Migration: extract stocks JSONB into item_warehouse_stocks
  FOR r IN SELECT id AS item_id, stocks FROM items WHERE stocks IS NOT NULL AND jsonb_typeof(stocks) = 'object' LOOP
    FOR wh_code, stk_val IN
      SELECT key, COALESCE(NULLIF(value::text, 'null')::numeric, 0)
      FROM jsonb_each(r.stocks)
      WHERE value IS NOT NULL AND jsonb_typeof(value) = 'number'
    LOOP
      -- Resolve warehouse id matching by code or name (case-insensitive)
      SELECT id INTO wh_id FROM warehouses WHERE lower(code) = lower(wh_code) OR lower(name) = lower(wh_code) LIMIT 1;
      IF wh_id IS NULL THEN
        SELECT id INTO wh_id FROM warehouses WHERE code = 'main' LIMIT 1;
      END IF;

      IF wh_id IS NOT NULL THEN
        INSERT INTO item_warehouse_stocks (item_id, warehouse_id, warehouse_code, current_stock, version)
        VALUES (r.item_id, wh_id, wh_code, GREATEST(COALESCE(stk_val, 0), 0), 1)
        ON CONFLICT (item_id, warehouse_id) DO UPDATE
        SET current_stock = EXCLUDED.current_stock,
            updated_at = now();
      END IF;
    END LOOP;
  END LOOP;

  -- 5. Add database-level non-negative constraint
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_iws_current_stock_non_negative' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE item_warehouse_stocks ADD CONSTRAINT chk_iws_current_stock_non_negative CHECK (current_stock >= 0);
  END IF;

  RAISE NOTICE 'Migration 0014: Warehouse Stock Normalization applied successfully.';
END $$;
