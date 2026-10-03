-- Drizzle Migration 0044: journal voucher dates stored as Gregorian ISO (v7.0.137 / TD-248)
--
-- Product-owner decision (1405-07-11, after the date report showed all existing voucher dates in Jalali): convert the
-- storage format of journal_vouchers.date to Gregorian ISO like every other date column. VoucherService already writes
-- ISO; older vouchers (and the TD-231 repairs) hold Jalali "1405-07-10", so date-filtered reports misplaced them.
-- Only the format changes: the day, fiscal year, number and amounts stay the same. Every changed row is recorded first
-- in legacy_date_repairs (repair_kind 'calendar'); a voucher in a closed fiscal year (fiscal_periods) or with an
-- unrecognisable date is left as it is and recorded as refused (shown by the financial health check). Then the column
-- gets the 'iso' date-format CHECK (validated only when no row violates it).

CREATE OR REPLACE FUNCTION erp_unify_journal_voucher_dates() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  n integer;
BEGIN
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
  SELECT 'journal_vouchers', v.id, 'date', v.date, COALESCE(x.iso, v.date),
         CASE WHEN x.iso IS NULL OR fp.status = 'closed' THEN 'refused' ELSE 'corrected' END,
         CASE WHEN x.iso IS NULL THEN 'تاریخ قابل تشخیص نیست؛ مقدار قبلی دست نخورد'
              WHEN fp.status = 'closed' THEN 'سال مالی ' || fp.fiscal_year || ' بسته است' END,
         'calendar'
    FROM journal_vouchers v
    CROSS JOIN LATERAL (SELECT erp_text_date_to_iso(v.date) AS iso) x
    LEFT JOIN fiscal_periods fp ON x.iso IS NOT NULL AND fp.fiscal_year = erp_ref_fiscal_year(x.iso::timestamp)
   WHERE btrim(COALESCE(v.date, '')) <> ''
     AND v.date IS DISTINCT FROM x.iso
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r
                      WHERE r.table_name = 'journal_vouchers' AND r.column_name = 'date' AND r.row_id = v.id
                        AND r.repair_kind = 'calendar' AND r.old_value = v.date);
  UPDATE journal_vouchers v SET date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'journal_vouchers' AND r.column_name = 'date' AND r.row_id = v.id
     AND r.repair_kind = 'calendar' AND r.status = 'corrected' AND v.date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;
--> statement-breakpoint
SELECT erp_unify_journal_voucher_dates();
--> statement-breakpoint
SELECT erp_set_date_constraint('journal_vouchers', 'date', 'iso');
