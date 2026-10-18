-- Drizzle Migration 0128: v10.2 package 9, the group dashboard (social dashboard proposal parts A to E)
--
-- 1. personnel.is_birthday_visible: whether colleagues see the person's birthday (day and month only) on the dashboard
--    and get its bell notification. DEFAULT 1 (the owner's default: on, each person may turn it off), with its CHECK.
-- 2. users.is_presence_visible: whether colleagues see the user as «برخط است» / «امروز آمده». DEFAULT 1, with its CHECK.
--    users.whats_new_seen_version: the version whose «تازه‌های این نسخه» card the user closed ('' = none).
-- 3. birthday_greetings: one live reaction or short message per birthday person, Jalali year and sender; soft deleted.
-- 4. uq_notifications_social: one colleague-birthday notification per user and birthday, and one greeting notification
--    per birthday owner and sender (the TD-717 pattern); the types are new, so no stored row can break it.
-- No stored row is rewritten. Runs inside the Drizzle migrator transaction.

ALTER TABLE personnel ADD COLUMN IF NOT EXISTS is_birthday_visible integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_personnel_is_birthday_visible_flag' AND conrelid = 'personnel'::regclass) THEN
    ALTER TABLE personnel ADD CONSTRAINT chk_personnel_is_birthday_visible_flag CHECK (is_birthday_visible IN (0, 1));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_presence_visible integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS whats_new_seen_version text NOT NULL DEFAULT '';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_is_presence_visible_flag' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_is_presence_visible_flag CHECK (is_presence_visible IN (0, 1));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS birthday_greetings (
  id serial PRIMARY KEY,
  personnel_id integer NOT NULL,
  jalali_year integer NOT NULL,
  sender_user_id integer NOT NULL,
  reaction text,
  message text NOT NULL DEFAULT '',
  is_deleted integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_birthday_greetings_reaction CHECK (reaction IS NULL OR reaction IN ('party', 'cake', 'clap', 'heart')),
  CONSTRAINT chk_birthday_greetings_message CHECK (char_length(message) <= 200),
  CONSTRAINT chk_birthday_greetings_content CHECK (reaction IS NOT NULL OR btrim(message) <> ''),
  CONSTRAINT chk_birthday_greetings_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT fk_birthday_greetings_personnel FOREIGN KEY (personnel_id) REFERENCES personnel (id),
  CONSTRAINT fk_birthday_greetings_sender FOREIGN KEY (sender_user_id) REFERENCES users (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_birthday_greetings_live ON birthday_greetings (personnel_id, jalali_year, sender_user_id) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_birthday_greetings_personnel ON birthday_greetings (personnel_id, jalali_year);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_birthday_greetings_sender ON birthday_greetings (sender_user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_social ON notifications (user_id, type, link) WHERE type IN ('colleague_birthday', 'birthday_greeting');
