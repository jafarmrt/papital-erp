-- Drizzle Migration 0125: rebuild the sales lead stage history from before v10.1.18 (funnel report backfill)
--
-- The funnel report reads only crm_lead_stage_history, which starts with v10.1.18 (migration 0113); leads changed before
-- that were left out of it. Every earlier stage change still left an activity row on its lead: «تغییر مرحله فروش» with
-- the old and new stage from the lead form, «صدور پیش‌فاکتور شماره …» (to proposal), «تبدیل پرونده فروش به مشتری …» /
-- the older «تبدیل لید به مشتری …» (to proposal unless the lead was closed) and «ابطال پیش‌فاکتور» that reopened a won
-- lead (back to proposal). erp_backfill_crm_lead_stage_history() rebuilds each lead's history before its first live row
-- from those activities, at their own time:
--   * source 'backfill': the creation row at the lead's created_at and every change read from an activity row;
--   * source 'backfill_estimated': a creation stage that had to be guessed («مخاطب اولیه») and one closing row when the
--     stage the activities reach is not the stage the lead had next (its current stage, or the first live row's old
--     stage), dated at the lead's last edit (before the first live row).
-- Since v10.1.18 a live row and its activity row are written in one transaction a few milliseconds apart, so activities
-- less than ten seconds before a lead's first live row belong to that live row and are not read again.
-- A lost lead whose last rebuilt row is «lost» takes the lead's stored reason, else none («بی دلیل ثبت‌شده»); the
-- seller is the lead's current seller. Nothing is changed or removed: only rows are added, and a lead created after
-- v10.1.18 (its first live row has no old stage) or already rebuilt (any non-live row) is skipped, so the function may
-- run again safely. Runs inside the Drizzle migrator transaction.

ALTER TABLE crm_lead_stage_history ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_crm_lead_stage_history_source' AND conrelid = 'crm_lead_stage_history'::regclass
  ) THEN
    ALTER TABLE crm_lead_stage_history ADD CONSTRAINT chk_crm_lead_stage_history_source
      CHECK (source IN ('live', 'backfill', 'backfill_estimated'));
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_crm_stage_code(p_label text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE btrim(coalesce(p_label, ''))
    WHEN 'مخاطب اولیه' THEN 'lead'
    WHEN 'ارزیابی و نیازسنجی' THEN 'qualified'
    WHEN 'پیش‌فاکتور و پیشنهاد' THEN 'proposal'
    WHEN 'موفق (بسته شد)' THEN 'won'
    WHEN 'ناموفق (انصراف)' THEN 'lost'
    WHEN 'lead' THEN 'lead'
    WHEN 'qualified' THEN 'qualified'
    WHEN 'proposal' THEN 'proposal'
    WHEN 'won' THEN 'won'
    WHEN 'lost' THEN 'lost'
    ELSE NULL
  END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp_backfill_crm_lead_stage_history() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  l record;
  ev record;
  v_has_live boolean;
  v_cutoff timestamp;
  v_first_live_from text;
  v_target text;
  v_initial text;
  v_initial_source text;
  v_created timestamp;
  v_prev text;
  v_prev_at timestamp;
  v_to text;
  v_from text;
  v_at timestamp;
  v_first boolean;
  v_last_id integer;
  v_last_to text;
  v_inserted integer := 0;
BEGIN
  FOR l IN
    SELECT id, stage, created_at, updated_at, created_by, assigned_personnel_id, lost_reason
    FROM crm_leads ORDER BY id
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM crm_lead_stage_history WHERE lead_id = l.id AND source <> 'live');

    SELECT h.changed_at, h.from_stage INTO v_cutoff, v_first_live_from
    FROM crm_lead_stage_history h WHERE h.lead_id = l.id ORDER BY h.changed_at, h.id LIMIT 1;
    v_has_live := FOUND;
    -- created after v10.1.18: its history is complete
    CONTINUE WHEN v_has_live AND v_first_live_from IS NULL;

    v_target := CASE
      WHEN v_has_live THEN coalesce(erp_crm_stage_code(v_first_live_from), v_first_live_from)
      ELSE coalesce(erp_crm_stage_code(l.stage), 'lead')
    END;
    v_created := coalesce(l.created_at, l.updated_at, v_cutoff, now()::timestamp);
    IF v_has_live AND v_created >= v_cutoff THEN
      v_created := v_cutoff - interval '2 seconds';
    END IF;

    -- creation stage: the old stage of the first change read from the lead form; with no stage activity at all, the stage
    -- the lead had next (nothing moved it); otherwise guessed as the default «مخاطب اولیه»
    v_initial := NULL;
    v_first := true;
    FOR ev IN
      SELECT a.id, a.created_at AS at, a.title, a.description
      FROM crm_activities a
      WHERE a.lead_id = l.id AND a.created_at IS NOT NULL AND (NOT v_has_live OR a.created_at < v_cutoff - interval '10 seconds')
        AND (a.title = 'تغییر مرحله فروش'
          OR a.title LIKE 'صدور پیش‌فاکتور شماره%'
          OR a.title LIKE 'تبدیل پرونده فروش به مشتری%'
          OR a.title LIKE 'تبدیل لید به مشتری%'
          OR (a.title = 'ابطال پیش‌فاکتور' AND a.description LIKE '%از «موفق (بسته شد)» به «پیش‌فاکتور و پیشنهاد»%'))
      ORDER BY a.created_at, a.id
      LIMIT 1
    LOOP
      v_first := false;
      IF ev.title = 'تغییر مرحله فروش' THEN
        v_initial := erp_crm_stage_code(substring(ev.description FROM 'مرحله فروش از "([^"]*)" به "'));
      END IF;
    END LOOP;
    IF v_first THEN
      v_initial := v_target;
      v_initial_source := 'backfill';
    ELSIF v_initial IS NOT NULL THEN
      v_initial_source := 'backfill';
    ELSE
      v_initial := 'lead';
      v_initial_source := 'backfill_estimated';
    END IF;

    INSERT INTO crm_lead_stage_history
      (lead_id, from_stage, to_stage, lost_reason, assigned_personnel_id, changed_by_id, changed_by_name, changed_at, source)
    VALUES (l.id, NULL, v_initial, '', l.assigned_personnel_id, NULL, coalesce(l.created_by, ''), v_created, v_initial_source)
    RETURNING id INTO v_last_id;
    v_inserted := v_inserted + 1;
    v_last_to := v_initial;
    v_prev := v_initial;
    v_prev_at := v_created;

    FOR ev IN
      SELECT a.id, a.created_at AS at, a.title, a.description, a.logged_by
      FROM crm_activities a
      WHERE a.lead_id = l.id AND a.created_at IS NOT NULL AND (NOT v_has_live OR a.created_at < v_cutoff - interval '10 seconds')
        AND (a.title = 'تغییر مرحله فروش'
          OR a.title LIKE 'صدور پیش‌فاکتور شماره%'
          OR a.title LIKE 'تبدیل پرونده فروش به مشتری%'
          OR a.title LIKE 'تبدیل لید به مشتری%'
          OR (a.title = 'ابطال پیش‌فاکتور' AND a.description LIKE '%از «موفق (بسته شد)» به «پیش‌فاکتور و پیشنهاد»%'))
      ORDER BY a.created_at, a.id
    LOOP
      v_from := v_prev;
      IF ev.title = 'تغییر مرحله فروش' THEN
        v_to := erp_crm_stage_code(substring(ev.description FROM '" به "([^"]*)" تغییر یافت'));
        v_from := coalesce(erp_crm_stage_code(substring(ev.description FROM 'مرحله فروش از "([^"]*)" به "')), v_prev);
      ELSIF ev.title LIKE 'تبدیل%' AND v_prev IN ('won', 'lost') THEN
        -- a closed lead keeps its stage when converted
        v_to := NULL;
      ELSE
        v_to := 'proposal';
      END IF;
      CONTINUE WHEN v_to IS NULL OR v_to = v_prev;

      v_at := greatest(ev.at, v_prev_at);
      INSERT INTO crm_lead_stage_history
        (lead_id, from_stage, to_stage, lost_reason, assigned_personnel_id, changed_by_id, changed_by_name, changed_at, source)
      VALUES (l.id, v_from, v_to, '', l.assigned_personnel_id, NULL, coalesce(ev.logged_by, ''), v_at, 'backfill')
      RETURNING id INTO v_last_id;
      v_inserted := v_inserted + 1;
      v_last_to := v_to;
      v_prev := v_to;
      v_prev_at := v_at;
    END LOOP;

    -- the activities do not reach the stage the lead had next: one estimated row at the lead's last edit
    IF v_target IS NOT NULL AND v_prev IS DISTINCT FROM v_target THEN
      IF v_has_live THEN
        v_at := greatest(v_prev_at, least(coalesce(l.updated_at, v_cutoff), v_cutoff - interval '1 second'));
      ELSE
        v_at := greatest(v_prev_at, coalesce(l.updated_at, v_prev_at));
      END IF;
      INSERT INTO crm_lead_stage_history
        (lead_id, from_stage, to_stage, lost_reason, assigned_personnel_id, changed_by_id, changed_by_name, changed_at, source)
      VALUES (l.id, v_prev, v_target, '', l.assigned_personnel_id, NULL, '', v_at, 'backfill_estimated')
      RETURNING id INTO v_last_id;
      v_inserted := v_inserted + 1;
      v_last_to := v_target;
    END IF;

    -- the lead's stored lost reason belongs to its last move into «lost»
    IF NOT v_has_live AND v_last_to = 'lost' AND l.stage = 'lost' AND coalesce(l.lost_reason, '') <> '' THEN
      UPDATE crm_lead_stage_history SET lost_reason = l.lost_reason WHERE id = v_last_id;
    END IF;
  END LOOP;
  RETURN v_inserted;
END
$fn$;
--> statement-breakpoint
SELECT erp_backfill_crm_lead_stage_history();
