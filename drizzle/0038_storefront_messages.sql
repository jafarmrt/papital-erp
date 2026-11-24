-- v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «پیام‌های سایت», owned by package 18.
--
-- storefront_messages: one row per answer a visitor sent through a form of the site. `form_title` and `answers` are a
-- copy made when the answer arrived (each answer with the field's name and kind as they were then), so a form changed
-- or removed later never changes what a message says. `answers` holds what people wrote (names, phone numbers), so it
-- is read only with the keys site_messages.view / site_messages.manage and never copied into the audit log.
-- `status`: new («تازه»), seen («دیده‌شده») or answered («پاسخ داده شد»), with who set it last and when.
-- `lead_id`: the sales lead of the CRM this message opened, when its form asks for one («پروندهٔ فروش هم بساز»).
-- request_key and request_hash answer a repeated request with the message it already made (as for a site order).
-- No address of the visitor's device is kept. Removing a message is a soft delete.
-- The notification category site_message (a new message of the site, for the holders of site_messages.view): the
-- category check of user_notification_preferences takes the new value.
-- A new table and a wider check; no existing row is changed, and nothing on the site changes. Runs inside the Drizzle
-- migrator transaction.
CREATE TABLE IF NOT EXISTS storefront_messages (
  id serial PRIMARY KEY,
  form_id integer NOT NULL REFERENCES storefront_forms(id),
  form_title text NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'new',
  status_by text NOT NULL DEFAULT '',
  status_at timestamptz,
  lead_id integer REFERENCES crm_leads(id),
  request_key text NOT NULL,
  request_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_messages_form_title CHECK (length(form_title) >= 1 AND length(form_title) <= 120 AND form_title !~ '[[:cntrl:]]'),
  CONSTRAINT chk_storefront_messages_answers CHECK (jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) BETWEEN 1 AND 12),
  CONSTRAINT chk_storefront_messages_status CHECK (status IN ('new', 'seen', 'answered')),
  -- a message nobody has handled yet has no handler and no time, and a handled one has both
  CONSTRAINT chk_storefront_messages_status_by CHECK ((status = 'new') = (status_at IS NULL) AND (status = 'new') = (status_by = '')),
  CONSTRAINT chk_storefront_messages_request_key CHECK (request_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  CONSTRAINT chk_storefront_messages_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storefront_messages_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  CONSTRAINT chk_storefront_messages_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_messages_request_key ON storefront_messages (request_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_messages_list ON storefront_messages (status, created_at DESC, id DESC) WHERE is_deleted = 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_messages_created_at ON storefront_messages (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_messages_form_id ON storefront_messages (form_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_storefront_messages_lead_id ON storefront_messages (lead_id) WHERE lead_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE user_notification_preferences DROP CONSTRAINT IF EXISTS chk_user_notification_preferences_category;
--> statement-breakpoint
ALTER TABLE user_notification_preferences ADD CONSTRAINT chk_user_notification_preferences_category CHECK ((category = ANY (ARRAY['workflow_task'::text, 'workflow_sla'::text, 'payslip'::text, 'mention'::text, 'daily_log_review'::text, 'crm_followup'::text, 'crm_won'::text, 'event_rule'::text, 'workshop'::text, 'settings_change'::text, 'site_order'::text, 'site_buyer'::text, 'site_inquiry'::text, 'site_sms'::text, 'site_message'::text])));
