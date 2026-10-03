-- Drizzle Migration 0042: project, stage, requisition and personnel dates stored as Gregorian ISO (v7.0.135 / TD-232 step 5)
--
-- production_projects / project_stages start_date and end_date, purchase_requisitions.required_date and
-- personnel.birth_date / end_date held the Jalali picker or typed value. Each column is converted with
-- erp_unify_text_date_column (migration 0038; old values in legacy_date_repairs, unrecognisable values refused and
-- kept) and gets the 'iso' date-format CHECK (validated only when no row violates it). project_stages.completed_at
-- is a server timestamp (Gregorian date and time) and keeps the 'any' format CHECK.

SELECT erp_unify_text_date_column('production_projects', 'start_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('production_projects', 'end_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('project_stages', 'start_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('project_stages', 'end_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('purchase_requisitions', 'required_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('personnel', 'birth_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('personnel', 'end_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('production_projects', 'start_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('production_projects', 'end_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('project_stages', 'start_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('project_stages', 'end_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('purchase_requisitions', 'required_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('personnel', 'birth_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('personnel', 'end_date');
