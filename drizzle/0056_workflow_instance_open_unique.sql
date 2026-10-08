-- Drizzle Migration 0056: one in-progress workflow instance per entity (v9.0.37 / TD-455, finding B14-13)
--
-- startInstance checked for an open instance and then inserted, with no lock or constraint, so concurrent starts on one
-- entity (the automatic start of POST /documents and the browser's start of a proforma) created two IN_PROGRESS
-- instances: the second one was hidden from the document widget but stayed in the inbox. startInstance now takes a
-- transaction advisory lock on the entity (namespace 91009) before the check, and this partial unique index is the
-- final safeguard.
--
-- The index is created only when existing data has no entity with two IN_PROGRESS instances: old instances are never
-- closed or changed here. When duplicates exist the index is skipped (startup is not blocked) and the financial health
-- check lists them (workflow_open_instance_uniqueness). Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_workflow_instances_open_entity')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM workflow_instances WHERE status = 'IN_PROGRESS'
      GROUP BY entity_type, entity_id HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'workflow_instances has entities with more than one IN_PROGRESS instance; uq_workflow_instances_open_entity not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_workflow_instances_open_entity ON workflow_instances (entity_type, entity_id)
        WHERE status = 'IN_PROGRESS';
    END IF;
  END IF;
END $$;
