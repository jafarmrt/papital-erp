-- Drizzle Migration 0013: Integrity Remediation & DDL Formalization (Version 7 Phase 1)
-- Integrates all ad-hoc DDL into the official transactional migration pipeline (TD-162 & TD-166).

DO $$
BEGIN
  -- 1. Project stages updated_at and trigger
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_stages' AND column_name='updated_at' AND table_schema = current_schema()) THEN
    ALTER TABLE project_stages ADD COLUMN updated_at timestamp DEFAULT now();
  END IF;

  DROP TRIGGER IF EXISTS trg_project_stages_updated_at ON project_stages;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = current_schema()::regnamespace) THEN
    CREATE TRIGGER trg_project_stages_updated_at BEFORE UPDATE ON project_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  -- 2. Financial attachments columns
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE cheques ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE treasury_transactions ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE production_projects ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

  -- 3. Piecework payroll atomic numbering sequence
  CREATE SEQUENCE IF NOT EXISTS piecework_payroll_number_seq START WITH 1001 INCREMENT BY 1;

  -- 4. Piecework payroll paid_amount column & backfill
  ALTER TABLE piecework_payrolls ADD COLUMN IF NOT EXISTS paid_amount numeric(18, 4) DEFAULT 0;
  UPDATE piecework_payrolls SET paid_amount = net_payable WHERE status = 'paid' AND (paid_amount IS NULL OR paid_amount = 0);

  -- 5. Soft-delete columns for line items and transfers
  ALTER TABLE document_items ADD COLUMN IF NOT EXISTS is_deleted integer DEFAULT 0;
  ALTER TABLE journal_voucher_items ADD COLUMN IF NOT EXISTS is_deleted integer DEFAULT 0;
  ALTER TABLE transfers ADD COLUMN IF NOT EXISTS is_deleted integer DEFAULT 0;

  CREATE INDEX IF NOT EXISTS idx_jvi_deleted ON journal_voucher_items (is_deleted);
  CREATE INDEX IF NOT EXISTS idx_transfer_deleted ON transfers (is_deleted);
  CREATE INDEX IF NOT EXISTS idx_doc_items_deleted ON document_items (is_deleted);

  -- 6. TD-166: Index on documents.project_id for fast foreign key lookups
  CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents (project_id);

  RAISE NOTICE 'Migration 0013: Integrity remediation and DDL formalization applied successfully.';
END $$;
