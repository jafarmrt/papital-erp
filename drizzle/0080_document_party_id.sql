-- Drizzle Migration 0080: the party of a document by id (v9.0.336 / TD-778, finding B08-09, product-owner decision t6 option A
-- of package 8)
--
-- A document knew its party only by the text of buyer_name. The sales and purchase vouchers, the customer dossier, the
-- treasury link and the party delete guard matched that text exactly against customers.name, so an Arabic «ي» or a
-- different letter case left the voucher row without a detailed id: the party's account card and dossier stayed empty and
-- the party was deleted with its open balance. A document of a party type (sales invoice, proforma, sales return,
-- receipt, purchase) now stores the party it was issued to in party_id; the voucher, the dossier, the treasury link and
-- the delete guard read it, and buyer_name is only the display name.
--
-- Backfill: an existing document of a party type takes the party whose trimmed name equals its trimmed buyer name, only
-- when exactly one live party has that name; every other document keeps NULL, the readers keep the old exact-name rule for
-- it, and the financial health check lists it (document_party_unlinked). No ledger row is rewritten. The UPDATE runs
-- through erp_update_with_unvalidated_checks (0047) because documents can hold NOT VALID CHECK constraints. Runs inside the
-- Drizzle migrator transaction.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS party_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_party' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE documents ADD CONSTRAINT fk_documents_party FOREIGN KEY (party_id) REFERENCES customers(id);
  END IF;
END $$;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('documents', $sql$
WITH matches AS (
  SELECT d.id AS document_id, min(c.id) AS party_id, count(*) AS parties
  FROM documents d
  JOIN customers c ON c.is_deleted = 0 AND btrim(c.name) = btrim(d.buyer_name)
  WHERE d.party_id IS NULL
    AND d.type IN ('invoice', 'proforma', 'return', 'receipt', 'purchase')
    AND btrim(COALESCE(d.buyer_name, '')) <> ''
  GROUP BY d.id
)
UPDATE documents d
SET party_id = matches.party_id
FROM matches
WHERE d.id = matches.document_id AND matches.parties = 1
$sql$);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_party_id ON documents (party_id) WHERE party_id IS NOT NULL;
