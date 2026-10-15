-- Drizzle Migration 0110: archive flag and one active workflow definition per record type (v10.1.6, TD-1229, D-06 part A)
--
-- A workflow definition could not be turned off: every definition was created active and no route changed is_active,
-- so an item or bank account workflow, once made, sent every opening voucher to approval for good (OBS-R2-65). The new
-- activate, deactivate and archive actions keep at most one active definition per record type; before, an automatic
-- start silently took the oldest active one.
--
-- is_archived is a new flag (every row 0), so its CHECK constraints are added valid. The partial unique index on the
-- active definitions' entity type is created only when existing data has no record type with two active definitions:
-- no definition is deactivated here. When duplicates exist the index is skipped with a warning and the financial health
-- check lists them (workflow_active_definition_uniqueness). Runs inside the Drizzle migrator transaction.

ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS is_archived integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_definitions_is_archived_flag' AND conrelid = 'workflow_definitions'::regclass) THEN
    ALTER TABLE workflow_definitions ADD CONSTRAINT chk_workflow_definitions_is_archived_flag CHECK (is_archived IN (0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_definitions_archived_inactive' AND conrelid = 'workflow_definitions'::regclass) THEN
    ALTER TABLE workflow_definitions ADD CONSTRAINT chk_workflow_definitions_archived_inactive CHECK (is_archived = 0 OR is_active = 0);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_workflow_definitions_active_entity_type')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM workflow_definitions WHERE is_active = 1
      GROUP BY entity_type HAVING COUNT(*) > 1
    ) THEN
      RAISE WARNING 'workflow_definitions has record types with more than one active definition; uq_workflow_definitions_active_entity_type not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_workflow_definitions_active_entity_type ON workflow_definitions (entity_type)
        WHERE is_active = 1;
    END IF;
  END IF;
END $$;
