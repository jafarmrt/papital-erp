-- Drizzle Migration 0080: one live stage per project and stage number, and stages only of existing projects
-- (v9.0.336 / TD-737 and TD-753, findings B11-03 and B11-19 of package 11)
--
-- A new stage took "number of live stages + 1": after a stage was deleted the new stage reused a number and inherited the
-- deleted stage's progress ticks (a project became completed with no work done), and two stages could share a number
-- after deleting a middle stage or adding concurrently. A stage could also be added to a deleted or missing project:
-- project_stages had no foreign key although the schema declared one.
--
-- The application now numbers a new stage after every number the project has used, under the project row lock, and
-- soft-deletes a deleted stage's progress rows (src/services/projects.service.ts). This migration adds:
--   * the partial unique index uq_project_stages_order_active (project_id, stage_order) WHERE is_deleted = 0, created
--     only when no project has two live stages with one number;
--   * the foreign key fk_project_stages_project (project_id -> production_projects.id), added NOT VALID (enforced for
--     new rows at once) and validated only when no existing stage points to a missing project.
-- Old rows are never changed or deleted here; what is left is listed by the financial health check
-- (project_stage_integrity). Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass('uq_project_stages_order_active') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM project_stages WHERE is_deleted = 0 GROUP BY project_id, stage_order HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'project_stages has two live stages with one number in a project; uq_project_stages_order_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_project_stages_order_active ON project_stages (project_id, stage_order) WHERE is_deleted = 0;
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_project_stages_project' AND conrelid = to_regclass('project_stages')
  ) THEN
    ALTER TABLE project_stages ADD CONSTRAINT fk_project_stages_project
      FOREIGN KEY (project_id) REFERENCES production_projects (id) NOT VALID;
  END IF;
  IF EXISTS (
    SELECT 1 FROM project_stages s WHERE NOT EXISTS (SELECT 1 FROM production_projects p WHERE p.id = s.project_id)
  ) THEN
    RAISE NOTICE 'project_stages has rows of a missing project; fk_project_stages_project left NOT VALID (see the financial health check)';
  ELSE
    ALTER TABLE project_stages VALIDATE CONSTRAINT fk_project_stages_project;
  END IF;
END $$;
