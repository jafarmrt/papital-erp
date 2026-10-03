-- Drizzle Migration 0034: record of project reservations deducted by remittances (v7.0.105 / TD-237)
--
-- Product-owner decision (2026-10-03, «برگردد»): when a final out document with a project is voided or deleted,
-- the reservation it deducted (v7.0.102, TD-233) is reserved again for the same project. Every deduction is
-- recorded here with the reservation row as it was; voiding the document adds the recorded quantity back and
-- stamps restored_at. Documents deducted before v7.0.105 have no record and restore nothing.

CREATE TABLE IF NOT EXISTS project_reservation_releases (
  id serial PRIMARY KEY,
  document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  project_id integer NOT NULL REFERENCES production_projects(id) ON DELETE CASCADE,
  item_id integer,
  qty_field text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  reservation_row jsonb NOT NULL,
  created_at timestamp DEFAULT now(),
  restored_at timestamp,
  CONSTRAINT chk_prr_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_prr_qty_field CHECK (qty_field IN ('convertedReservedQty', 'convertedQty', 'reservedQty', 'warehouseStockQty', 'stockQty'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prr_document ON project_reservation_releases (document_id);
