-- Drizzle Migration 0076: link a procurement purchase order to its purchase requisition (v9.0.272 / TD-691, finding
-- B10-04, product-owner decision t2 of package 10, option A)
--
-- A procurement order used to be recognised by text: the procurement order list, the desk summary and "deliver to
-- warehouse" treated every receipt as a procurement order (and the summary counted sales proformas too), and the
-- requisition of an order was read from the note tag "[تدارکات: درخواست <code>]". Delivery finalized any draft receipt
-- for a user who only held procurement permissions. The order now carries documents.procurement_requisition_id, written by
-- "convert to orders"; the list, the summary and delivery read only documents with this link.
--
-- Backfill: only incoming documents (receipt, purchase) whose notes hold the exact tag of exactly one requisition, and
-- only when no live requisition lists the document in its linkedDocumentIds under another requisition. Every other case
-- (a tag of a missing code, tags of two requisitions, a conflicting linkedDocumentIds entry, a document listed in a
-- requisition without the tag) is left unlinked and listed by the financial health check
-- (procurement_order_link_unresolved); nothing else is rewritten. The UPDATE runs through
-- erp_update_with_unvalidated_checks (0047) because documents can hold NOT VALID CHECK constraints. Runs inside the
-- Drizzle migrator transaction.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS procurement_requisition_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_procurement_requisition' AND conrelid = 'documents'::regclass) THEN
    ALTER TABLE documents ADD CONSTRAINT fk_documents_procurement_requisition
      FOREIGN KEY (procurement_requisition_id) REFERENCES purchase_requisitions(id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_docs_procurement_requisition ON documents (procurement_requisition_id) WHERE procurement_requisition_id IS NOT NULL;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('documents', $sql$
WITH tagged AS (
  SELECT d.id AS document_id, pr.id AS requisition_id
    FROM documents d
    JOIN purchase_requisitions pr ON strpos(d.notes, '[تدارکات: درخواست ' || pr.code || ']') > 0
   WHERE d.procurement_requisition_id IS NULL
     AND d.type IN ('receipt', 'purchase')
), single AS (
  SELECT document_id, min(requisition_id) AS requisition_id
    FROM tagged
   GROUP BY document_id
  HAVING count(DISTINCT requisition_id) = 1
), listed AS (
  SELECT DISTINCT (link #>> '{}')::integer AS document_id, pr.id AS requisition_id
    FROM purchase_requisitions pr
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(pr.items) = 'array' THEN pr.items ELSE '[]'::jsonb END) AS row_item
   CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(row_item -> 'linkedDocumentIds') = 'array' THEN row_item -> 'linkedDocumentIds' ELSE '[]'::jsonb END) AS link
   WHERE pr.is_deleted = 0
     AND (link #>> '{}') ~ '^[0-9]{1,9}$'
)
UPDATE documents d
   SET procurement_requisition_id = single.requisition_id
  FROM single
 WHERE d.id = single.document_id
   AND NOT EXISTS (
         SELECT 1 FROM listed
          WHERE listed.document_id = single.document_id
            AND listed.requisition_id <> single.requisition_id)
$sql$);
