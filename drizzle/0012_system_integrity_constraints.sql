-- Drizzle Migration 0012: System Integrity Constraints & DDL Hardening
-- Creates unique indices for sayad_number, active account codes, and formalizes dynamic DDLs.
DO $$
DECLARE
  dup_sayad integer;
  dup_accounts integer;
BEGIN
  -- 1. Unique index on active cheque Sayad numbers
  SELECT COUNT(*) INTO dup_sayad FROM (
    SELECT sayad_number FROM cheques
    WHERE is_deleted = 0 AND sayad_number IS NOT NULL AND sayad_number <> ''
    GROUP BY sayad_number HAVING COUNT(*) > 1
  ) s;
  IF dup_sayad = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_cheques_sayad_number_active') THEN
      EXECUTE 'CREATE UNIQUE INDEX uq_cheques_sayad_number_active ON cheques (sayad_number) WHERE is_deleted = 0 AND sayad_number IS NOT NULL AND sayad_number <> ''''';
      RAISE NOTICE 'Migration 0012: unique index uq_cheques_sayad_number_active created';
    END IF;
  ELSE
    RAISE WARNING 'Migration 0012: % duplicate sayad_number records found — unique index SKIPPED', dup_sayad;
  END IF;

  -- 2. Unique index on active accounting account codes
  SELECT COUNT(*) INTO dup_accounts FROM (
    SELECT code FROM accounts
    WHERE is_deleted = 0 AND code IS NOT NULL AND code <> ''
    GROUP BY code HAVING COUNT(*) > 1
  ) a;
  IF dup_accounts = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_accounts_code_active') THEN
      EXECUTE 'CREATE UNIQUE INDEX uq_accounts_code_active ON accounts (code) WHERE is_deleted = 0';
      RAISE NOTICE 'Migration 0012: unique index uq_accounts_code_active created';
    END IF;
  ELSE
    RAISE WARNING 'Migration 0012: % duplicate account code records found — unique index SKIPPED', dup_accounts;
  END IF;

  -- 3. Ensure project_stages updated_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_stages' AND column_name='updated_at') THEN
    EXECUTE 'ALTER TABLE project_stages ADD COLUMN updated_at timestamp DEFAULT now()';
  END IF;

  -- 4. Ensure attachments jsonb columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='documents' AND column_name='attachments') THEN
    EXECUTE 'ALTER TABLE documents ADD COLUMN attachments jsonb DEFAULT ''[]''::jsonb';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='journal_vouchers' AND column_name='attachments') THEN
    EXECUTE 'ALTER TABLE journal_vouchers ADD COLUMN attachments jsonb DEFAULT ''[]''::jsonb';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cheques' AND column_name='attachments') THEN
    EXECUTE 'ALTER TABLE cheques ADD COLUMN attachments jsonb DEFAULT ''[]''::jsonb';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='treasury_transactions' AND column_name='attachments') THEN
    EXECUTE 'ALTER TABLE treasury_transactions ADD COLUMN attachments jsonb DEFAULT ''[]''::jsonb';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='piecework_payrolls' AND column_name='attachments') THEN
    EXECUTE 'ALTER TABLE piecework_payrolls ADD COLUMN attachments jsonb DEFAULT ''[]''::jsonb';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='production_projects' AND column_name='attachments') THEN
    EXECUTE 'ALTER TABLE production_projects ADD COLUMN attachments jsonb DEFAULT ''[]''::jsonb';
  END IF;

  -- 5. Sequence for piecework_payroll_number_seq
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'piecework_payroll_number_seq') THEN
    EXECUTE 'CREATE SEQUENCE piecework_payroll_number_seq START WITH 1001 INCREMENT BY 1';
  END IF;

  -- 6. Ensure paid_amount column on piecework_payrolls
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='piecework_payrolls' AND column_name='paid_amount') THEN
    EXECUTE 'ALTER TABLE piecework_payrolls ADD COLUMN paid_amount numeric(18, 4) DEFAULT 0';
  END IF;

  -- 7. Ensure is_deleted columns and indices
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_items' AND column_name='is_deleted') THEN
    EXECUTE 'ALTER TABLE document_items ADD COLUMN is_deleted integer DEFAULT 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='journal_voucher_items' AND column_name='is_deleted') THEN
    EXECUTE 'ALTER TABLE journal_voucher_items ADD COLUMN is_deleted integer DEFAULT 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transfers' AND column_name='is_deleted') THEN
    EXECUTE 'ALTER TABLE transfers ADD COLUMN is_deleted integer DEFAULT 0';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_jvi_deleted') THEN
    EXECUTE 'CREATE INDEX idx_jvi_deleted ON journal_voucher_items (is_deleted)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_transfer_deleted') THEN
    EXECUTE 'CREATE INDEX idx_transfer_deleted ON transfers (is_deleted)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_doc_items_deleted') THEN
    EXECUTE 'CREATE INDEX idx_doc_items_deleted ON document_items (is_deleted)';
  END IF;
END $$;
