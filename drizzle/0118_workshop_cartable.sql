-- Drizzle Migration 0118: data of the workshop cartable (v10.1.36, N-01 part 1, TD-1283)
--
-- project_managers: the users answerable for a project (plan decision t3 A); they review the workers' task reports.
-- documents.recipient_personnel_id and project_bom_allocations.recipient_personnel_id: the worker a remittance or a
-- material allocation is handed to (plan decision t4 A); optional, a live personnel.
-- stock_receipt_confirmations: a worker's «received» or «discrepancy» answer to a final remittance or allocation handed
-- to them, one per source; it never moves stock (plan decision t1 A).
-- workshop_task_reports: a worker's final quantity of one row of a project's workshop schedule, reviewed by a project
-- manager; an approved report holds the piecework log it made (plan decisions t2 A and t5 A). One live report
-- (submitted or approved) per schedule row.
-- uq_notifications_workshop_reminder: one deadline reminder per user, kind and schedule row (plan decision t8 A).
--
-- New tables and new empty columns only, so every foreign key is validated at once and no existing row is written;
-- each foreign key column has an index that leads with it (TD-614). Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS project_managers (
  id serial PRIMARY KEY,
  project_id integer NOT NULL,
  user_id integer NOT NULL,
  created_by_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fk_project_managers_project FOREIGN KEY (project_id) REFERENCES production_projects (id),
  CONSTRAINT fk_project_managers_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_project_managers_created_by FOREIGN KEY (created_by_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_managers_project_user ON project_managers (project_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_managers_user ON project_managers (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_managers_created_by ON project_managers (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE documents ADD COLUMN IF NOT EXISTS recipient_personnel_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_recipient_personnel' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE documents ADD CONSTRAINT fk_documents_recipient_personnel FOREIGN KEY (recipient_personnel_id) REFERENCES personnel (id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_recipient_personnel_id ON documents (recipient_personnel_id) WHERE recipient_personnel_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE project_bom_allocations ADD COLUMN IF NOT EXISTS recipient_personnel_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_project_bom_allocations_recipient_personnel' AND connamespace = current_schema()::regnamespace) THEN
    ALTER TABLE project_bom_allocations ADD CONSTRAINT fk_project_bom_allocations_recipient_personnel FOREIGN KEY (recipient_personnel_id) REFERENCES personnel (id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_bom_allocations_recipient_personnel_id ON project_bom_allocations (recipient_personnel_id) WHERE recipient_personnel_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS stock_receipt_confirmations (
  id serial PRIMARY KEY,
  document_id integer,
  bom_allocation_id integer,
  personnel_id integer NOT NULL,
  status text NOT NULL,
  note text NOT NULL DEFAULT '',
  confirmed_by_id integer NOT NULL,
  confirmed_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_receipt_confirmations_source CHECK (num_nonnulls(document_id, bom_allocation_id) = 1),
  CONSTRAINT chk_stock_receipt_confirmations_status CHECK (status IN ('received', 'discrepancy')),
  CONSTRAINT fk_stock_receipt_confirmations_document FOREIGN KEY (document_id) REFERENCES documents (id),
  CONSTRAINT fk_stock_receipt_confirmations_allocation FOREIGN KEY (bom_allocation_id) REFERENCES project_bom_allocations (id),
  CONSTRAINT fk_stock_receipt_confirmations_personnel FOREIGN KEY (personnel_id) REFERENCES personnel (id),
  CONSTRAINT fk_stock_receipt_confirmations_confirmed_by FOREIGN KEY (confirmed_by_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_receipt_confirmations_document ON stock_receipt_confirmations (document_id) WHERE document_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_receipt_confirmations_allocation ON stock_receipt_confirmations (bom_allocation_id) WHERE bom_allocation_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stock_receipt_confirmations_personnel ON stock_receipt_confirmations (personnel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_stock_receipt_confirmations_confirmed_by ON stock_receipt_confirmations (confirmed_by_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workshop_task_reports (
  id serial PRIMARY KEY,
  project_id integer NOT NULL,
  stage_id integer NOT NULL,
  product_id text NOT NULL,
  row_id text NOT NULL,
  personnel_id integer NOT NULL,
  task_id integer,
  quantity numeric(18, 4) NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted',
  approved_quantity numeric(18, 4),
  review_note text NOT NULL DEFAULT '',
  reviewed_by_id integer,
  reviewed_at timestamp,
  piecework_log_id integer,
  created_by_id integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT chk_workshop_task_reports_status CHECK (status IN ('submitted', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT chk_workshop_task_reports_quantity CHECK (quantity > 0),
  CONSTRAINT chk_workshop_task_reports_approved_quantity CHECK (approved_quantity IS NULL OR approved_quantity > 0),
  CONSTRAINT fk_workshop_task_reports_project FOREIGN KEY (project_id) REFERENCES production_projects (id),
  CONSTRAINT fk_workshop_task_reports_stage FOREIGN KEY (stage_id) REFERENCES project_stages (id),
  CONSTRAINT fk_workshop_task_reports_personnel FOREIGN KEY (personnel_id) REFERENCES personnel (id),
  CONSTRAINT fk_workshop_task_reports_task FOREIGN KEY (task_id) REFERENCES piecework_tasks (id),
  CONSTRAINT fk_workshop_task_reports_reviewed_by FOREIGN KEY (reviewed_by_id) REFERENCES users (id),
  CONSTRAINT fk_workshop_task_reports_piecework_log FOREIGN KEY (piecework_log_id) REFERENCES piecework_logs (id),
  CONSTRAINT fk_workshop_task_reports_created_by FOREIGN KEY (created_by_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_task_reports_live_row ON workshop_task_reports (project_id, stage_id, product_id, row_id) WHERE status IN ('submitted', 'approved');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workshop_task_reports_project ON workshop_task_reports (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workshop_task_reports_stage ON workshop_task_reports (stage_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workshop_task_reports_personnel ON workshop_task_reports (personnel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workshop_task_reports_task ON workshop_task_reports (task_id) WHERE task_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workshop_task_reports_reviewed_by ON workshop_task_reports (reviewed_by_id) WHERE reviewed_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workshop_task_reports_piecework_log ON workshop_task_reports (piecework_log_id) WHERE piecework_log_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workshop_task_reports_created_by ON workshop_task_reports (created_by_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_workshop_reminder ON notifications (user_id, type, link) WHERE type IN ('workshop_task_due_soon', 'workshop_task_overdue');
