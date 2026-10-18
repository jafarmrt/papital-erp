-- Drizzle Migration 0129: one row per signed-in device (10.2 package 8, D-07)
--
-- New table only; no existing row is written. Every login writes a user_sessions row and its token carries the row's
-- sid, so a user can see the devices they are signed in on and close one of them (a lost phone) without signing out
-- the others. A token of a closed, expired or older (users.token_version) session is refused on its next request.
-- A token issued before this release has no sid; its first request adopts it under a sid derived from its CSRF
-- value (else its issue time), so nobody has to sign in again. Rows are closed (revoked_at), never deleted; users
-- are only soft-deleted, and the foreign key cascades only for the factory reset and test cleanup that hard-delete
-- a user. It is valid at once because the table is new; its column has an index that leads with it (TD-614).
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS user_sessions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  sid text NOT NULL,
  token_version integer NOT NULL DEFAULT 0,
  user_agent text NOT NULL DEFAULT '',
  ip_address text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL,
  revoked_at timestamp,
  revoke_reason text NOT NULL DEFAULT '',
  CONSTRAINT chk_user_sessions_revoke_reason CHECK (revoke_reason IN ('', 'logout', 'closed_by_user', 'closed_by_admin', 'others_closed')),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_sid ON user_sessions (sid);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id, id);
