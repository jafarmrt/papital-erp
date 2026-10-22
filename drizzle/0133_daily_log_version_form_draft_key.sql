-- Drizzle Migration 0133: v10.2 package 11 part 4b, save robustness (OBS-R2-58, OBS-R2-98, TD-1327)
--
-- 1. A daily work log carries a version (OBS-R2-58). An edit locked the row but had no version, so the later of two
--    edits silently replaced the earlier one. Every existing log starts at version 1; `PUT /daily-logs/:id` now requires
--    the version the form was built from and answers 409 OCC_CONFLICT when it is stale.
-- 2. A user has one live form draft per (type, key) (OBS-R2-98). The draft save looked for a row and then inserted one, so
--    two concurrent saves of one form made two drafts. A partial unique index over live drafts of a user lets the save be
--    one INSERT … ON CONFLICT. Older live duplicates of one key are soft-deleted first (is_deleted = 1, the row is kept),
--    keeping the most recently saved one, which is the draft the form reads back; a draft is the user's unsaved form
--    text, never a business record, and the daily cleanup soft-deletes drafts the same way when they expire (TD-676).
--    The number of drafts set aside is printed as a notice.

ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
DECLARE
  set_aside integer;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'uq_form_drafts_live_user_key')) IS NULL THEN
    -- through erp_update_with_unvalidated_checks (0047), so a NOT VALID CHECK of the table never refuses the upgrade
    set_aside := erp_update_with_unvalidated_checks('form_drafts', $sql$
      WITH ranked AS (
        SELECT id, row_number() OVER (
          PARTITION BY user_id, entity_type, draft_key
          ORDER BY updated_at DESC NULLS LAST, id DESC
        ) AS rn
        FROM form_drafts
        WHERE is_deleted = 0 AND user_id IS NOT NULL
      )
      UPDATE form_drafts SET is_deleted = 1
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    $sql$);
    IF set_aside > 0 THEN
      RAISE NOTICE 'form_drafts: % older duplicate live draft(s) soft-deleted before uq_form_drafts_live_user_key', set_aside;
    END IF;
    CREATE UNIQUE INDEX uq_form_drafts_live_user_key ON form_drafts (user_id, entity_type, draft_key)
      WHERE is_deleted = 0 AND user_id IS NOT NULL;
  END IF;
END $$;
