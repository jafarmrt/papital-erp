-- v11 history import, tool 6 (the 1405 replay): the Excel invoice number of each past purchase receipt the import recorded.
--
-- A past supplier payment on the «هزینه‌ها» sheet names the purchase by the supplier's invoice number («شماره مرجع-فاکتور»),
-- which is also the «شماره فاکتور مرجع» of the receipt rows on the warehouse sheet. The import records the pair here when it
-- records the receipt, so the payment settles that receipt first. Several receipts can share one supplier and number (one
-- per day and warehouse), and one receipt paid in several rows names each of them, so the row is keyed by the document and
-- the number. New table only; no existing row is read or changed.
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS history_import_purchase_refs (
  document_id integer NOT NULL REFERENCES documents(id),
  supplier_id integer NOT NULL REFERENCES customers(id),
  excel_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT history_import_purchase_refs_pkey PRIMARY KEY (document_id, excel_ref),
  CONSTRAINT chk_history_import_purchase_refs_excel_ref CHECK (length(trim(excel_ref)) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_history_import_purchase_refs_supplier_ref ON history_import_purchase_refs (supplier_id, excel_ref);
