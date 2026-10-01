-- Drizzle Migration 0018: Structured VAT on documents (v7.0.32 / TD-197 — audit P1-7)
--
-- Problem: VAT of sales invoices lived only in the free-text notes ("[ارزش افزوده: 9%]") and VoucherSync
-- extracted it with regular expressions, so a note such as "مالیات ۲ قلم آخر محاسبه نشود" posted 2 rials of
-- VAT to the ledger while the invoice itself showed none.
--
-- Fix: explicit vat_percent / vat_amount columns; the voucher reads only these. Product-owner decision: NO
-- backfill from historical notes — existing documents keep 0 here and their existing vouchers are untouched.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS vat_percent numeric(5, 2) NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS vat_amount numeric(18, 4) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_documents_vat_percent_range') THEN
    ALTER TABLE documents ADD CONSTRAINT chk_documents_vat_percent_range CHECK (vat_percent >= 0 AND vat_percent <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_documents_vat_amount_non_negative') THEN
    ALTER TABLE documents ADD CONSTRAINT chk_documents_vat_amount_non_negative CHECK (vat_amount >= 0);
  END IF;
END $$;
