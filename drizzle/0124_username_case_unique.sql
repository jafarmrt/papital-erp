-- Drizzle Migration 0124: usernames unique regardless of letter case (OBS-R1-30, product-owner decision ت۴۰)
--
-- The username was unique only as stored text, so «Ali» and «ali» were two accounts. Two usernames that differ only in
-- letter case or surrounding spaces are now one username: the key is lower(btrim(username)) over every user, deleted
-- ones included, because a new user may not take a deleted user's username (TD-519, the form offers to restore that
-- user). The application compares the same key (src/services/users/userAccount.service.ts).
--
-- The index is created only when no two users share the key: old usernames are never changed here and still log in.
-- When duplicates exist the index is skipped with a warning and the financial health check lists them
-- (username_case_uniqueness); the system admin builds it later from the missing constraints card of the system operations page.

DO $$
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_users_username_key')) IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM users GROUP BY lower(btrim(username)) HAVING COUNT(*) > 1
    ) THEN
      RAISE WARNING 'users has usernames that differ only in letter case; uq_users_username_key not created (see the financial health check)';
    ELSE
      CREATE UNIQUE INDEX uq_users_username_key ON users (lower(btrim(username)));
    END IF;
  END IF;
END $$;
