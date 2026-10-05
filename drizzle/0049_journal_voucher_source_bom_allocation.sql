-- Drizzle Migration 0049: explicit link from a project BOM allocation's journal voucher to the allocation (v8.0.34 / TD-286)
--
-- Product-owner decision (option a): allocating materials to a project posts Dr work in progress (1402) / Cr the
-- inventory account at the Kardex cost of the allocation's out movement; releasing the allocation voids that voucher.
-- Same pattern as source_document_id / source_payroll_id / source_cheque_id: the voucher carries the allocation id.
-- Allocations made before this migration have no voucher (their stock movement had none either). Runs inside the
-- migrator transaction.

ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS source_bom_allocation_id integer REFERENCES project_bom_allocations(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jv_source_bom_allocation ON journal_vouchers (source_bom_allocation_id) WHERE source_bom_allocation_id IS NOT NULL;
