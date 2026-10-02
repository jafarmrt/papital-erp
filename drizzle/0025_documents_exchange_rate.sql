-- Drizzle Migration 0025: structured exchange rate on documents (v7.0.63 / TD-198)
--
-- Until v7.0.62 the accounting voucher of a foreign-currency document took its exchange rate from the free-text
-- notes («نرخ تسعیر: …» / exchange_rate) or from a hidden setting key, and silently used 1 when neither existed;
-- the forms had no field for it. From v7.0.63 the rate (IRR per one unit of the document currency) lives in
-- documents.exchange_rate and is required for every non-IRR document on create, edit and finalize.
--
-- Existing rows are not changed (product-owner decision, same as TD-199): no rate is copied out of notes.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 4);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_documents_exchange_rate_positive') THEN
    ALTER TABLE documents
      ADD CONSTRAINT chk_documents_exchange_rate_positive CHECK (exchange_rate IS NULL OR exchange_rate > 0);
  END IF;
END $$;
