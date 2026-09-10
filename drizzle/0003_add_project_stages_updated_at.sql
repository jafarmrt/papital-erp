-- V3.1.13: Fix missing updated_at on project_stages table to support trg_project_stages_updated_at trigger
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_project_stages_updated_at ON project_stages;
--> statement-breakpoint
CREATE TRIGGER trg_project_stages_updated_at BEFORE UPDATE ON project_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
