-- Drizzle Migration 0053: one active personnel per system user (v9.0.24 / TD-435, product-owner decision D2 «الف»)
--
-- «فیش‌های من» (/piecework/payrolls/mine) shows the payslips of every active personnel linked to the signed-in user, so a
-- second personnel linked to the same user exposed that person's payslips, card and Sheba numbers. A system user is now
-- linked to at most one active personnel (is_deleted = 0). Soft-deleted personnel do not count, so the user of a deleted
-- personnel can be linked again. The application checks the link under the user's row lock before insert/update
-- (src/services/personnel/personnelUserLink.ts) and maps a violation of this index to the Persian duplicate-link error.
--
-- The index is created only when existing active personnel have no duplicate user link: old links are never changed
-- here. When duplicates exist the index is skipped (startup is not blocked), the financial health check lists them
-- (personnel_user_link_uniqueness) and «فیش‌های من» refuses those users until a manager removes the wrong link.
-- Runs inside the Drizzle migrator transaction.

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_personnel_user_active')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM personnel WHERE is_deleted = 0 AND user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'personnel has users linked to more than one active personnel; uq_personnel_user_active not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_personnel_user_active ON personnel (user_id) WHERE is_deleted = 0 AND user_id IS NOT NULL;
    END IF;
  END IF;
END $$;
