-- Drizzle Migration 0019: Inventory reconciliation anomaly log (v7.0.33 / TD-200 — audit P1-9)
--
-- Migration 0014 copied items.stocks (JSONB) into item_warehouse_stocks but silently clamped negative
-- balances to zero, let a second JSON key that resolved to the same warehouse OVERWRITE the first instead of
-- adding to it, and stored the raw JSON key (possibly a warehouse NAME) as warehouse_code. Applied migrations
-- are never edited; instead a report compares item_warehouse_stocks with the Kardex ledger and an explicit,
-- manually triggered repair (product-owner decision) corrects quantities from the ledger. Every corrected
-- row and every row it refuses to correct (negative ledger balance, unresolvable Kardex location) is
-- recorded here for audit.
CREATE TABLE IF NOT EXISTS inventory_reconciliation_anomalies (
  id serial PRIMARY KEY,
  run_id text NOT NULL,
  item_id integer NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id integer REFERENCES warehouses(id) ON DELETE CASCADE,
  warehouse_code text NOT NULL DEFAULT '',
  kind text NOT NULL,
  ledger_qty numeric(18, 4),
  before_qty numeric(18, 4),
  after_qty numeric(18, 4),
  details text NOT NULL DEFAULT '',
  created_by text NOT NULL DEFAULT '',
  created_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_recon_anomalies_run ON inventory_reconciliation_anomalies (run_id);
CREATE INDEX IF NOT EXISTS idx_inv_recon_anomalies_item ON inventory_reconciliation_anomalies (item_id);
