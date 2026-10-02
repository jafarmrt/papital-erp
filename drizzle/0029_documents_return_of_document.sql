-- Drizzle Migration 0029: link of a sales return to its original sales invoice (v7.0.81 / TD-230)
--
-- Product-owner decision: a sales return enters stock at the cost the goods left with on the original
-- sales invoice (the invoice's Kardex `out` rows), not at the sale price. The return form used to keep the
-- invoice number only as free text in notes; this column stores the invoice id. Existing returns stay
-- unlinked (NULL) and are not changed.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS return_of_document_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_documents_return_of_document' AND conrelid = 'documents'::regclass
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT fk_documents_return_of_document
      FOREIGN KEY (return_of_document_id) REFERENCES documents(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_docs_return_of_document ON documents (return_of_document_id);
