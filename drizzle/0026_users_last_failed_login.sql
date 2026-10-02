-- Drizzle Migration 0026: last failed login timestamp (v7.0.70 / TD-187)
--
-- From v7.0.70 the progressive login lock is kept per (username + client IP) in memory (single-instance
-- deployment, v7.0.44), and the account-wide lock in users.locked_until is applied only after
-- ACCOUNT_LOCKOUT_THRESHOLD (50) failures from any address (product-owner decision). The account failure
-- streak restarts after 24 quiet hours, which needs the time of the last failure.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login_at text;
