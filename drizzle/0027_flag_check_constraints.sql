-- Drizzle Migration 0027: CHECK (0/1) on integer flag columns (v7.0.73 / audit P3-14)
--
-- 44 integer is_* / has_* flag columns accepted any integer. Product-owner decision (2026-10-02): keep the
-- integer type and add a CHECK constraint only. Each constraint is added NOT VALID (new and updated rows must hold
-- 0, 1 or NULL) and is validated only when no existing row violates it, so the migration never fails on and never
-- rewrites old data; tables left unvalidated are reported with RAISE WARNING.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accounts_is_active_flag' AND conrelid = 'accounts'::regclass) THEN
    ALTER TABLE accounts ADD CONSTRAINT chk_accounts_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM accounts WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'accounts.is_active: rows outside 0/1 kept; constraint chk_accounts_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE accounts VALIDATE CONSTRAINT chk_accounts_is_active_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accounts_is_deleted_flag' AND conrelid = 'accounts'::regclass) THEN
    ALTER TABLE accounts ADD CONSTRAINT chk_accounts_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM accounts WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'accounts.is_deleted: rows outside 0/1 kept; constraint chk_accounts_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE accounts VALIDATE CONSTRAINT chk_accounts_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_accounts_is_system_flag' AND conrelid = 'accounts'::regclass) THEN
    ALTER TABLE accounts ADD CONSTRAINT chk_accounts_is_system_flag CHECK (is_system IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM accounts WHERE is_system NOT IN (0, 1)) THEN
    RAISE WARNING 'accounts.is_system: rows outside 0/1 kept; constraint chk_accounts_is_system_flag left NOT VALID';
  ELSE
    ALTER TABLE accounts VALIDATE CONSTRAINT chk_accounts_is_system_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_accounts_is_active_flag' AND conrelid = 'bank_accounts'::regclass) THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT chk_bank_accounts_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM bank_accounts WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'bank_accounts.is_active: rows outside 0/1 kept; constraint chk_bank_accounts_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE bank_accounts VALIDATE CONSTRAINT chk_bank_accounts_is_active_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bank_accounts_is_deleted_flag' AND conrelid = 'bank_accounts'::regclass) THEN
    ALTER TABLE bank_accounts ADD CONSTRAINT chk_bank_accounts_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM bank_accounts WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'bank_accounts.is_deleted: rows outside 0/1 kept; constraint chk_bank_accounts_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE bank_accounts VALIDATE CONSTRAINT chk_bank_accounts_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_is_deleted_flag' AND conrelid = 'cheques'::regclass) THEN
    ALTER TABLE cheques ADD CONSTRAINT chk_cheques_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM cheques WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'cheques.is_deleted: rows outside 0/1 kept; constraint chk_cheques_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE cheques VALIDATE CONSTRAINT chk_cheques_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_activities_is_deleted_flag' AND conrelid = 'crm_activities'::regclass) THEN
    ALTER TABLE crm_activities ADD CONSTRAINT chk_crm_activities_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_activities WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'crm_activities.is_deleted: rows outside 0/1 kept; constraint chk_crm_activities_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE crm_activities VALIDATE CONSTRAINT chk_crm_activities_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_activities_is_followup_completed_flag' AND conrelid = 'crm_activities'::regclass) THEN
    ALTER TABLE crm_activities ADD CONSTRAINT chk_crm_activities_is_followup_completed_flag CHECK (is_followup_completed IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_activities WHERE is_followup_completed NOT IN (0, 1)) THEN
    RAISE WARNING 'crm_activities.is_followup_completed: rows outside 0/1 kept; constraint chk_crm_activities_is_followup_completed_flag left NOT VALID';
  ELSE
    ALTER TABLE crm_activities VALIDATE CONSTRAINT chk_crm_activities_is_followup_completed_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_leads_has_proforma_flag' AND conrelid = 'crm_leads'::regclass) THEN
    ALTER TABLE crm_leads ADD CONSTRAINT chk_crm_leads_has_proforma_flag CHECK (has_proforma IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_leads WHERE has_proforma NOT IN (0, 1)) THEN
    RAISE WARNING 'crm_leads.has_proforma: rows outside 0/1 kept; constraint chk_crm_leads_has_proforma_flag left NOT VALID';
  ELSE
    ALTER TABLE crm_leads VALIDATE CONSTRAINT chk_crm_leads_has_proforma_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_leads_is_deleted_flag' AND conrelid = 'crm_leads'::regclass) THEN
    ALTER TABLE crm_leads ADD CONSTRAINT chk_crm_leads_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_leads WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'crm_leads.is_deleted: rows outside 0/1 kept; constraint chk_crm_leads_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE crm_leads VALIDATE CONSTRAINT chk_crm_leads_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_is_deleted_flag' AND conrelid = 'customers'::regclass) THEN
    ALTER TABLE customers ADD CONSTRAINT chk_customers_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'customers.is_deleted: rows outside 0/1 kept; constraint chk_customers_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE customers VALIDATE CONSTRAINT chk_customers_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_daily_work_logs_is_deleted_flag' AND conrelid = 'daily_work_logs'::regclass) THEN
    ALTER TABLE daily_work_logs ADD CONSTRAINT chk_daily_work_logs_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM daily_work_logs WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'daily_work_logs.is_deleted: rows outside 0/1 kept; constraint chk_daily_work_logs_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE daily_work_logs VALIDATE CONSTRAINT chk_daily_work_logs_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_document_items_is_deleted_flag' AND conrelid = 'document_items'::regclass) THEN
    ALTER TABLE document_items ADD CONSTRAINT chk_document_items_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM document_items WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'document_items.is_deleted: rows outside 0/1 kept; constraint chk_document_items_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE document_items VALIDATE CONSTRAINT chk_document_items_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_documents_is_deleted_flag' AND conrelid = 'documents'::regclass) THEN
    ALTER TABLE documents ADD CONSTRAINT chk_documents_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'documents.is_deleted: rows outside 0/1 kept; constraint chk_documents_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE documents VALIDATE CONSTRAINT chk_documents_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_event_action_rules_is_active_flag' AND conrelid = 'event_action_rules'::regclass) THEN
    ALTER TABLE event_action_rules ADD CONSTRAINT chk_event_action_rules_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM event_action_rules WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'event_action_rules.is_active: rows outside 0/1 kept; constraint chk_event_action_rules_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE event_action_rules VALIDATE CONSTRAINT chk_event_action_rules_is_active_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_file_attachments_is_deleted_flag' AND conrelid = 'file_attachments'::regclass) THEN
    ALTER TABLE file_attachments ADD CONSTRAINT chk_file_attachments_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM file_attachments WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'file_attachments.is_deleted: rows outside 0/1 kept; constraint chk_file_attachments_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE file_attachments VALIDATE CONSTRAINT chk_file_attachments_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_form_drafts_is_deleted_flag' AND conrelid = 'form_drafts'::regclass) THEN
    ALTER TABLE form_drafts ADD CONSTRAINT chk_form_drafts_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM form_drafts WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'form_drafts.is_deleted: rows outside 0/1 kept; constraint chk_form_drafts_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE form_drafts VALIDATE CONSTRAINT chk_form_drafts_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_item_prices_is_deleted_flag' AND conrelid = 'item_prices'::regclass) THEN
    ALTER TABLE item_prices ADD CONSTRAINT chk_item_prices_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM item_prices WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'item_prices.is_deleted: rows outside 0/1 kept; constraint chk_item_prices_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE item_prices VALIDATE CONSTRAINT chk_item_prices_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_items_is_deleted_flag' AND conrelid = 'items'::regclass) THEN
    ALTER TABLE items ADD CONSTRAINT chk_items_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM items WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'items.is_deleted: rows outside 0/1 kept; constraint chk_items_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE items VALIDATE CONSTRAINT chk_items_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_voucher_items_is_deleted_flag' AND conrelid = 'journal_voucher_items'::regclass) THEN
    ALTER TABLE journal_voucher_items ADD CONSTRAINT chk_journal_voucher_items_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM journal_voucher_items WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'journal_voucher_items.is_deleted: rows outside 0/1 kept; constraint chk_journal_voucher_items_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE journal_voucher_items VALIDATE CONSTRAINT chk_journal_voucher_items_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_vouchers_is_deleted_flag' AND conrelid = 'journal_vouchers'::regclass) THEN
    ALTER TABLE journal_vouchers ADD CONSTRAINT chk_journal_vouchers_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM journal_vouchers WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'journal_vouchers.is_deleted: rows outside 0/1 kept; constraint chk_journal_vouchers_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE journal_vouchers VALIDATE CONSTRAINT chk_journal_vouchers_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_notifications_is_read_flag' AND conrelid = 'notifications'::regclass) THEN
    ALTER TABLE notifications ADD CONSTRAINT chk_notifications_is_read_flag CHECK (is_read IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE is_read NOT IN (0, 1)) THEN
    RAISE WARNING 'notifications.is_read: rows outside 0/1 kept; constraint chk_notifications_is_read_flag left NOT VALID';
  ELSE
    ALTER TABLE notifications VALIDATE CONSTRAINT chk_notifications_is_read_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pending_materials_is_deleted_flag' AND conrelid = 'pending_materials'::regclass) THEN
    ALTER TABLE pending_materials ADD CONSTRAINT chk_pending_materials_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pending_materials WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'pending_materials.is_deleted: rows outside 0/1 kept; constraint chk_pending_materials_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE pending_materials VALIDATE CONSTRAINT chk_pending_materials_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_is_deleted_flag' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM personnel WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'personnel.is_deleted: rows outside 0/1 kept; constraint chk_personnel_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE personnel VALIDATE CONSTRAINT chk_personnel_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_logs_is_deleted_flag' AND conrelid = 'piecework_logs'::regclass) THEN
    ALTER TABLE piecework_logs ADD CONSTRAINT chk_piecework_logs_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_logs WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'piecework_logs.is_deleted: rows outside 0/1 kept; constraint chk_piecework_logs_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE piecework_logs VALIDATE CONSTRAINT chk_piecework_logs_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_payrolls_is_deleted_flag' AND conrelid = 'piecework_payrolls'::regclass) THEN
    ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_payrolls WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'piecework_payrolls.is_deleted: rows outside 0/1 kept; constraint chk_piecework_payrolls_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE piecework_payrolls VALIDATE CONSTRAINT chk_piecework_payrolls_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_personnel_rates_is_deleted_flag' AND conrelid = 'piecework_personnel_rates'::regclass) THEN
    ALTER TABLE piecework_personnel_rates ADD CONSTRAINT chk_piecework_personnel_rates_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_personnel_rates WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'piecework_personnel_rates.is_deleted: rows outside 0/1 kept; constraint chk_piecework_personnel_rates_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE piecework_personnel_rates VALIDATE CONSTRAINT chk_piecework_personnel_rates_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_tasks_is_active_flag' AND conrelid = 'piecework_tasks'::regclass) THEN
    ALTER TABLE piecework_tasks ADD CONSTRAINT chk_piecework_tasks_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_tasks WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'piecework_tasks.is_active: rows outside 0/1 kept; constraint chk_piecework_tasks_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE piecework_tasks VALIDATE CONSTRAINT chk_piecework_tasks_is_active_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_tasks_is_deleted_flag' AND conrelid = 'piecework_tasks'::regclass) THEN
    ALTER TABLE piecework_tasks ADD CONSTRAINT chk_piecework_tasks_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_tasks WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'piecework_tasks.is_deleted: rows outside 0/1 kept; constraint chk_piecework_tasks_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE piecework_tasks VALIDATE CONSTRAINT chk_piecework_tasks_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_projects_is_deleted_flag' AND conrelid = 'production_projects'::regclass) THEN
    ALTER TABLE production_projects ADD CONSTRAINT chk_production_projects_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM production_projects WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'production_projects.is_deleted: rows outside 0/1 kept; constraint chk_production_projects_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE production_projects VALIDATE CONSTRAINT chk_production_projects_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_project_bom_allocations_is_deleted_flag' AND conrelid = 'project_bom_allocations'::regclass) THEN
    ALTER TABLE project_bom_allocations ADD CONSTRAINT chk_project_bom_allocations_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM project_bom_allocations WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'project_bom_allocations.is_deleted: rows outside 0/1 kept; constraint chk_project_bom_allocations_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE project_bom_allocations VALIDATE CONSTRAINT chk_project_bom_allocations_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_project_product_stage_progress_is_deleted_flag' AND conrelid = 'project_product_stage_progress'::regclass) THEN
    ALTER TABLE project_product_stage_progress ADD CONSTRAINT chk_project_product_stage_progress_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM project_product_stage_progress WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'project_product_stage_progress.is_deleted: rows outside 0/1 kept; constraint chk_project_product_stage_progress_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE project_product_stage_progress VALIDATE CONSTRAINT chk_project_product_stage_progress_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_project_stages_is_deleted_flag' AND conrelid = 'project_stages'::regclass) THEN
    ALTER TABLE project_stages ADD CONSTRAINT chk_project_stages_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM project_stages WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'project_stages.is_deleted: rows outside 0/1 kept; constraint chk_project_stages_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE project_stages VALIDATE CONSTRAINT chk_project_stages_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_requisitions_is_deleted_flag' AND conrelid = 'purchase_requisitions'::regclass) THEN
    ALTER TABLE purchase_requisitions ADD CONSTRAINT chk_purchase_requisitions_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_requisitions WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'purchase_requisitions.is_deleted: rows outside 0/1 kept; constraint chk_purchase_requisitions_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE purchase_requisitions VALIDATE CONSTRAINT chk_purchase_requisitions_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_is_system_flag' AND conrelid = 'roles'::regclass) THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_is_system_flag CHECK (is_system IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM roles WHERE is_system NOT IN (0, 1)) THEN
    RAISE WARNING 'roles.is_system: rows outside 0/1 kept; constraint chk_roles_is_system_flag left NOT VALID';
  ELSE
    ALTER TABLE roles VALIDATE CONSTRAINT chk_roles_is_system_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_categories_is_deleted_flag' AND conrelid = 'task_categories'::regclass) THEN
    ALTER TABLE task_categories ADD CONSTRAINT chk_task_categories_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM task_categories WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'task_categories.is_deleted: rows outside 0/1 kept; constraint chk_task_categories_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE task_categories VALIDATE CONSTRAINT chk_task_categories_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transactions_is_deleted_flag' AND conrelid = 'transactions'::regclass) THEN
    ALTER TABLE transactions ADD CONSTRAINT chk_transactions_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM transactions WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'transactions.is_deleted: rows outside 0/1 kept; constraint chk_transactions_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE transactions VALIDATE CONSTRAINT chk_transactions_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transfers_is_deleted_flag' AND conrelid = 'transfers'::regclass) THEN
    ALTER TABLE transfers ADD CONSTRAINT chk_transfers_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM transfers WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'transfers.is_deleted: rows outside 0/1 kept; constraint chk_transfers_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE transfers VALIDATE CONSTRAINT chk_transfers_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_treasury_transactions_is_deleted_flag' AND conrelid = 'treasury_transactions'::regclass) THEN
    ALTER TABLE treasury_transactions ADD CONSTRAINT chk_treasury_transactions_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM treasury_transactions WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'treasury_transactions.is_deleted: rows outside 0/1 kept; constraint chk_treasury_transactions_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE treasury_transactions VALIDATE CONSTRAINT chk_treasury_transactions_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_is_deleted_flag' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_is_deleted_flag CHECK (is_deleted IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE is_deleted NOT IN (0, 1)) THEN
    RAISE WARNING 'users.is_deleted: rows outside 0/1 kept; constraint chk_users_is_deleted_flag left NOT VALID';
  ELSE
    ALTER TABLE users VALIDATE CONSTRAINT chk_users_is_deleted_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_warehouses_is_active_flag' AND conrelid = 'warehouses'::regclass) THEN
    ALTER TABLE warehouses ADD CONSTRAINT chk_warehouses_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM warehouses WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'warehouses.is_active: rows outside 0/1 kept; constraint chk_warehouses_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE warehouses VALIDATE CONSTRAINT chk_warehouses_is_active_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_webhook_subscriptions_is_active_flag' AND conrelid = 'webhook_subscriptions'::regclass) THEN
    ALTER TABLE webhook_subscriptions ADD CONSTRAINT chk_webhook_subscriptions_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM webhook_subscriptions WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'webhook_subscriptions.is_active: rows outside 0/1 kept; constraint chk_webhook_subscriptions_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE webhook_subscriptions VALIDATE CONSTRAINT chk_webhook_subscriptions_is_active_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_definitions_is_active_flag' AND conrelid = 'workflow_definitions'::regclass) THEN
    ALTER TABLE workflow_definitions ADD CONSTRAINT chk_workflow_definitions_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM workflow_definitions WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'workflow_definitions.is_active: rows outside 0/1 kept; constraint chk_workflow_definitions_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE workflow_definitions VALIDATE CONSTRAINT chk_workflow_definitions_is_active_flag;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_delegations_is_active_flag' AND conrelid = 'workflow_delegations'::regclass) THEN
    ALTER TABLE workflow_delegations ADD CONSTRAINT chk_workflow_delegations_is_active_flag CHECK (is_active IN (0, 1)) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM workflow_delegations WHERE is_active NOT IN (0, 1)) THEN
    RAISE WARNING 'workflow_delegations.is_active: rows outside 0/1 kept; constraint chk_workflow_delegations_is_active_flag left NOT VALID';
  ELSE
    ALTER TABLE workflow_delegations VALIDATE CONSTRAINT chk_workflow_delegations_is_active_flag;
  END IF;
END $$;
