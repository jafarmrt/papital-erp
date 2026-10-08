-- Drizzle Migration 0031: unique voucher numbers (v7.0.91 / TD-195, audit P1-8)
--
-- Voucher numbers come from journal_voucher_number_seq. The sequence is first moved past the largest existing
-- number (a sequence behind old data would hand out numbers that already exist). The unique index is created
-- only when existing data has no duplicate number: old rows are never renumbered here. When duplicates exist the
-- index is skipped (startup is not blocked) and the financial health check lists them for the accountant.

DO $$
DECLARE
  max_number bigint;
  seq_last bigint;
  seq_called boolean;
BEGIN
  SELECT COALESCE(MAX(voucher_number), 0) INTO max_number FROM journal_vouchers;
  SELECT last_value, is_called INTO seq_last, seq_called FROM journal_voucher_number_seq;
  IF max_number > 0 AND (max_number > seq_last OR (max_number = seq_last AND NOT seq_called)) THEN
    PERFORM setval('journal_voucher_number_seq', max_number, true);
  END IF;

  IF to_regclass(format('%I.%I', current_schema(), 'uq_jv_voucher_number')) IS NULL THEN
    IF EXISTS (SELECT 1 FROM journal_vouchers GROUP BY voucher_number HAVING COUNT(*) > 1) THEN
      RAISE NOTICE 'journal_vouchers has duplicate voucher numbers; uq_jv_voucher_number not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_jv_voucher_number ON journal_vouchers (voucher_number);
    END IF;
  END IF;
END $$;
