-- Drizzle Migration 0040: cheque dates stored as Gregorian ISO (v7.0.133 / TD-232 step 3)
--
-- cheques.issue_date and due_date held the Jalali picker value ("1405/07/10", "1405-07-10"), so the due-date range
-- filter, the due-date order and the overdue-cheque health check compared text of two calendars. Both columns are
-- converted with erp_unify_text_date_column (migration 0038; old values in legacy_date_repairs, unrecognisable
-- values refused and kept) and get the 'iso' date-format CHECK (validated only when no row violates it).

SELECT erp_unify_text_date_column('cheques', 'issue_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('cheques', 'due_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('cheques', 'issue_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('cheques', 'due_date');
