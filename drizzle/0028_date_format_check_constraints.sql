-- Drizzle Migration 0028: CHECK on the format of text date columns (v7.0.75 / audit P3-15)
--
-- 24 date columns are stored as text and accepted any string. Product-owner decision (2026-10-02): keep the text
-- type and add a CHECK constraint only. erp_date_text_ok(value, kind); NULL and '' always pass:
--   iso — YYYY-MM-DD: the *_iso columns, which the server always computes as ISO
--   any — a well-formed Gregorian (19xx-21xx) or Jalali (13xx-15xx) date, '-' or '/' separated, Latin or Persian/Arabic
--         digits, optional time and zone. These columns hold both calendars today; unifying them is TD-232.
-- journal_vouchers.date, treasury_transactions.date and piecework_payrolls.payment_date are left out until the legacy
-- "07-10-1405 AP" dates (TD-231) are dealt with: a NOT VALID constraint still applies to every UPDATE of such a row
-- and would block finalizing, voiding or reversing those vouchers.
-- Each constraint is added NOT VALID (new and updated rows must hold a valid value) and is validated only when no
-- existing row violates it, so the migration never fails on and never rewrites old data; otherwise RAISE WARNING.

CREATE OR REPLACE FUNCTION erp_date_text_ok(v text, kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT v IS NULL OR v = '' OR CASE kind
    WHEN 'iso' THEN v ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    ELSE translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
      ~ '^((19|20|21)[0-9]{2}|1[345][0-9]{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'
  END
$fn$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_activities_activity_date_iso_datefmt' AND conrelid = 'crm_activities'::regclass) THEN
    ALTER TABLE crm_activities ADD CONSTRAINT chk_crm_activities_activity_date_iso_datefmt CHECK (erp_date_text_ok(activity_date_iso, 'iso')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_activities WHERE NOT erp_date_text_ok(activity_date_iso, 'iso')) THEN
    RAISE WARNING 'crm_activities.activity_date_iso: rows with an invalid date format kept; constraint chk_crm_activities_activity_date_iso_datefmt left NOT VALID';
  ELSE
    ALTER TABLE crm_activities VALIDATE CONSTRAINT chk_crm_activities_activity_date_iso_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_activities_next_followup_date_iso_datefmt' AND conrelid = 'crm_activities'::regclass) THEN
    ALTER TABLE crm_activities ADD CONSTRAINT chk_crm_activities_next_followup_date_iso_datefmt CHECK (erp_date_text_ok(next_followup_date_iso, 'iso')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_activities WHERE NOT erp_date_text_ok(next_followup_date_iso, 'iso')) THEN
    RAISE WARNING 'crm_activities.next_followup_date_iso: rows with an invalid date format kept; constraint chk_crm_activities_next_followup_date_iso_datefmt left NOT VALID';
  ELSE
    ALTER TABLE crm_activities VALIDATE CONSTRAINT chk_crm_activities_next_followup_date_iso_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_daily_work_logs_date_iso_datefmt' AND conrelid = 'daily_work_logs'::regclass) THEN
    ALTER TABLE daily_work_logs ADD CONSTRAINT chk_daily_work_logs_date_iso_datefmt CHECK (erp_date_text_ok(date_iso, 'iso')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM daily_work_logs WHERE NOT erp_date_text_ok(date_iso, 'iso')) THEN
    RAISE WARNING 'daily_work_logs.date_iso: rows with an invalid date format kept; constraint chk_daily_work_logs_date_iso_datefmt left NOT VALID';
  ELSE
    ALTER TABLE daily_work_logs VALIDATE CONSTRAINT chk_daily_work_logs_date_iso_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_logs_date_iso_datefmt' AND conrelid = 'piecework_logs'::regclass) THEN
    ALTER TABLE piecework_logs ADD CONSTRAINT chk_piecework_logs_date_iso_datefmt CHECK (erp_date_text_ok(date_iso, 'iso')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_logs WHERE NOT erp_date_text_ok(date_iso, 'iso')) THEN
    RAISE WARNING 'piecework_logs.date_iso: rows with an invalid date format kept; constraint chk_piecework_logs_date_iso_datefmt left NOT VALID';
  ELSE
    ALTER TABLE piecework_logs VALIDATE CONSTRAINT chk_piecework_logs_date_iso_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_treasury_transactions_reconciled_at_datefmt' AND conrelid = 'treasury_transactions'::regclass) THEN
    ALTER TABLE treasury_transactions ADD CONSTRAINT chk_treasury_transactions_reconciled_at_datefmt CHECK (erp_date_text_ok(reconciled_at, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM treasury_transactions WHERE NOT erp_date_text_ok(reconciled_at, 'any')) THEN
    RAISE WARNING 'treasury_transactions.reconciled_at: rows with an invalid date format kept; constraint chk_treasury_transactions_reconciled_at_datefmt left NOT VALID';
  ELSE
    ALTER TABLE treasury_transactions VALIDATE CONSTRAINT chk_treasury_transactions_reconciled_at_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_project_stages_completed_at_datefmt' AND conrelid = 'project_stages'::regclass) THEN
    ALTER TABLE project_stages ADD CONSTRAINT chk_project_stages_completed_at_datefmt CHECK (erp_date_text_ok(completed_at, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM project_stages WHERE NOT erp_date_text_ok(completed_at, 'any')) THEN
    RAISE WARNING 'project_stages.completed_at: rows with an invalid date format kept; constraint chk_project_stages_completed_at_datefmt left NOT VALID';
  ELSE
    ALTER TABLE project_stages VALIDATE CONSTRAINT chk_project_stages_completed_at_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_last_failed_login_at_datefmt' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_last_failed_login_at_datefmt CHECK (erp_date_text_ok(last_failed_login_at, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE NOT erp_date_text_ok(last_failed_login_at, 'any')) THEN
    RAISE WARNING 'users.last_failed_login_at: rows with an invalid date format kept; constraint chk_users_last_failed_login_at_datefmt left NOT VALID';
  ELSE
    ALTER TABLE users VALIDATE CONSTRAINT chk_users_last_failed_login_at_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_issue_date_datefmt' AND conrelid = 'cheques'::regclass) THEN
    ALTER TABLE cheques ADD CONSTRAINT chk_cheques_issue_date_datefmt CHECK (erp_date_text_ok(issue_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM cheques WHERE NOT erp_date_text_ok(issue_date, 'any')) THEN
    RAISE WARNING 'cheques.issue_date: rows with an invalid date format kept; constraint chk_cheques_issue_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE cheques VALIDATE CONSTRAINT chk_cheques_issue_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cheques_due_date_datefmt' AND conrelid = 'cheques'::regclass) THEN
    ALTER TABLE cheques ADD CONSTRAINT chk_cheques_due_date_datefmt CHECK (erp_date_text_ok(due_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM cheques WHERE NOT erp_date_text_ok(due_date, 'any')) THEN
    RAISE WARNING 'cheques.due_date: rows with an invalid date format kept; constraint chk_cheques_due_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE cheques VALIDATE CONSTRAINT chk_cheques_due_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_leads_expected_close_date_datefmt' AND conrelid = 'crm_leads'::regclass) THEN
    ALTER TABLE crm_leads ADD CONSTRAINT chk_crm_leads_expected_close_date_datefmt CHECK (erp_date_text_ok(expected_close_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_leads WHERE NOT erp_date_text_ok(expected_close_date, 'any')) THEN
    RAISE WARNING 'crm_leads.expected_close_date: rows with an invalid date format kept; constraint chk_crm_leads_expected_close_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE crm_leads VALIDATE CONSTRAINT chk_crm_leads_expected_close_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_activities_activity_date_datefmt' AND conrelid = 'crm_activities'::regclass) THEN
    ALTER TABLE crm_activities ADD CONSTRAINT chk_crm_activities_activity_date_datefmt CHECK (erp_date_text_ok(activity_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_activities WHERE NOT erp_date_text_ok(activity_date, 'any')) THEN
    RAISE WARNING 'crm_activities.activity_date: rows with an invalid date format kept; constraint chk_crm_activities_activity_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE crm_activities VALIDATE CONSTRAINT chk_crm_activities_activity_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_crm_activities_next_followup_date_datefmt' AND conrelid = 'crm_activities'::regclass) THEN
    ALTER TABLE crm_activities ADD CONSTRAINT chk_crm_activities_next_followup_date_datefmt CHECK (erp_date_text_ok(next_followup_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM crm_activities WHERE NOT erp_date_text_ok(next_followup_date, 'any')) THEN
    RAISE WARNING 'crm_activities.next_followup_date: rows with an invalid date format kept; constraint chk_crm_activities_next_followup_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE crm_activities VALIDATE CONSTRAINT chk_crm_activities_next_followup_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_daily_work_logs_date_datefmt' AND conrelid = 'daily_work_logs'::regclass) THEN
    ALTER TABLE daily_work_logs ADD CONSTRAINT chk_daily_work_logs_date_datefmt CHECK (erp_date_text_ok(date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM daily_work_logs WHERE NOT erp_date_text_ok(date, 'any')) THEN
    RAISE WARNING 'daily_work_logs.date: rows with an invalid date format kept; constraint chk_daily_work_logs_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE daily_work_logs VALIDATE CONSTRAINT chk_daily_work_logs_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_birth_date_datefmt' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_birth_date_datefmt CHECK (erp_date_text_ok(birth_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM personnel WHERE NOT erp_date_text_ok(birth_date, 'any')) THEN
    RAISE WARNING 'personnel.birth_date: rows with an invalid date format kept; constraint chk_personnel_birth_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE personnel VALIDATE CONSTRAINT chk_personnel_birth_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_end_date_datefmt' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM personnel WHERE NOT erp_date_text_ok(end_date, 'any')) THEN
    RAISE WARNING 'personnel.end_date: rows with an invalid date format kept; constraint chk_personnel_end_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE personnel VALIDATE CONSTRAINT chk_personnel_end_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_task_rate_history_effective_date_datefmt' AND conrelid = 'piecework_task_rate_history'::regclass) THEN
    ALTER TABLE piecework_task_rate_history ADD CONSTRAINT chk_piecework_task_rate_history_effective_date_datefmt CHECK (erp_date_text_ok(effective_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_task_rate_history WHERE NOT erp_date_text_ok(effective_date, 'any')) THEN
    RAISE WARNING 'piecework_task_rate_history.effective_date: rows with an invalid date format kept; constraint chk_piecework_task_rate_history_effective_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE piecework_task_rate_history VALIDATE CONSTRAINT chk_piecework_task_rate_history_effective_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_payrolls_start_date_datefmt' AND conrelid = 'piecework_payrolls'::regclass) THEN
    ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_payrolls WHERE NOT erp_date_text_ok(start_date, 'any')) THEN
    RAISE WARNING 'piecework_payrolls.start_date: rows with an invalid date format kept; constraint chk_piecework_payrolls_start_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE piecework_payrolls VALIDATE CONSTRAINT chk_piecework_payrolls_start_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_payrolls_end_date_datefmt' AND conrelid = 'piecework_payrolls'::regclass) THEN
    ALTER TABLE piecework_payrolls ADD CONSTRAINT chk_piecework_payrolls_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_payrolls WHERE NOT erp_date_text_ok(end_date, 'any')) THEN
    RAISE WARNING 'piecework_payrolls.end_date: rows with an invalid date format kept; constraint chk_piecework_payrolls_end_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE piecework_payrolls VALIDATE CONSTRAINT chk_piecework_payrolls_end_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_piecework_logs_date_datefmt' AND conrelid = 'piecework_logs'::regclass) THEN
    ALTER TABLE piecework_logs ADD CONSTRAINT chk_piecework_logs_date_datefmt CHECK (erp_date_text_ok(date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM piecework_logs WHERE NOT erp_date_text_ok(date, 'any')) THEN
    RAISE WARNING 'piecework_logs.date: rows with an invalid date format kept; constraint chk_piecework_logs_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE piecework_logs VALIDATE CONSTRAINT chk_piecework_logs_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_purchase_requisitions_required_date_datefmt' AND conrelid = 'purchase_requisitions'::regclass) THEN
    ALTER TABLE purchase_requisitions ADD CONSTRAINT chk_purchase_requisitions_required_date_datefmt CHECK (erp_date_text_ok(required_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_requisitions WHERE NOT erp_date_text_ok(required_date, 'any')) THEN
    RAISE WARNING 'purchase_requisitions.required_date: rows with an invalid date format kept; constraint chk_purchase_requisitions_required_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE purchase_requisitions VALIDATE CONSTRAINT chk_purchase_requisitions_required_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_projects_start_date_datefmt' AND conrelid = 'production_projects'::regclass) THEN
    ALTER TABLE production_projects ADD CONSTRAINT chk_production_projects_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM production_projects WHERE NOT erp_date_text_ok(start_date, 'any')) THEN
    RAISE WARNING 'production_projects.start_date: rows with an invalid date format kept; constraint chk_production_projects_start_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE production_projects VALIDATE CONSTRAINT chk_production_projects_start_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_projects_end_date_datefmt' AND conrelid = 'production_projects'::regclass) THEN
    ALTER TABLE production_projects ADD CONSTRAINT chk_production_projects_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM production_projects WHERE NOT erp_date_text_ok(end_date, 'any')) THEN
    RAISE WARNING 'production_projects.end_date: rows with an invalid date format kept; constraint chk_production_projects_end_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE production_projects VALIDATE CONSTRAINT chk_production_projects_end_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_project_stages_start_date_datefmt' AND conrelid = 'project_stages'::regclass) THEN
    ALTER TABLE project_stages ADD CONSTRAINT chk_project_stages_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM project_stages WHERE NOT erp_date_text_ok(start_date, 'any')) THEN
    RAISE WARNING 'project_stages.start_date: rows with an invalid date format kept; constraint chk_project_stages_start_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE project_stages VALIDATE CONSTRAINT chk_project_stages_start_date_datefmt;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_project_stages_end_date_datefmt' AND conrelid = 'project_stages'::regclass) THEN
    ALTER TABLE project_stages ADD CONSTRAINT chk_project_stages_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'any')) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM project_stages WHERE NOT erp_date_text_ok(end_date, 'any')) THEN
    RAISE WARNING 'project_stages.end_date: rows with an invalid date format kept; constraint chk_project_stages_end_date_datefmt left NOT VALID';
  ELSE
    ALTER TABLE project_stages VALIDATE CONSTRAINT chk_project_stages_end_date_datefmt;
  END IF;
END $$;
