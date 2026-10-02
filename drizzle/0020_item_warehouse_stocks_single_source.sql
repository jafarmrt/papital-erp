-- Drizzle Migration 0020: item_warehouse_stocks becomes the single source of per-warehouse stock
-- (v7.0.45 / audit P2-1, product-owner decision)
--
-- Until v7.0.44 several write paths (item creation and opening stock, the warehouse-to-warehouse transfer of
-- POST /api/inventory/transfer, the Kardex rebuild) wrote only items.stocks (JSONB) and items.current_stock;
-- the stock engine filled a missing item_warehouse_stocks row from the JSONB on the item's first movement.
-- From v7.0.45 every write goes through item_warehouse_stocks and the JSONB / current_stock pair is only a read
-- cache rebuilt from it. This migration:
--   1) creates the item_warehouse_stocks rows that are still missing, from the JSONB value (exactly what the first
--      movement would have done). JSON keys are mapped with the Kardex/TD-200 rule ('' and 'default' = default
--      warehouse, then code, then name, all warehouses); several keys of the same warehouse are ADDED (AGENTS.md
--      section 12); negative, non-numeric or unmapped values are not inserted;
--   2) rebuilds items.stocks / items.current_stock from item_warehouse_stocks for every item whose cache differs;
--   3) records every created row, every skipped value and every cache change in inventory_reconciliation_anomalies
--      (run_id 'migration-0020'). Quantities are never taken from the Kardex here: correcting the table from the
--      Kardex stays a manual, dry-run-first action of the warehouse reconciliation report (TD-200).
-- The same logic is kept as erp_backfill_item_warehouse_stocks(item_id, run_id) so it can be verified per item.

CREATE OR REPLACE FUNCTION erp_backfill_item_warehouse_stocks(p_item_id integer, p_run_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_default_id integer;
  v_changed integer := 0;
BEGIN
  SELECT id INTO v_default_id FROM warehouses WHERE is_active = 1 ORDER BY id LIMIT 1;
  IF v_default_id IS NULL THEN
    SELECT id INTO v_default_id FROM warehouses ORDER BY id LIMIT 1;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS erp_tmp_json_stock (
    item_id integer NOT NULL,
    json_key text NOT NULL,
    qty numeric,
    warehouse_id integer
  ) ON COMMIT DROP;
  TRUNCATE erp_tmp_json_stock;

  INSERT INTO erp_tmp_json_stock (item_id, json_key, qty, warehouse_id)
  SELECT i.id,
         e.key,
         CASE
           WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric
           WHEN jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
             THEN btrim(e.value #>> '{}')::numeric
           ELSE NULL
         END,
         COALESCE(
           CASE WHEN btrim(e.key) = '' OR lower(btrim(e.key)) = 'default' THEN v_default_id END,
           (SELECT w.id FROM warehouses w WHERE lower(btrim(w.code)) = lower(btrim(e.key)) ORDER BY w.id LIMIT 1),
           (SELECT w.id FROM warehouses w WHERE lower(btrim(w.name)) = lower(btrim(e.key)) ORDER BY w.id LIMIT 1)
         )
  FROM items i
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(i.stocks) = 'object' THEN i.stocks ELSE '{}'::jsonb END) e
  WHERE p_item_id IS NULL OR i.id = p_item_id;

  -- skipped values (never inserted)
  INSERT INTO inventory_reconciliation_anomalies (run_id, item_id, warehouse_id, warehouse_code, kind, before_qty, details, created_by)
  SELECT p_run_id, t.item_id, t.warehouse_id, t.json_key,
         CASE
           WHEN t.qty IS NULL THEN 'backfill_invalid_json_value'
           WHEN t.warehouse_id IS NULL THEN 'backfill_unresolved_json_key'
           ELSE 'backfill_negative_json_value'
         END,
         t.qty,
         'JSONB key "' || t.json_key || '" of items.stocks was not copied to item_warehouse_stocks',
         'migration 0020'
  FROM erp_tmp_json_stock t
  WHERE t.qty IS NULL
     OR (t.warehouse_id IS NULL AND t.qty <> 0)
     OR (t.warehouse_id IS NOT NULL AND t.qty < 0);

  -- several JSON keys of the same warehouse: added together (AGENTS.md section 12) and recorded
  INSERT INTO inventory_reconciliation_anomalies (run_id, item_id, warehouse_id, warehouse_code, kind, after_qty, details, created_by)
  SELECT p_run_id, t.item_id, t.warehouse_id, w.code, 'backfill_duplicate_json_keys', SUM(t.qty),
         'keys ' || string_agg('"' || t.json_key || '"=' || t.qty::text, ', ' ORDER BY t.json_key) || ' map to one warehouse and were added',
         'migration 0020'
  FROM erp_tmp_json_stock t
  JOIN warehouses w ON w.id = t.warehouse_id
  WHERE t.qty > 0
  GROUP BY t.item_id, t.warehouse_id, w.code
  HAVING COUNT(*) > 1
     AND NOT EXISTS (SELECT 1 FROM item_warehouse_stocks s WHERE s.item_id = t.item_id AND s.warehouse_id = t.warehouse_id);

  -- missing rows created from the JSONB value (existing rows are never changed: the table is the source of truth)
  WITH missing AS (
    SELECT t.item_id, t.warehouse_id, w.code, SUM(t.qty) AS qty
    FROM erp_tmp_json_stock t
    JOIN warehouses w ON w.id = t.warehouse_id
    WHERE t.qty > 0
      AND NOT EXISTS (SELECT 1 FROM item_warehouse_stocks s WHERE s.item_id = t.item_id AND s.warehouse_id = t.warehouse_id)
    GROUP BY t.item_id, t.warehouse_id, w.code
  ), created AS (
    INSERT INTO item_warehouse_stocks (item_id, warehouse_id, warehouse_code, current_stock, reserved_stock, version, created_at, updated_at)
    SELECT m.item_id, m.warehouse_id, m.code, m.qty, 0, 1, now(), now()
    FROM missing m
    ON CONFLICT (item_id, warehouse_id) DO NOTHING
    RETURNING item_id, warehouse_id, warehouse_code, current_stock
  )
  INSERT INTO inventory_reconciliation_anomalies (run_id, item_id, warehouse_id, warehouse_code, kind, before_qty, after_qty, details, created_by)
  SELECT p_run_id, c.item_id, c.warehouse_id, c.warehouse_code, 'backfill_row_created', 0, c.current_stock,
         'item_warehouse_stocks row created from items.stocks', 'migration 0020'
  FROM created c;

  -- read cache rebuilt from the table wherever it differs (zero entries ignored when comparing)
  WITH table_cache AS (
    SELECT i.id AS item_id,
           i.stocks AS old_stocks,
           i.current_stock AS old_total,
           COALESCE((SELECT jsonb_object_agg(x.code, x.qty)
                     FROM (SELECT w.code, SUM(s.current_stock) AS qty
                           FROM item_warehouse_stocks s JOIN warehouses w ON w.id = s.warehouse_id
                           WHERE s.item_id = i.id
                           GROUP BY w.code) x), '{}'::jsonb) AS new_stocks,
           COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.item_id = i.id), 0) AS new_total
    FROM items i
    WHERE p_item_id IS NULL OR i.id = p_item_id
  ), differing AS (
    SELECT tc.*
    FROM table_cache tc
    WHERE tc.old_total IS DISTINCT FROM tc.new_total
       OR COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(CASE WHEN jsonb_typeof(tc.old_stocks) = 'object' THEN tc.old_stocks ELSE '{}'::jsonb END) AS o(k, v)
                    WHERE NOT (jsonb_typeof(v) = 'number' AND (v #>> '{}')::numeric = 0)), '{}'::jsonb)
          IS DISTINCT FROM
          COALESCE((SELECT jsonb_object_agg(k, v) FROM jsonb_each(tc.new_stocks) AS n(k, v)
                    WHERE NOT ((v #>> '{}')::numeric = 0)), '{}'::jsonb)
  ), logged AS (
    INSERT INTO inventory_reconciliation_anomalies (run_id, item_id, kind, before_qty, after_qty, details, created_by)
    SELECT p_run_id, d.item_id, 'cache_rebuilt_from_table', d.old_total, d.new_total,
           'items.stocks ' || COALESCE(d.old_stocks::text, 'null') || ' -> ' || d.new_stocks::text, 'migration 0020'
    FROM differing d
    RETURNING item_id
  )
  UPDATE items i
  SET stocks = d.new_stocks,
      current_stock = d.new_total,
      version = COALESCE(i.version, 1) + 1
  FROM differing d
  WHERE i.id = d.item_id;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  TRUNCATE erp_tmp_json_stock;
  RETURN v_changed;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  v_changed integer;
BEGIN
  v_changed := erp_backfill_item_warehouse_stocks(NULL, 'migration-0020');
  RAISE NOTICE 'Migration 0020: item_warehouse_stocks is the single stock source; % item caches rebuilt.', v_changed;
END $$;
