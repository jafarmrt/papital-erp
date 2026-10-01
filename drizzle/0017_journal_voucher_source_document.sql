-- Drizzle Migration 0017: One active journal voucher per source document (v7.0.31 / TD-193 — audit P1-8)
--
-- Problem: VoucherSync looked up a document's voucher by (reference_module = 'invoice', reference_id = doc.id)
-- without a lock or unique index, and the full voucher sync ran on every boot of every pod; two replicas
-- starting together could post the same invoice twice (double revenue). The audit's suggested unique index
-- on (reference_module, reference_id) is unusable: reversal (REV-V…), correction (CORR-V…) and void/repost
-- vouchers keep reference_module = 'invoice' but store the ORIGINAL VOUCHER id in reference_id, so a
-- correction (REV + CORR rows) would violate it, and a reversal whose voucher id equals some document id
-- was mistaken for that document's voucher.
--
-- Fix: an explicit source_document_id link, set only on vouchers that VoucherSync issues for a document,
-- with a partial unique index. Runs inside the Drizzle migrator transaction.

-- 1) Column (nullable: manual, treasury, payroll, reversal and correction vouchers have no source document).
--    Documents are never hard-deleted in production (RULE 09); ON DELETE SET NULL only keeps factory reset and
--    synthetic test cleanup able to remove documents without first deleting their vouchers.
ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS source_document_id integer REFERENCES documents(id) ON DELETE SET NULL;

-- 2) Backfill: only vouchers issued by VoucherSync carry reference_number = the document's ref_number
--    (reversal/correction vouchers use REV-V… / CORR-V… / RE-REV-V… / VOID-REPOST-V…). When a document already
--    has several such active vouchers (multi-pod boot race), the OLDEST one becomes the document's voucher and
--    the others are left unlinked, unchanged, for the accountant (product-owner decision; they are listed by
--    the financial health check as duplicate document vouchers).
WITH ranked AS (
  SELECT v.id,
         v.reference_id AS doc_id,
         ROW_NUMBER() OVER (PARTITION BY v.reference_id ORDER BY v.id) AS rn
  FROM journal_vouchers v
  JOIN documents d ON d.id = v.reference_id
  WHERE v.is_deleted = 0
    AND v.reference_module = 'invoice'
    AND v.reference_id IS NOT NULL
    AND v.source_document_id IS NULL
    AND v.reference_number = d.ref_number
)
UPDATE journal_vouchers jv
SET source_document_id = r.doc_id
FROM ranked r
WHERE jv.id = r.id
  AND r.rn = 1
  AND NOT EXISTS (
    SELECT 1 FROM journal_vouchers x
    WHERE x.source_document_id = r.doc_id AND x.is_deleted = 0
  );

-- 3) At most one active voucher per source document (final guard against double posting)
CREATE UNIQUE INDEX IF NOT EXISTS uq_jv_source_document_active
  ON journal_vouchers (source_document_id)
  WHERE is_deleted = 0 AND source_document_id IS NOT NULL;

-- 4) Lookup index for reference queries (reversal chains, legacy duplicate detection)
CREATE INDEX IF NOT EXISTS idx_jv_reference ON journal_vouchers (reference_module, reference_id);
