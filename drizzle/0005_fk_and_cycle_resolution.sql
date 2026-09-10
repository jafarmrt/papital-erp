-- V3.1.29 — Implicit FKs & Circular Dependency Resolution Migration
-- 1. Cleans orphaned references safely (sets to NULL)
-- 2. Eliminates circular FK constraint on crm_leads.proforma_id (single source of truth: documents.crm_lead_id)
-- 3. Adds explicit Foreign Key constraints and indexes for activity_logs, pending_materials, woocommerce_order_logs, idempotency_keys, and documents.crm_lead_id

DO $$
BEGIN
  -- ------------------------------------------------------------
  -- 1) Cleanup & FK: activity_logs.user_id -> users(id)
  -- ------------------------------------------------------------
  UPDATE activity_logs
  SET user_id = NULL
  WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_activity_logs_user_id') THEN
    ALTER TABLE activity_logs
    ADD CONSTRAINT fk_activity_logs_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_act_log_user ON activity_logs (user_id);

  -- ------------------------------------------------------------
  -- 2) Cleanup & FK: pending_materials.project_id -> production_projects(id)
  -- ------------------------------------------------------------
  UPDATE pending_materials
  SET project_id = NULL
  WHERE project_id IS NOT NULL AND project_id NOT IN (SELECT id FROM production_projects);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pending_materials_project_id') THEN
    ALTER TABLE pending_materials
    ADD CONSTRAINT fk_pending_materials_project_id
    FOREIGN KEY (project_id) REFERENCES production_projects(id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_pmat_project ON pending_materials (project_id);

  -- ------------------------------------------------------------
  -- 3) Cleanup & FK: woocommerce_order_logs.erp_document_id -> documents(id)
  -- ------------------------------------------------------------
  UPDATE woocommerce_order_logs
  SET erp_document_id = NULL
  WHERE erp_document_id IS NOT NULL AND erp_document_id NOT IN (SELECT id FROM documents);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_woocommerce_order_logs_erp_document_id') THEN
    ALTER TABLE woocommerce_order_logs
    ADD CONSTRAINT fk_woocommerce_order_logs_erp_document_id
    FOREIGN KEY (erp_document_id) REFERENCES documents(id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_wc_erp_doc ON woocommerce_order_logs (erp_document_id);

  -- ------------------------------------------------------------
  -- 4) Cleanup & FK: idempotency_keys.created_by_id -> users(id)
  -- ------------------------------------------------------------
  UPDATE idempotency_keys
  SET created_by_id = NULL
  WHERE created_by_id IS NOT NULL AND created_by_id NOT IN (SELECT id FROM users);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_idempotency_keys_created_by_id') THEN
    ALTER TABLE idempotency_keys
    ADD CONSTRAINT fk_idempotency_keys_created_by_id
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_idemp_created_by ON idempotency_keys (created_by_id);

  -- ------------------------------------------------------------
  -- 5) Cleanup & FK: documents.crm_lead_id -> crm_leads(id)
  -- ------------------------------------------------------------
  UPDATE documents
  SET crm_lead_id = NULL
  WHERE crm_lead_id IS NOT NULL AND crm_lead_id NOT IN (SELECT id FROM crm_leads);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_crm_lead_id') THEN
    ALTER TABLE documents
    ADD CONSTRAINT fk_documents_crm_lead_id
    FOREIGN KEY (crm_lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL;
  END IF;

  -- ------------------------------------------------------------
  -- 6) Remove circular constraint if present on crm_leads.proforma_id
  -- ------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_leads_proforma_id' OR conname = 'crm_leads_proforma_id_documents_id_fk') THEN
    ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS fk_crm_leads_proforma_id;
    ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_proforma_id_documents_id_fk;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_crm_proforma ON crm_leads (proforma_id);
END $$;
