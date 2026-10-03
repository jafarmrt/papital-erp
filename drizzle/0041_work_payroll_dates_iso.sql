-- Drizzle Migration 0041: work-log, piecework and payroll dates stored as Gregorian ISO (v7.0.134 / TD-232 step 4)
--
-- daily_work_logs.date, piecework_logs.date, piecework_payrolls.start_date / end_date / payment_date and
-- piecework_task_rate_history.effective_date held Jalali picker values, Persian-digit dates ("۱۴۰۵/۰۷/۱۱") and, for
-- payment_date, the Jalali dash form of migration 0030. Payroll periods, the "same month" fixed-salary check and the
-- monthly work report compared that text. Each column is converted with erp_unify_text_date_column (migration
-- 0038; old values in legacy_date_repairs, unrecognisable values refused and kept); the date_iso companions then take
-- the main column's value (differences recorded the same way) and every main column gets the 'iso' format CHECK
-- (validated only when no row violates it).

CREATE OR REPLACE FUNCTION erp_sync_iso_companion(p_table text, p_main text, p_companion text) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  n integer;
BEGIN
  EXECUTE format($q$
    INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
    SELECT %1$L, t.id, %3$L, t.%3$I, COALESCE(t.%2$I, ''), 'corrected', %4$L, 'calendar'
      FROM %1$I t
     WHERE COALESCE(t.%3$I, '') <> '' AND t.%3$I IS DISTINCT FROM COALESCE(t.%2$I, '')
       AND erp_date_text_ok(t.%2$I, 'iso')
       AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = %1$L AND r.row_id = t.id
                         AND r.column_name = %3$L AND r.repair_kind = 'calendar' AND r.old_value = t.%3$I)
  $q$, p_table, p_main, p_companion, 'هم‌سان با ' || p_main);
  EXECUTE format($q$
    UPDATE %1$I SET %3$I = COALESCE(%2$I, '')
     WHERE %3$I IS DISTINCT FROM COALESCE(%2$I, '') AND erp_date_text_ok(%2$I, 'iso')
  $q$, p_table, p_main, p_companion);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;
--> statement-breakpoint
SELECT erp_unify_text_date_column('daily_work_logs', 'date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('piecework_logs', 'date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('piecework_payrolls', 'start_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('piecework_payrolls', 'end_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('piecework_payrolls', 'payment_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('piecework_task_rate_history', 'effective_date');
--> statement-breakpoint
SELECT erp_sync_iso_companion('daily_work_logs', 'date', 'date_iso');
--> statement-breakpoint
SELECT erp_sync_iso_companion('piecework_logs', 'date', 'date_iso');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('daily_work_logs', 'date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('piecework_logs', 'date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('piecework_payrolls', 'start_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('piecework_payrolls', 'end_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('piecework_payrolls', 'payment_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('piecework_task_rate_history', 'effective_date');
