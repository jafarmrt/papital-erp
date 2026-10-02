-- Drizzle Migration 0022: fiscal_periods (v7.0.49 / audit P2-5)
--
-- Until v7.0.48 a fiscal year counted as closed when ANY non-deleted voucher of type 'closing' had a reference
-- number LIKE '%CLOSING-<year>%' or '%CLOSE-%<year>%', and nothing serialized closing a year against vouchers
-- being posted into it at the same moment. From v7.0.49 the state lives in fiscal_periods; posting a voucher
-- takes a FOR SHARE lock on its year's row and closing a year takes FOR UPDATE.
--
-- Backfill (product-owner decision: years that already have a closing voucher are closed): for every 4-digit
-- number found in the reference of a non-deleted 'closing' voucher, the year is marked closed when the old
-- LIKE rule would have matched — the set of closed years is exactly what the application enforced before.

CREATE TABLE IF NOT EXISTS fiscal_periods (
  fiscal_year integer PRIMARY KEY,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamp without time zone,
  closed_by text,
  closing_voucher_id integer REFERENCES journal_vouchers(id),
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT chk_fiscal_periods_status CHECK (status IN ('open', 'closed'))
);
--> statement-breakpoint
WITH candidates AS (
  SELECT DISTINCT (m.y[1])::integer AS fiscal_year
  FROM journal_vouchers jv
  CROSS JOIN LATERAL regexp_matches(COALESCE(jv.reference_number, ''), '([0-9]{4})', 'g') AS m(y)
  WHERE jv.is_deleted = 0 AND jv.voucher_type = 'closing'
), closed_years AS (
  SELECT c.fiscal_year,
         (SELECT jv.id
            FROM journal_vouchers jv
           WHERE jv.is_deleted = 0 AND jv.voucher_type = 'closing'
             AND (jv.reference_number LIKE '%CLOSING-' || c.fiscal_year || '%'
                  OR jv.reference_number LIKE '%CLOSE-%' || c.fiscal_year || '%')
           ORDER BY (jv.reference_number = 'CLOSING-' || c.fiscal_year) DESC, jv.id DESC
           LIMIT 1) AS closing_voucher_id
  FROM candidates c
)
INSERT INTO fiscal_periods (fiscal_year, status, closed_at, closed_by, closing_voucher_id)
SELECT cy.fiscal_year, 'closed', now(), 'migration 0022', cy.closing_voucher_id
FROM closed_years cy
WHERE cy.closing_voucher_id IS NOT NULL
ON CONFLICT (fiscal_year) DO NOTHING;
