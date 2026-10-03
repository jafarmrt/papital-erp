-- Drizzle Migration 0039: CRM dates stored as Gregorian ISO (v7.0.132 / TD-232 step 2)
--
-- crm_activities.activity_date / next_followup_date and crm_leads.expected_close_date held Jalali dates from the
-- date picker ("1405/07/10"), Gregorian dates from server-made activities ("2026-10-02") and Persian-digit dates
-- from proformas ("۱۴۰۵/۷/۱۱"). Every value is converted to ISO with erp_unify_text_date_column (migration 0038):
-- the old value of each changed row is recorded first in legacy_date_repairs (repair_kind 'calendar'); a value that
-- is not a recognisable date is left as it is and recorded as refused (shown by the financial health check).
-- The *_iso companion columns then take the main column's value (differences recorded the same way), and the
-- three main columns get the 'iso' date-format CHECK (validated only when no row violates it).

SELECT erp_unify_text_date_column('crm_activities', 'activity_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('crm_activities', 'next_followup_date');
--> statement-breakpoint
SELECT erp_unify_text_date_column('crm_leads', 'expected_close_date');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_sync_crm_iso_companions() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  n integer;
  total integer := 0;
BEGIN
  -- record a non-empty companion value that differs from the (ISO or empty) main value, then copy the main value
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
  SELECT 'crm_activities', a.id, 'activity_date_iso', a.activity_date_iso, COALESCE(a.activity_date, ''), 'corrected',
         'هم‌سان با activity_date', 'calendar'
    FROM crm_activities a
   WHERE COALESCE(a.activity_date_iso, '') <> '' AND a.activity_date_iso IS DISTINCT FROM COALESCE(a.activity_date, '')
     AND erp_date_text_ok(a.activity_date, 'iso')
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'crm_activities' AND r.row_id = a.id
                       AND r.column_name = 'activity_date_iso' AND r.repair_kind = 'calendar' AND r.old_value = a.activity_date_iso);
  UPDATE crm_activities SET activity_date_iso = COALESCE(activity_date, '')
   WHERE activity_date_iso IS DISTINCT FROM COALESCE(activity_date, '') AND erp_date_text_ok(activity_date, 'iso');
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
  SELECT 'crm_activities', a.id, 'next_followup_date_iso', a.next_followup_date_iso, COALESCE(a.next_followup_date, ''), 'corrected',
         'هم‌سان با next_followup_date', 'calendar'
    FROM crm_activities a
   WHERE COALESCE(a.next_followup_date_iso, '') <> '' AND a.next_followup_date_iso IS DISTINCT FROM COALESCE(a.next_followup_date, '')
     AND erp_date_text_ok(a.next_followup_date, 'iso')
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'crm_activities' AND r.row_id = a.id
                       AND r.column_name = 'next_followup_date_iso' AND r.repair_kind = 'calendar' AND r.old_value = a.next_followup_date_iso);
  UPDATE crm_activities SET next_followup_date_iso = COALESCE(next_followup_date, '')
   WHERE next_followup_date_iso IS DISTINCT FROM COALESCE(next_followup_date, '') AND erp_date_text_ok(next_followup_date, 'iso');
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;
  RETURN total;
END
$fn$;
--> statement-breakpoint
SELECT erp_sync_crm_iso_companions();
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('crm_activities', 'activity_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('crm_activities', 'next_followup_date');
--> statement-breakpoint
SELECT erp_set_iso_date_constraint('crm_leads', 'expected_close_date');
