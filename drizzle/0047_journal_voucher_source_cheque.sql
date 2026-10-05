-- Drizzle Migration 0047: explicit link from a cheque's journal vouchers to the cheque (v8.0.19 / TD-271)
--
-- Problem: the vouchers of a cheque's lifecycle (registration, in collection, cleared, bounced, spent) were found by
-- (reference_module = 'cheque', reference_number = cheque number). Cheque numbers are not unique (two banks or two
-- customers can issue the same number), so deleting one cheque voided the vouchers of every other cheque with the
-- same number. Reversal vouchers (REV-V…) never match: their reference_number carries the REV-V prefix.
--
-- Fix (same pattern as source_document_id / source_payroll_id): an explicit source_cheque_id set on every voucher the
-- cheque lifecycle issues. A cheque has several vouchers, so the index is not unique. Runs inside the migrator
-- transaction.
--
-- v8.0.89 (TD-368): a voucher that 0044 refused to convert (closed fiscal year, unrecognisable date) keeps its old
-- date and leaves chk_journal_vouchers_date_datefmt NOT VALID; a NOT VALID CHECK still applies to every updated row,
-- so the backfill failed on such a voucher and the whole upgrade from v7.0.137 rolled back. Both backfill updates run
-- through erp_update_with_unvalidated_checks: the table's NOT VALID CHECK constraints are dropped for the statement and
-- added back exactly as they were (still NOT VALID), so the refused rows keep every value and only get the link.
-- Databases that already ran the previous text of this file are not affected (src/db/migrationAmendments.ts).

-- 1) Column (nullable: other vouchers and reversal vouchers have no source cheque)
ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS source_cheque_id integer REFERENCES cheques(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION erp_update_with_unvalidated_checks(p_table text, p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE
  c record;
  names text[] := '{}';
  defs text[] := '{}';
  n bigint;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = p_table::regclass AND contype = 'c' AND NOT convalidated ORDER BY conname LOOP
    names := names || c.conname::text;
    defs := defs || c.def;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table::regclass, c.conname);
  END LOOP;
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  FOR i IN 1 .. COALESCE(array_length(names, 1), 0) LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table::regclass, names[i], defs[i]);
  END LOOP;
  RETURN n;
END
$fn$;
--> statement-breakpoint

-- 2) Backfill the registration voucher of each cheque (cheques.voucher_id)
SELECT erp_update_with_unvalidated_checks('journal_vouchers', $sql$
UPDATE journal_vouchers jv
SET source_cheque_id = c.id
FROM cheques c
WHERE c.voucher_id = jv.id AND jv.source_cheque_id IS NULL
$sql$);
--> statement-breakpoint

-- 3) Backfill lifecycle vouchers ONLY when exactly one cheque (deleted ones included) has that number. Vouchers of a
--    number shared by several cheques stay unlinked; deleting such a cheque is refused while they remain
--    (ChequeLifecycleService.deleteCheque), so no voucher of another cheque is voided silently.
SELECT erp_update_with_unvalidated_checks('journal_vouchers', $sql$
WITH numbers AS (
  SELECT btrim(cheque_number) AS num, MIN(id) AS cheque_id, COUNT(*) AS n
  FROM cheques
  GROUP BY btrim(cheque_number)
)
UPDATE journal_vouchers jv
SET source_cheque_id = nb.cheque_id
FROM numbers nb
WHERE jv.source_cheque_id IS NULL
  AND jv.reference_module = 'cheque'
  AND jv.reference_number = nb.num
  AND nb.n = 1
$sql$);
--> statement-breakpoint

-- 4) Lookup index
CREATE INDEX IF NOT EXISTS idx_jv_source_cheque ON journal_vouchers (source_cheque_id) WHERE source_cheque_id IS NOT NULL;
