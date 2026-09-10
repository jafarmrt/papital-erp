-- V3.2.0 — Purchase Requisitions & Procurement Workflow (سیستم درخواست خرید و تدارکات)
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  project_id integer REFERENCES production_projects(id),
  project_code text DEFAULT '',
  project_name text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'normal',
  required_date text DEFAULT '',
  requested_by_id integer REFERENCES users(id),
  requested_by_name text DEFAULT '',
  assigned_to_id integer REFERENCES users(id),
  assigned_to_name text DEFAULT '',
  workflow_instance_id integer REFERENCES workflow_instances(id),
  notes text DEFAULT '',
  total_estimated_amount numeric(18, 2) DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_deleted integer DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pr_code ON purchase_requisitions (code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pr_project ON purchase_requisitions (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requisitions (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pr_priority ON purchase_requisitions (priority);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pr_workflow ON purchase_requisitions (workflow_instance_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pr_deleted ON purchase_requisitions (is_deleted);
