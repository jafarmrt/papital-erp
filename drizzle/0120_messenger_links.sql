-- Drizzle Migration 0120: staff messenger bots, user links and link codes (v10.1.38, messenger notifications plan part 1,
-- product-owner decision ت۱ الف)
--
-- messenger_bots holds the two staff bots (Bale and Telegram, separate from the server alert bots): the token, stored
-- only encrypted by the application (`encryptSecret`), the bot's username, the next `getUpdates` offset (so a restart
-- never reads old messages again) and the count of wrong link codes in the current ten-minute window (every chat). user_messenger_links holds each user's
-- link to a bot's chat: at most one active link per user and messenger, and one active user per chat. messenger_link_codes
-- holds the one-time six-digit codes a user sends to the bot from their profile, stored as a hash and valid ten minutes.
-- New tables only: the foreign keys are validated at once and each foreign key column has an index that leads with it
-- (TD-614). No existing row is written. Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS messenger_bots (
  messenger text PRIMARY KEY,
  token text NOT NULL DEFAULT '',
  bot_username text NOT NULL DEFAULT '',
  updated_by_id integer,
  updated_at timestamp DEFAULT now(),
  update_offset bigint NOT NULL DEFAULT 0,
  wrong_codes_count integer NOT NULL DEFAULT 0,
  wrong_codes_since timestamp,
  CONSTRAINT chk_messenger_bots_messenger CHECK (messenger IN ('bale', 'telegram')),
  CONSTRAINT fk_messenger_bots_updated_by FOREIGN KEY (updated_by_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messenger_bots_updated_by_id ON messenger_bots (updated_by_id) WHERE updated_by_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS user_messenger_links (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  messenger text NOT NULL,
  chat_id text NOT NULL,
  chat_name text NOT NULL DEFAULT '',
  is_active integer NOT NULL DEFAULT 1,
  linked_at timestamp DEFAULT now(),
  unlinked_at timestamp,
  unlink_reason text NOT NULL DEFAULT '',
  CONSTRAINT chk_user_messenger_links_messenger CHECK (messenger IN ('bale', 'telegram')),
  CONSTRAINT chk_user_messenger_links_is_active_flag CHECK (is_active IN (0, 1)),
  CONSTRAINT chk_user_messenger_links_unlink_reason CHECK (unlink_reason IN ('', 'user', 'stop', 'blocked', 'relinked', 'bot_changed')),
  CONSTRAINT fk_user_messenger_links_user FOREIGN KEY (user_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_user_messenger_links_user_id ON user_messenger_links (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_messenger_links_user_active ON user_messenger_links (user_id, messenger) WHERE is_active = 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_messenger_links_chat_active ON user_messenger_links (messenger, chat_id) WHERE is_active = 1;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS messenger_link_codes (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  messenger text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp DEFAULT now(),
  CONSTRAINT chk_messenger_link_codes_messenger CHECK (messenger IN ('bale', 'telegram')),
  CONSTRAINT uq_messenger_link_codes_code UNIQUE (messenger, code_hash),
  CONSTRAINT fk_messenger_link_codes_user FOREIGN KEY (user_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messenger_link_codes_user_id ON messenger_link_codes (user_id);
