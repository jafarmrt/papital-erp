-- Drizzle Migration 0083: link a consolidated purchase requisition to the requisition it went into (v9.0.349 / TD-694,
-- finding B10-07, product-owner decision t3 of package 10, option A)
--
-- Consolidation used to create the new requisition outside any transaction and leave its sources open (pending, or even
-- received), so one need could be ordered several times. Now only unapproved requisitions without orders are
-- consolidated, and in the same transaction each source gets status 'consolidated' and purchase_requisitions.
-- consolidated_into_id = the new requisition, and its workflow is terminated through the engine.
--
-- Nothing old is rewritten: the sources of an earlier consolidation that are still open are listed by the financial
-- health check (procurement_consolidation_open_sources). Runs inside the Drizzle migrator transaction.

ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS consolidated_into_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_purchase_requisitions_consolidated_into' AND conrelid = 'purchase_requisitions'::regclass) THEN
    ALTER TABLE purchase_requisitions ADD CONSTRAINT fk_purchase_requisitions_consolidated_into
      FOREIGN KEY (consolidated_into_id) REFERENCES purchase_requisitions(id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pr_consolidated_into ON purchase_requisitions (consolidated_into_id) WHERE consolidated_into_id IS NOT NULL;
