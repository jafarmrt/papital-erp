-- Drizzle Migration 0068: link the vouchers of a fiscal-year closing to the closed year (v9.0.148 / TD-545, finding B03-03,
-- product-owner decision t3 option A)
--
-- The three closing vouchers of a year (temporary accounts, profit transfer, permanent accounts) are dated the year's
-- last day, so every report up to that day showed the closed year as zero. Reports now leave these vouchers out by
-- default ("include closing vouchers" brings them back). A closing voucher is only one that the fiscal-year closing
-- issued: not every voucher of type 'closing' (the manual voucher form saved opening balances as 'closing') and not a
-- reference number (a manual voucher could carry "CLOSING-1400"). The closing run now writes the closed year into
-- source_fiscal_year on its closing and opening vouchers.
--
-- Backfill: for every year that fiscal_periods marks closed, the closing run's own vouchers are linked: type 'closing'
-- with reference CLOSE-TEMP-<y>, CLOSE-PROFIT-<y> or CLOSING-<y> dated inside year y, and type 'opening' with reference
-- OPENING-<y+1> dated inside year y+1, manual module, not deleted; the lowest id per reference (a manual voucher with the
-- same reference can only have been saved after the closing, since the closing refused to run while one existed).
-- The UPDATE runs through erp_update_with_unvalidated_checks (0047): vouchers of closed years may keep an old date that
-- 0044 refused to convert, and a NOT VALID CHECK still applies to every updated row. No foreign key: the column holds a
-- year number. Runs inside the Drizzle migrator transaction.

ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS source_fiscal_year integer;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('journal_vouchers', $sql$
WITH closed AS (
  SELECT fiscal_year AS y FROM fiscal_periods WHERE status = 'closed' AND fiscal_year BETWEEN 1300 AND 1499
), candidates AS (
  SELECT DISTINCT ON (jv.reference_number) jv.id, c.y
  FROM journal_vouchers jv
  JOIN closed c ON (
       (jv.voucher_type = 'closing'
        AND jv.reference_number IN ('CLOSE-TEMP-' || c.y, 'CLOSE-PROFIT-' || c.y, 'CLOSING-' || c.y)
        AND erp_text_date_to_iso(jv.date)::date >= erp_jalali_to_gregorian(c.y, 1, 1)
        AND erp_text_date_to_iso(jv.date)::date < erp_jalali_to_gregorian(c.y + 1, 1, 1))
    OR (jv.voucher_type = 'opening'
        AND jv.reference_number = 'OPENING-' || (c.y + 1)
        AND erp_text_date_to_iso(jv.date)::date >= erp_jalali_to_gregorian(c.y + 1, 1, 1)
        AND erp_text_date_to_iso(jv.date)::date < erp_jalali_to_gregorian(c.y + 2, 1, 1))
  )
  WHERE jv.is_deleted = 0 AND jv.reference_module = 'manual' AND jv.source_fiscal_year IS NULL
    AND erp_text_date_to_iso(jv.date) IS NOT NULL
  ORDER BY jv.reference_number, jv.id
)
UPDATE journal_vouchers jv
SET source_fiscal_year = candidates.y
FROM candidates
WHERE jv.id = candidates.id
$sql$);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jv_source_fiscal_year ON journal_vouchers (source_fiscal_year) WHERE source_fiscal_year IS NOT NULL;
