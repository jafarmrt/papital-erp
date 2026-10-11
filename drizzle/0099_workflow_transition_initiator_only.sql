-- Drizzle Migration 0099: a transition only the instance initiator may run (v10.0.120 / TD-1220, guide test finding B-01)
--
-- The default document workflow let anyone holding a workflow key send a sales document to the warehouse, so a buyer
-- with documents.create sent a seller's proforma. The designer gets a per-transition flag «فقط آغازکننده اجرا کند»: when
-- set, only the user who started the instance (workflow_instances.started_by), signing for themselves or as a delegate
-- of that user, runs it; the system admin still can. Default 0 keeps every existing transition as it was. The flag
-- carries the standard 0/1 CHECK (AGENTS.md §1.9); the new column has only the default, so it is validated.
-- Runs inside the migrator transaction.

ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS is_initiator_only integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_transitions_is_initiator_only_flag' AND conrelid = 'workflow_transitions'::regclass) THEN
    ALTER TABLE workflow_transitions ADD CONSTRAINT chk_workflow_transitions_is_initiator_only_flag CHECK (is_initiator_only IN (0, 1));
  END IF;
END $$;
