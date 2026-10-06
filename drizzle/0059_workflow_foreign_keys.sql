-- Drizzle Migration 0059: foreign keys, lookup indexes and a unique version number for the workflow tables
-- (v9.0.51 / TD-461, finding B14-19)
--
-- The Drizzle schema declared foreign keys on the workflow tables but the database had none: a step or action could point to
-- a missing workflow or step, a definition with instances could be deleted, and deleting an instance left its history, tasks
-- and pending approvals behind. Finding an entity's instance (the widget of every document) and an instance's history or
-- pending approvals read the whole table, and two versions of one definition could share a number.
--
-- Only references between workflow tables that the application keeps are added. Instances, history, tasks and pending
-- approvals keep step and action ids of the instance's own snapshot (a design save replaces the step and action rows), and
-- user columns keep the id of a user that may be removed, so those columns get no foreign key.
--
-- Each foreign key is added NOT VALID (enforced for new rows at once) and validated only when no existing row breaks it;
-- old rows are never changed or deleted here. The unique version index is created only when no definition has two versions
-- with one number. Whatever is left unvalidated or uncreated is listed by the financial health check
-- (workflow_reference_integrity). Runs inside the Drizzle migrator transaction.

DO $$
DECLARE
  fk record;
  orphan boolean;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('fk_wf_states_definition', 'workflow_states', 'workflow_definition_id', 'workflow_definitions', 'NO ACTION'),
      ('fk_wf_transitions_definition', 'workflow_transitions', 'workflow_definition_id', 'workflow_definitions', 'NO ACTION'),
      ('fk_wf_transitions_from_state', 'workflow_transitions', 'from_state_id', 'workflow_states', 'NO ACTION'),
      ('fk_wf_transitions_to_state', 'workflow_transitions', 'to_state_id', 'workflow_states', 'NO ACTION'),
      ('fk_wf_instances_definition', 'workflow_instances', 'workflow_definition_id', 'workflow_definitions', 'NO ACTION'),
      ('fk_wf_versions_definition', 'workflow_definition_versions', 'definition_id', 'workflow_definitions', 'CASCADE'),
      ('fk_wf_history_instance', 'workflow_history_logs', 'instance_id', 'workflow_instances', 'CASCADE'),
      ('fk_wf_tasks_instance', 'workflow_tasks', 'instance_id', 'workflow_instances', 'CASCADE'),
      ('fk_wf_pending_instance', 'workflow_pending_approvals', 'instance_id', 'workflow_instances', 'CASCADE')
    ) AS t(name, tbl, col, ref, on_delete)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = fk.name AND conrelid = to_regclass(fk.tbl)
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (id) ON DELETE %s NOT VALID',
        fk.tbl, fk.name, fk.col, fk.ref, fk.on_delete);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I))',
      fk.tbl, fk.col, fk.ref, fk.col) INTO orphan;
    IF orphan THEN
      RAISE NOTICE '% has rows whose % points to a missing % row; % left NOT VALID (see the financial health check)',
        fk.tbl, fk.col, fk.ref, fk.name;
    ELSE
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tbl, fk.name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wfi_entity ON workflow_instances (entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wfh_instance ON workflow_history_logs (instance_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wfpa_instance ON workflow_pending_approvals (instance_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wfs_definition ON workflow_states (workflow_definition_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wftr_definition ON workflow_transitions (workflow_definition_id);
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('uq_wdv_definition_version') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM workflow_definition_versions GROUP BY definition_id, version HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'workflow_definition_versions has a definition with two versions of one number; uq_wdv_definition_version not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_wdv_definition_version ON workflow_definition_versions (definition_id, version);
    END IF;
  END IF;
END $$;
