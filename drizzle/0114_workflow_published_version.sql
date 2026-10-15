-- Drizzle Migration 0114: draft and published workflow versions (v10.1.19, TD-1270, D-06 part D)
--
-- Every design save rewrote the steps and took effect for the next record at once, so a half-finished design reached
-- the daily work (decision ت۱۰ of the D-06 plan). A save of an existing definition now records a draft version, and new
-- records start with the published version (workflow_definitions.published_version) until the system admin publishes the
-- draft or reverts to an earlier version.
--
-- No workflow changes behaviour here: each definition's current version becomes its published version, its version row
-- (the newest row of that number) is marked published and every other version row retired. The status column is new,
-- so its CHECK constraint is added valid, and the partial unique index (one published version per definition) holds by
-- construction. The column defaults to retired: the code names every row's status, and a row written without one (an older
-- data migration, a test fixture) never claims to be the published version. Runs inside the Drizzle migrator transaction.

ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS published_version integer;
--> statement-breakpoint
ALTER TABLE workflow_definition_versions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'retired';
--> statement-breakpoint
UPDATE workflow_definitions SET published_version = version WHERE published_version IS NULL;
--> statement-breakpoint
UPDATE workflow_definition_versions v SET status = CASE
    WHEN v.id = (
      SELECT max(o.id) FROM workflow_definition_versions o
      JOIN workflow_definitions d ON d.id = o.definition_id
      WHERE o.definition_id = v.definition_id AND o.version = d.published_version
    ) THEN 'published'
    ELSE 'retired'
  END;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_definition_versions_status' AND conrelid = 'workflow_definition_versions'::regclass) THEN
    ALTER TABLE workflow_definition_versions ADD CONSTRAINT chk_workflow_definition_versions_status
      CHECK (status IN ('draft', 'published', 'retired'));
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_wdv_definition_published ON workflow_definition_versions (definition_id)
  WHERE status = 'published';
