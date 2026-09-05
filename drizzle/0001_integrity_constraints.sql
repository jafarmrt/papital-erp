-- V3.0.7 (TD-060) — Financial Integrity Constraints Migration
-- Conditional, idempotent: each constraint is added ONLY if the existing data is
-- clean; otherwise a WARNING is raised and the constraint is skipped (the
-- reconciliation scanner surfaces the offending rows for manual repair).
-- Runs inside the single atomic transaction of the Drizzle migrator.
DO $$
DECLARE
  dup_count integer;
  orphan_count integer;
BEGIN
  -- ============================================================
  -- 1) UNIQUE (type, ref_number) برای اسناد فعال
  -- ============================================================
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT type, ref_number FROM documents
    WHERE is_deleted = 0 AND ref_number IS NOT NULL AND ref_number <> ''
    GROUP BY type, ref_number HAVING COUNT(*) > 1
  ) d;
  IF dup_count = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_documents_type_ref_number_active') THEN
      EXECUTE 'CREATE UNIQUE INDEX uq_documents_type_ref_number_active ON documents (type, ref_number) WHERE is_deleted = 0 AND length(ref_number) > 0';
      RAISE NOTICE 'TD-060: unique index uq_documents_type_ref_number_active created';
    END IF;
  ELSE
    RAISE WARNING 'TD-060: % duplicate (type, ref_number) groups found — unique index SKIPPED until data is repaired', dup_count;
  END IF;

  -- ============================================================
  -- 2) FK transactions.item_id -> items.id
  -- ============================================================
  SELECT COUNT(*) INTO orphan_count
  FROM transactions t LEFT JOIN items i ON t.item_id = i.id
  WHERE i.id IS NULL;
  IF orphan_count = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_item_id') THEN
      EXECUTE 'ALTER TABLE transactions ADD CONSTRAINT fk_transactions_item_id FOREIGN KEY (item_id) REFERENCES items(id)';
      RAISE NOTICE 'TD-060: FK fk_transactions_item_id created';
    END IF;
  ELSE
    RAISE WARNING 'TD-060: % orphan transactions.item_id rows — FK SKIPPED', orphan_count;
  END IF;

  -- ============================================================
  -- 3) FK document_items.item_id -> items.id
  -- ============================================================
  SELECT COUNT(*) INTO orphan_count
  FROM document_items d LEFT JOIN items i ON d.item_id = i.id
  WHERE i.id IS NULL;
  IF orphan_count = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_document_items_item_id') THEN
      EXECUTE 'ALTER TABLE document_items ADD CONSTRAINT fk_document_items_item_id FOREIGN KEY (item_id) REFERENCES items(id)';
      RAISE NOTICE 'TD-060: FK fk_document_items_item_id created';
    END IF;
  ELSE
    RAISE WARNING 'TD-060: % orphan document_items.item_id rows — FK SKIPPED', orphan_count;
  END IF;

  -- ============================================================
  -- 4) FK document_items.document_id -> documents.id
  -- ============================================================
  SELECT COUNT(*) INTO orphan_count
  FROM document_items d LEFT JOIN documents doc ON d.document_id = doc.id
  WHERE d.document_id IS NOT NULL AND doc.id IS NULL;
  IF orphan_count = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_document_items_document_id') THEN
      EXECUTE 'ALTER TABLE document_items ADD CONSTRAINT fk_document_items_document_id FOREIGN KEY (document_id) REFERENCES documents(id)';
      RAISE NOTICE 'TD-060: FK fk_document_items_document_id created';
    END IF;
  ELSE
    RAISE WARNING 'TD-060: % orphan document_items.document_id rows — FK SKIPPED', orphan_count;
  END IF;

  -- ============================================================
  -- 5) FK journal_voucher_items.voucher_id -> journal_vouchers.id
  -- ============================================================
  SELECT COUNT(*) INTO orphan_count
  FROM journal_voucher_items vi LEFT JOIN journal_vouchers v ON vi.voucher_id = v.id
  WHERE v.id IS NULL;
  IF orphan_count = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_journal_voucher_items_voucher_id') THEN
      EXECUTE 'ALTER TABLE journal_voucher_items ADD CONSTRAINT fk_journal_voucher_items_voucher_id FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id)';
      RAISE NOTICE 'TD-060: FK fk_journal_voucher_items_voucher_id created';
    END IF;
  ELSE
    RAISE WARNING 'TD-060: % orphan journal_voucher_items.voucher_id rows — FK SKIPPED', orphan_count;
  END IF;

  -- ============================================================
  -- 6) FK journal_voucher_items.account_id -> accounts.id
  -- ============================================================
  SELECT COUNT(*) INTO orphan_count
  FROM journal_voucher_items vi LEFT JOIN accounts a ON vi.account_id = a.id
  WHERE a.id IS NULL;
  IF orphan_count = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_journal_voucher_items_account_id') THEN
      EXECUTE 'ALTER TABLE journal_voucher_items ADD CONSTRAINT fk_journal_voucher_items_account_id FOREIGN KEY (account_id) REFERENCES accounts(id)';
      RAISE NOTICE 'TD-060: FK fk_journal_voucher_items_account_id created';
    END IF;
  ELSE
    RAISE WARNING 'TD-060: % orphan journal_voucher_items.account_id rows — FK SKIPPED', orphan_count;
  END IF;
END $$;
