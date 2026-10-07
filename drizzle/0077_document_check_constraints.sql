-- Drizzle Migration 0077: CHECK constraints on documents and document lines, and one index on documents.project_id
-- (v9.0.289 / TD-786, finding B08-17)
--
-- Only the services checked that a document has a known type and status and that a document line has a non-negative
-- quantity, unit price and discount; a direct write or a service bug could store anything. Each rule below is enforced by
-- the database from now on. A line's quantity is checked as >= 0, not > 0: a stock count line stores the counted quantity,
-- which is zero when nothing was found; the services keep refusing a zero quantity on every other line, and the financial
-- health check lists such legacy lines.
--
-- A soft-deleted row (is_deleted = 1) is exempt: no report reads it, and a legacy row that breaks a rule can still be voided
-- or replaced (a NOT VALID CHECK applies to every updated row). Each constraint is added NOT VALID (new and updated rows
-- must hold it at once) and validated only when no existing row breaks it; old rows are never changed or deleted here.
-- Whatever is left unvalidated is listed by the financial health check (document_integrity_constraints).
--
-- documents.project_id had two identical indexes (idx_docs_project from 0006, kept by the schema, and
-- idx_documents_project_id from 0013); the second one is dropped. Runs inside the Drizzle migrator transaction.

DO $$
DECLARE
  rule record;
  broken boolean;
BEGIN
  FOR rule IN
    SELECT * FROM (VALUES
      ('chk_documents_type', 'documents',
        'COALESCE(is_deleted, 0) = 1 OR type IN (''receipt'', ''purchase'', ''production_receipt'', ''return'', ''invoice'', ''proforma'', ''remittance'', ''waste'', ''audit'', ''transfer'')'),
      ('chk_documents_status', 'documents',
        'COALESCE(is_deleted, 0) = 1 OR COALESCE(status, '''') IN (''draft'', ''proforma'', ''final'')'),
      ('chk_document_items_quantity', 'document_items',
        'COALESCE(is_deleted, 0) = 1 OR quantity >= 0'),
      ('chk_document_items_unit_price', 'document_items',
        'COALESCE(is_deleted, 0) = 1 OR COALESCE(unit_price, 0) >= 0'),
      ('chk_document_items_discount', 'document_items',
        'COALESCE(is_deleted, 0) = 1 OR COALESCE(discount, 0) >= 0')
    ) AS t(name, tbl, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = rule.name AND conrelid = to_regclass(rule.tbl)
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', rule.tbl, rule.name, rule.expr);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE NOT (%s))', rule.tbl, rule.expr) INTO broken;
    IF broken THEN
      RAISE NOTICE '% has rows that break %; constraint left NOT VALID (see the financial health check)', rule.tbl, rule.name;
    ELSE
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', rule.tbl, rule.name);
    END IF;
  END LOOP;

  CREATE INDEX IF NOT EXISTS idx_docs_project ON documents (project_id);
  DROP INDEX IF EXISTS idx_documents_project_id;
END $$;
