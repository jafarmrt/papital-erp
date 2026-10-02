-- Drizzle Migration 0024: exact Nowruz in the document numbering fiscal year (v7.0.62 / TD-179)
--
-- Until v7.0.61 the Gregorian branch of resolveJalaliFiscalYear() and the SQL mirror erp_ref_fiscal_year()
-- (migration 0015) assumed Nowruz is always 21 March. In years whose Nowruz falls on 20 March (e.g. 1403 =
-- 2024-03-20, 1407 = 2028-03-20) a document dated that day was numbered in the previous fiscal year, and the
-- fiscal-period check of a voucher on that day looked at the previous year.
--
-- From v7.0.62 both sides use the calendar the application already uses everywhere else (jalaliToGregorian,
-- identical to the browser's fa-IR calendar for 1300..1500): erp_nowruz_march_day() holds the March day of
-- Nowruz for Gregorian years 1921..2121, generated from jalaliToGregorian(jy, 1, 1).
--
-- Existing rows (product-owner decision): only rows whose ref_fiscal_year is exactly the old 21-March
-- approximation of their date AND differs from the exact year are moved to the exact year; reference numbers
-- are never changed. A move that would collide with another active document of the same type, year and
-- reference number is refused. Every move and refusal is recorded in ref_fiscal_year_corrections and shown by
-- the financial health check.

CREATE OR REPLACE FUNCTION erp_nowruz_march_day(gy integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN gy BETWEEN 1921 AND 2121 THEN 20 + substr(
      '122112211121112111211121112111211121112111111111111111111111111111111111111011101110111011101110111011101110011001100110011001100110011001100010001000100010001000100010001000000001111111111111111111111',
      gy - 1920, 1)::integer
    ELSE 21
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_ref_fiscal_year(ts timestamp without time zone)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN ts IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM ts)::integer - 621
         - CASE WHEN EXTRACT(MONTH FROM ts) < 3
                  OR (EXTRACT(MONTH FROM ts) = 3
                      AND EXTRACT(DAY FROM ts) < erp_nowruz_march_day(EXTRACT(YEAR FROM ts)::integer))
                THEN 1 ELSE 0 END
  END
$$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ref_fiscal_year_corrections (
  id serial PRIMARY KEY,
  document_id integer NOT NULL REFERENCES documents(id),
  doc_type text NOT NULL,
  ref_number text NOT NULL,
  document_date timestamp without time zone NOT NULL,
  old_fiscal_year integer NOT NULL,
  new_fiscal_year integer NOT NULL,
  status text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT chk_ref_fy_corrections_status CHECK (status IN ('corrected', 'conflict'))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_correct_ref_fiscal_year_boundaries()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  moved integer;
BEGIN
  -- 1) Boundary rows still carrying the old 21-March approximation (documents already reported are skipped)
  INSERT INTO ref_fiscal_year_corrections
    (document_id, doc_type, ref_number, document_date, old_fiscal_year, new_fiscal_year, status)
  SELECT d.id, d.type, d.ref_number, d.date, d.ref_fiscal_year, erp_ref_fiscal_year(d.date),
         CASE WHEN d.is_deleted = 0 AND length(d.ref_number) > 0 AND EXISTS (
                SELECT 1 FROM documents o
                 WHERE o.id <> d.id AND o.type = d.type AND o.is_deleted = 0
                   AND o.ref_fiscal_year = erp_ref_fiscal_year(d.date) AND o.ref_number = d.ref_number)
              THEN 'conflict' ELSE 'corrected' END
    FROM documents d
   WHERE d.ref_fiscal_year = EXTRACT(YEAR FROM d.date)::integer - 621
           - CASE WHEN EXTRACT(MONTH FROM d.date) < 3
                    OR (EXTRACT(MONTH FROM d.date) = 3 AND EXTRACT(DAY FROM d.date) < 21)
                  THEN 1 ELSE 0 END
     AND d.ref_fiscal_year <> erp_ref_fiscal_year(d.date)
     AND NOT EXISTS (SELECT 1 FROM ref_fiscal_year_corrections c WHERE c.document_id = d.id);

  -- 2) Move the non-conflicting rows; reference numbers stay as they are
  UPDATE documents d
     SET ref_fiscal_year = c.new_fiscal_year
    FROM ref_fiscal_year_corrections c
   WHERE c.document_id = d.id AND c.status = 'corrected' AND d.ref_fiscal_year = c.old_fiscal_year;
  GET DIAGNOSTICS moved = ROW_COUNT;

  -- 3) Keep an existing counter of the target year above the moved serials so automatic numbering never
  --    hands out a number that a moved document already uses (numeric suffix only, as in v7.0.60)
  UPDATE document_ref_counters k
     SET last_ref_number = s.max_serial
    FROM (
      SELECT c.doc_type, c.new_fiscal_year, MAX(CASE WHEN length(x.serial) <= 10 THEN x.serial::bigint END) AS max_serial
        FROM ref_fiscal_year_corrections c
        CROSS JOIN LATERAL (SELECT substring(c.ref_number FROM '([0-9]+)$') AS serial) x
       WHERE c.status = 'corrected' AND x.serial IS NOT NULL
       GROUP BY c.doc_type, c.new_fiscal_year
    ) s
   WHERE k.doc_type = s.doc_type AND k.fiscal_year = s.new_fiscal_year
     AND s.max_serial <= 2147483647 AND k.last_ref_number < s.max_serial;

  RETURN moved;
END;
$$;
--> statement-breakpoint
SELECT erp_correct_ref_fiscal_year_boundaries();
