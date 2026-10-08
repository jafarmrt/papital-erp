-- Drizzle Migration 0037: unique piecework task codes among active tasks (TD-246, product-owner decision «قید یکتا»)
--
-- Two active piecework tasks must never share a code. The key is lower(btrim(code)): codes that differ only in
-- letter case or surrounding spaces ('PW-010', ' pw-010 ') look the same to users and are treated as one code
-- (the Excel import already matched codes this way). Soft-deleted tasks (is_deleted <> 0) do not count, so the code
-- of a deleted task can be reused. The application checks the same expression before insert/update/restore
-- (src/services/piecework/taskCode.ts) and maps a violation of this index to a Persian ConflictError.
--
-- The index is created only when existing active tasks have no duplicate code: old rows are never renamed here.
-- When duplicates exist the index is skipped (startup is not blocked) and the financial health check lists them
-- (piecework_task_code_uniqueness). Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_ptask_code_active')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM piecework_tasks WHERE is_deleted = 0 GROUP BY lower(btrim(code)) HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'piecework_tasks has duplicate codes among active tasks; uq_ptask_code_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_ptask_code_active ON piecework_tasks (lower(btrim(code))) WHERE is_deleted = 0;
    END IF;
  END IF;
END $$;
