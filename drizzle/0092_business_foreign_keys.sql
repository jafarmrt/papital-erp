-- Drizzle Migration 0092: foreign keys of the business references (v9.0.447 / TD-903, findings B01-31 / B01-32,
-- product-owner decision t6 «الف» of package 1, rule of TD-060)
--
-- Thirty columns that the Drizzle schema declares as references between business tables (treasury rows to their bank
-- account, cheque, document, payslip and voucher; cheques to their bank account and voucher; Kardex rows to their
-- document; work logs, payslips and custom rates to their personnel, task, project and payslip; sales leads and
-- follow-ups to their customer, lead and personnel; projects and material allocations to their customer, item, project
-- and Kardex row; prices to their item; treasury accounts and accounting settings to their ledger account) had no
-- database constraint, so a row could point to a missing parent. Parents of these tables are only soft-deleted; the
-- factory reset removes children before parents.
--
-- Each foreign key is added NO ACTION, as declared, NOT VALID (enforced for new rows at once), and validated only when no
-- existing row breaks it; old rows are never changed or deleted here (rule of TD-060: a key over unclean data is left for
-- a decision, never forced). A constraint left unvalidated is listed by the financial health check
-- (conditional_constraints_missing) with the number of rows that break it and validated by the system admin once the data
-- is fixed. Runs inside the Drizzle migrator transaction.

DO $$
DECLARE
  fk record;
  orphan boolean;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('fk_accounting_settings_account_id', 'accounting_settings', 'account_id', 'accounts'),
      ('fk_bank_accounts_account_id', 'bank_accounts', 'account_id', 'accounts'),
      ('fk_cheques_bank_account_id', 'cheques', 'bank_account_id', 'bank_accounts'),
      ('fk_cheques_voucher_id', 'cheques', 'voucher_id', 'journal_vouchers'),
      ('fk_crm_activities_assigned_personnel_id', 'crm_activities', 'assigned_personnel_id', 'personnel'),
      ('fk_crm_activities_customer_id', 'crm_activities', 'customer_id', 'customers'),
      ('fk_crm_activities_lead_id', 'crm_activities', 'lead_id', 'crm_leads'),
      ('fk_crm_leads_assigned_personnel_id', 'crm_leads', 'assigned_personnel_id', 'personnel'),
      ('fk_crm_leads_customer_id', 'crm_leads', 'customer_id', 'customers'),
      ('fk_daily_work_logs_project_id', 'daily_work_logs', 'project_id', 'production_projects'),
      ('fk_item_prices_item_id', 'item_prices', 'item_id', 'items'),
      ('fk_piecework_logs_payroll_id', 'piecework_logs', 'payroll_id', 'piecework_payrolls'),
      ('fk_piecework_logs_personnel_id', 'piecework_logs', 'personnel_id', 'personnel'),
      ('fk_piecework_logs_project_id', 'piecework_logs', 'project_id', 'production_projects'),
      ('fk_piecework_logs_task_id', 'piecework_logs', 'task_id', 'piecework_tasks'),
      ('fk_piecework_payrolls_personnel_id', 'piecework_payrolls', 'personnel_id', 'personnel'),
      ('fk_piecework_personnel_rates_personnel_id', 'piecework_personnel_rates', 'personnel_id', 'personnel'),
      ('fk_piecework_personnel_rates_task_id', 'piecework_personnel_rates', 'task_id', 'piecework_tasks'),
      ('fk_piecework_task_rate_history_task_id', 'piecework_task_rate_history', 'task_id', 'piecework_tasks'),
      ('fk_production_projects_customer_id', 'production_projects', 'customer_id', 'customers'),
      ('fk_production_projects_item_id', 'production_projects', 'item_id', 'items'),
      ('fk_project_bom_allocations_item_id', 'project_bom_allocations', 'item_id', 'items'),
      ('fk_project_bom_allocations_project_id', 'project_bom_allocations', 'project_id', 'production_projects'),
      ('fk_project_bom_allocations_source_transaction_id', 'project_bom_allocations', 'source_transaction_id', 'transactions'),
      ('fk_transactions_document_id', 'transactions', 'document_id', 'documents'),
      ('fk_treasury_transactions_bank_account_id', 'treasury_transactions', 'bank_account_id', 'bank_accounts'),
      ('fk_treasury_transactions_cheque_id', 'treasury_transactions', 'cheque_id', 'cheques'),
      ('fk_treasury_transactions_document_id', 'treasury_transactions', 'document_id', 'documents'),
      ('fk_treasury_transactions_payroll_id', 'treasury_transactions', 'payroll_id', 'piecework_payrolls'),
      ('fk_treasury_transactions_voucher_id', 'treasury_transactions', 'voucher_id', 'journal_vouchers')
    ) AS t(name, tbl, col, ref)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = fk.name AND connamespace = current_schema()::regnamespace
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (id) NOT VALID',
        fk.tbl, fk.name, fk.col, fk.ref);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I))',
      fk.tbl, fk.col, fk.ref, fk.col) INTO orphan;
    IF orphan THEN
      RAISE NOTICE '% has rows whose % points to a missing % row; % left NOT VALID (see the financial health check)',
        fk.tbl, fk.col, fk.ref, fk.name;
    ELSE
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tbl, fk.name);
    END IF;
  END LOOP;
END $$;
