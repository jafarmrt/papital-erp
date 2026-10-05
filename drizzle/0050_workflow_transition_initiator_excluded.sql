-- Drizzle Migration 0050: per-transition separation of duties — the instance initiator may not run it (v8.0.102 / TD-392)
--
-- Product-owner decision («گزینه در هر گام»): the workflow designer gets a per-transition flag «آغازکننده تأیید نکند».
-- When set, the user who started the instance (workflow_instances.started_by) — signing for themselves or through a
-- delegation — cannot run that transition; an admin still can. Default 0 keeps every existing transition as it was.
-- The flag carries the standard 0/1 CHECK (AGENTS.md §1.9); the new column has only the default, so it is validated.
-- Runs inside the migrator transaction.

ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS is_initiator_excluded integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_transitions_is_initiator_excluded_flag' AND conrelid = 'workflow_transitions'::regclass) THEN
    ALTER TABLE workflow_transitions ADD CONSTRAINT chk_workflow_transitions_is_initiator_excluded_flag CHECK (is_initiator_excluded IN (0, 1));
  END IF;
END $$;
