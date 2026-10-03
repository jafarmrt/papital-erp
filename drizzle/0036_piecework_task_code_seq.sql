-- Drizzle Migration 0036: atomic automatic piecework task codes (TD-243, AGENTS §1.6)
--
-- Problem: PieceworkService.createTask built an automatic code as 'PW-' + (COUNT(*) of piecework_tasks + 1)
-- and the Excel import as 'PW-' + (MAX of active PW codes + 1). Two concurrent creations received the same code,
-- and a manually entered / imported / hard-deleted code made a later automatic code repeat an existing one
-- (piecework_tasks.code has no unique constraint, so the duplicate was stored silently).
--
-- Fix: automatic codes take their number from piecework_task_code_seq (src/services/piecework/taskCode.ts).
-- The sequence starts past every existing 'PW-<digits>' code (active or soft-deleted, leading zeros ignored)
-- AND past the current row count, so no existing code is ever reproduced. A number that still matches an
-- existing code (a code typed ahead of the sequence) is skipped by the application. Existing tasks are never
-- renamed or renumbered. Runs inside the Drizzle migrator transaction.

CREATE SEQUENCE IF NOT EXISTS piecework_task_code_seq START WITH 1 INCREMENT BY 1 MINVALUE 1;
--> statement-breakpoint

DO $$
DECLARE
  max_code bigint;
  row_count bigint;
  target bigint;
  seq_last bigint;
  seq_called boolean;
BEGIN
  -- at most 18 digits so the value always fits bigint; longer codes can never be produced by the sequence anyway
  SELECT COALESCE(MAX(CAST(substring(btrim(code) FROM '^[Pp][Ww]-0*([0-9]{1,18})$') AS bigint)), 0)
    INTO max_code FROM piecework_tasks;
  SELECT COUNT(*) INTO row_count FROM piecework_tasks;
  target := GREATEST(max_code, row_count);

  SELECT last_value, is_called INTO seq_last, seq_called FROM piecework_task_code_seq;
  IF target > 0 AND (target > seq_last OR (target = seq_last AND NOT seq_called)) THEN
    PERFORM setval('piecework_task_code_seq', target, true);
  END IF;
END $$;
