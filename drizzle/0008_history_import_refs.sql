-- v11 history import, tool 3 (the 1405 replay): the Excel number of each past sales invoice the import recorded.
--
-- A past sales return (warehouse sheet, «مرجوعی») and a past customer receipt (treasury sheet, «شماره مرجع-فاکتور») name
-- the sales invoice by its Excel number, which is not the app's number. The import records the pair here when it records
-- the invoice, so a return is linked to its invoice and a receipt settles that invoice first. One live document per
-- Excel number and kind; a voided document's row is taken over by the next import of that number. New table only; no
-- existing row is read or changed.
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS history_import_refs (
  kind text NOT NULL,
  excel_ref text NOT NULL,
  document_id integer NOT NULL REFERENCES documents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT history_import_refs_pkey PRIMARY KEY (kind, excel_ref),
  CONSTRAINT chk_history_import_refs_kind CHECK (kind = ANY (ARRAY['sales_invoice'::text])),
  CONSTRAINT chk_history_import_refs_excel_ref CHECK (length(trim(excel_ref)) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_history_import_refs_document ON history_import_refs (document_id);
