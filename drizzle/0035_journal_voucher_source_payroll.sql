-- Drizzle Migration 0035: explicit link from a payroll's journal voucher to its piecework payroll (TD-242)
--
-- Problem: a payroll's voucher was looked up by (reference_module = 'payroll', reference_id = payroll id).
-- Reversal (REV-V…), correction (CORR-V…) and void/repost (VOID-REPOST-V…, REPOST-V…) vouchers keep the
-- original reference_module ('payroll') but store the ORIGINAL VOUCHER id in reference_id, so the payroll whose
-- id equals some payroll voucher's id took that reversal/correction as "its" voucher: VoucherSync skipped issuing
-- the real voucher, and deleting the payroll reversed or soft-deleted a voucher of ANOTHER payroll.
--
-- Fix (same pattern as source_document_id, migration 0017 / TD-193): an explicit source_payroll_id link, set only
-- on vouchers that VoucherSync issues for a payroll, with a partial unique index among active vouchers.
-- Runs inside the Drizzle migrator transaction.

-- 1) Column (nullable: every other voucher, including reversal/correction vouchers, has no source payroll).
--    Payrolls are only soft-deleted in production; ON DELETE SET NULL only keeps factory reset and synthetic
--    test cleanup able to remove payroll rows without first deleting their vouchers.
ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS source_payroll_id integer REFERENCES piecework_payrolls(id) ON DELETE SET NULL;
--> statement-breakpoint

-- 2) Backfill ONLY unambiguous rows. VoucherSync.autoCreateVoucherForPayroll issues its voucher with
--    voucher_type = 'payroll', reference_module = 'payroll', reference_id = payroll id and
--    reference_number = the payroll's payroll_number (trimmed by createJournalVoucher). Reversal/correction
--    vouchers never match: their reference_number is REV-V… / RE-REV-V… / CORR-V… / VOID-REPOST-V… / REPOST-V….
--    A payroll with MORE than one such active voucher is left unlinked (no voucher is chosen silently); the
--    application treats those unlinked vouchers as the payroll's legacy vouchers (src/services/accounting/
--    payrollVoucherLink.ts), so no second voucher is issued for it and deleting the payroll still voids them.
WITH candidates AS (
  SELECT v.id,
         v.reference_id AS payroll_id,
         COUNT(*) OVER (PARTITION BY v.reference_id) AS n
  FROM journal_vouchers v
  JOIN piecework_payrolls p ON p.id = v.reference_id
  WHERE v.is_deleted = 0
    AND v.voucher_type = 'payroll'
    AND v.reference_module = 'payroll'
    AND v.reference_id IS NOT NULL
    AND v.source_payroll_id IS NULL
    AND v.reference_number = btrim(p.payroll_number)
)
UPDATE journal_vouchers jv
SET source_payroll_id = c.payroll_id
FROM candidates c
WHERE jv.id = c.id
  AND c.n = 1
  AND NOT EXISTS (
    SELECT 1 FROM journal_vouchers x
    WHERE x.source_payroll_id = c.payroll_id AND x.is_deleted = 0
  );
--> statement-breakpoint

-- 3) At most one active voucher per source payroll (final guard against double posting)
CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_source_payroll_active
  ON journal_vouchers (source_payroll_id)
  WHERE is_deleted = 0 AND source_payroll_id IS NOT NULL;
