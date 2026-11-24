-- v12 phase 10f (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §7.2 «۱۰و»): «فرم‌های سایت», owned by package 18.
--
-- storefront_forms: one row per form the shop builds for its site: a title, plain lines above the fields, up to twelve
-- fields of fixed kinds (`fields`, a list the server rebuilds from known keys on every save), the words of the button
-- and the message shown after the form is sent. `key` is the form's Latin name in its address on the Storefront API.
-- A form is on the site only while `enabled` is 1 («این فرم روی سایت باشد»); a new form starts off. `makes_lead` is
-- «پروندهٔ فروش هم بساز» (each answer also opens a sales lead in the CRM); it is kept here from the first migration
-- and used by the part that takes the answers. Removing a form is a soft delete, which frees its key.
-- A new table; no existing row is changed, and nothing on the site changes until the shop builds a form and turns it
-- on. Runs inside the Drizzle migrator transaction.
CREATE TABLE IF NOT EXISTS storefront_forms (
  id serial PRIMARY KEY,
  key text NOT NULL,
  title text NOT NULL,
  intro text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  submit_label text NOT NULL DEFAULT '',
  success_message text NOT NULL DEFAULT '',
  enabled integer NOT NULL DEFAULT 0,
  makes_lead integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  is_deleted integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_storefront_forms_key CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(key) <= 60),
  CONSTRAINT chk_storefront_forms_title CHECK (length(title) >= 1 AND length(title) <= 120 AND title !~ '[[:cntrl:]]'),
  -- a line break is the one control character a text of paragraphs holds
  CONSTRAINT chk_storefront_forms_intro CHECK (length(intro) <= 1000 AND replace(intro, E'\n', '') !~ '[[:cntrl:]]'),
  CONSTRAINT chk_storefront_forms_fields CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) <= 12),
  CONSTRAINT chk_storefront_forms_words CHECK (
    length(submit_label) <= 40 AND submit_label !~ '[[:cntrl:]]' AND length(success_message) <= 300 AND success_message !~ '[[:cntrl:]]'
  ),
  CONSTRAINT chk_storefront_forms_enabled_flag CHECK (enabled IN (0, 1)),
  CONSTRAINT chk_storefront_forms_makes_lead_flag CHECK (makes_lead IN (0, 1)),
  CONSTRAINT chk_storefront_forms_is_deleted_flag CHECK (is_deleted IN (0, 1)),
  -- a form with nothing to fill in is never on the site, and neither is a removed one
  CONSTRAINT chk_storefront_forms_enabled_live CHECK (enabled = 0 OR (is_deleted = 0 AND jsonb_array_length(fields) >= 1)),
  CONSTRAINT chk_storefront_forms_version CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_storefront_forms_key_live ON storefront_forms (key) WHERE is_deleted = 0;
