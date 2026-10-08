-- Drizzle Migration 0095: a project reservation deduction may come from a material allocation (v9.0.452 / TD-918,
-- phase 5 finding P5-M01, rule of TD-233 / TD-237)
--
-- A final remittance of a project deducts the project's reservation and records each deduction in
-- project_reservation_releases, so voiding the remittance gives the same quantities back. A material allocation moved the
-- same stock out of the warehouse without deducting the reservation, so the project kept reserving what it had already
-- taken and blocked the next sale of new stock. An allocation now deducts the reservation too and its release gives it
-- back: a deduction row belongs to exactly one source, a document or an allocation (bom_allocation_id, ON DELETE CASCADE
-- like document_id, which becomes nullable). The new column holds no value yet, so its foreign key is validated at once
-- (registered for the health check like every key of TD-611) and the source check holds for the existing rows, which all
-- hold a document. Data is not changed. Runs inside the Drizzle migrator transaction.

ALTER TABLE project_reservation_releases ADD COLUMN IF NOT EXISTS bom_allocation_id integer;
--> statement-breakpoint
ALTER TABLE project_reservation_releases ALTER COLUMN document_id DROP NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_project_reservation_releases_bom_allocation_id' AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE project_reservation_releases ADD CONSTRAINT fk_project_reservation_releases_bom_allocation_id
      FOREIGN KEY (bom_allocation_id) REFERENCES project_bom_allocations (id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_reservation_releases r
    WHERE r.bom_allocation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_bom_allocations a WHERE a.id = r.bom_allocation_id)
  ) THEN
    ALTER TABLE project_reservation_releases VALIDATE CONSTRAINT fk_project_reservation_releases_bom_allocation_id;
  ELSE
    RAISE WARNING 'fk_project_reservation_releases_bom_allocation_id left NOT VALID: rows point to a missing allocation';
  END IF;

  -- every existing row holds a document (the column was NOT NULL) and none an allocation, so the check holds at once
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_project_reservation_releases_source' AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE project_reservation_releases ADD CONSTRAINT chk_project_reservation_releases_source
      CHECK (num_nonnulls(document_id, bom_allocation_id) = 1);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_reservation_releases_bom_allocation_id
  ON project_reservation_releases (bom_allocation_id) WHERE bom_allocation_id IS NOT NULL;
