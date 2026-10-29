-- v11 (the 1405 replay, tool 5, owner's decision 7 Aban 1405): an expense line may name the production project it was
-- spent on. The line of a petty cash statement or of a colleague's out-of-pocket expense keeps the project, and its voucher
-- line carries the project as its detail, so the project summary report counts it. A treasury expense payment carries
-- the project on its voucher line only. New nullable columns and their indexes; no existing row is read or changed.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE petty_cash_expense_lines ADD COLUMN IF NOT EXISTS project_id integer REFERENCES production_projects(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_petty_cash_expense_lines_project_id ON petty_cash_expense_lines (project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE colleague_expense_lines ADD COLUMN IF NOT EXISTS project_id integer REFERENCES production_projects(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_colleague_expense_lines_project_id ON colleague_expense_lines (project_id) WHERE project_id IS NOT NULL;
