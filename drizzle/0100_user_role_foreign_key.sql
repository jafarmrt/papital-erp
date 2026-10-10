-- Drizzle Migration 0100: users.role references roles.code (v10.0.164 / TD-962, OBS-R1-31, product-owner decision of
-- 10-09 item 7: each user's role is linked to the roles table and a role is deleted safely)
--
-- users.role held a role code with no database constraint, so a user row could name a role no role has, and deleting a
-- role left its soft-deleted users pointing to a missing role. Roles are deleted for good (no soft delete), and a deleted
-- user gets a new role when restored (TD-519), so a soft-deleted user may now hold no role:
--   * users.role drops NOT NULL, and chk_users_role_active keeps it required for every user that is not deleted;
--   * fk_users_role references roles(code) ON UPDATE CASCADE (NO ACTION on delete: the role delete clears the role of
--     its soft-deleted users in its own transaction and refuses while an active user holds it);
--   * idx_users_role indexes the column (rule of TD-614).
-- The foreign key is added NOT VALID and validated only when no user names a missing role; old rows are never changed
-- here (rule of TD-060). A key left unvalidated is listed by the financial health check (conditional_constraints_missing).
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE users ALTER COLUMN role DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_role_active' AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_role_active CHECK (is_deleted = 1 OR role IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_role' AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles (code) ON UPDATE CASCADE NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1 FROM users u WHERE u.role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = u.role)
  ) THEN
    RAISE WARNING 'users has rows whose role names a missing role; fk_users_role left NOT VALID (see the financial health check)';
  ELSE
    ALTER TABLE users VALIDATE CONSTRAINT fk_users_role;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role) WHERE role IS NOT NULL;
