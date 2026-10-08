-- Drizzle Migration 0094: an index leading with every foreign key column (v9.0.449 / TD-614, finding B01-34)
--
-- 41 foreign key columns had no index that leads with them, so reading the rows of a parent (a document's treasury rows,
-- a payroll's payments, a cheque's or voucher's rows, a lead's documents) and the database's own check when a parent row
-- is deleted scanned the whole table. Each column gets one b-tree index; a nullable column gets a partial index on
-- `<column> IS NOT NULL` (most rows hold no reference). The partial unique indexes of journal_vouchers.source_document_id
-- and source_payroll_id carry `is_deleted = 0` and do not serve a lookup without it, so those columns get their own index.
-- Data is not changed. Regression test reg_foreign_key_indexes_td_614 keeps every new foreign key column indexed.

CREATE INDEX IF NOT EXISTS idx_accounting_settings_account_id ON accounting_settings (account_id) WHERE account_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_bank_accounts_account_id ON bank_accounts (account_id) WHERE account_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_bank_account_id ON cheques (bank_account_id) WHERE bank_account_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_created_by_id ON cheques (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_party_account_id ON cheques (party_account_id) WHERE party_account_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_cheques_voucher_id ON cheques (voucher_id) WHERE voucher_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_activities_assigned_personnel_id ON crm_activities (assigned_personnel_id) WHERE assigned_personnel_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned_personnel_id ON crm_leads (assigned_personnel_id) WHERE assigned_personnel_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_crm_leads_customer_id ON crm_leads (customer_id) WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_daily_work_logs_project_id ON daily_work_logs (project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dead_letter_events_resolved_by ON dead_letter_events (resolved_by) WHERE resolved_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_documents_crm_lead_id ON documents (crm_lead_id) WHERE crm_lead_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_event_action_rules_created_by ON event_action_rules (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_fiscal_periods_closing_voucher_id ON fiscal_periods (closing_voucher_id) WHERE closing_voucher_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_inventory_reconciliation_anomalies_warehouse_id ON inventory_reconciliation_anomalies (warehouse_id) WHERE warehouse_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_journal_vouchers_approved_by_id ON journal_vouchers (approved_by_id) WHERE approved_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_journal_vouchers_created_by_id ON journal_vouchers (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_journal_vouchers_source_document_id ON journal_vouchers (source_document_id) WHERE source_document_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_journal_vouchers_source_payroll_id ON journal_vouchers (source_payroll_id) WHERE source_payroll_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notifications_sender_id ON notifications (sender_id) WHERE sender_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_piecework_logs_created_by_id ON piecework_logs (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_piecework_payrolls_created_by_id ON piecework_payrolls (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_piecework_task_rate_history_changed_by_user_id ON piecework_task_rate_history (changed_by_user_id) WHERE changed_by_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_production_projects_customer_id ON production_projects (customer_id) WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_production_projects_item_id ON production_projects (item_id) WHERE item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_bom_allocations_user_id ON project_bom_allocations (user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_product_stage_progress_item_id ON project_product_stage_progress (item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_reservation_releases_project_id ON project_reservation_releases (project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_assigned_to_id ON purchase_requisitions (assigned_to_id) WHERE assigned_to_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_requested_by_id ON purchase_requisitions (requested_by_id) WHERE requested_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ref_fiscal_year_corrections_document_id ON ref_fiscal_year_corrections (document_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_cheque_id ON treasury_transactions (cheque_id) WHERE cheque_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_contra_account_id ON treasury_transactions (contra_account_id) WHERE contra_account_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_created_by_id ON treasury_transactions (created_by_id) WHERE created_by_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_document_id ON treasury_transactions (document_id) WHERE document_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_payroll_id ON treasury_transactions (payroll_id) WHERE payroll_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_treasury_transactions_voucher_id ON treasury_transactions (voucher_id) WHERE voucher_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_created_by ON webhook_subscriptions (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_instances_workflow_definition_id ON workflow_instances (workflow_definition_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_from_state_id ON workflow_transitions (from_state_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_to_state_id ON workflow_transitions (to_state_id);
