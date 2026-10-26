-- v11 (phase 4.1): baseline of the series-10 schema. It replaces the 136 migrations 0000_v3_baseline ..
-- 0135_event_privacy_settings_notice (their text: commit 41e9644, v11.2.0) and builds exactly what they built on an
-- empty database: tables, constraints, indexes, functions, triggers, sequences and the rows those migrations wrote.
-- A database that already ran those 136 migrations never runs this file (foldSquashedHistory in src/db/migrationPlan.ts).
-- Generated from pg_dump of a freshly migrated database; objects are unqualified, so the file builds the current schema.
-- SQL functions are created in name order before the functions they call (as pg_dump restores them), so their bodies
-- are checked when they run, not when they are created. The migrator runs every pending migration in one transaction,
-- so the setting is put back at the end of this file and the migrations after it are checked as on any database.
SET LOCAL check_function_bodies = false;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE FUNCTION erp_backfill_crm_lead_stage_history() RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
    -- created after v10.1.18: its first live row is its creation (no old stage, written with the lead); a lead without a
    -- creation time is left alone, so nothing is written twice. An older lead whose stage was empty also leaves no old stage
    -- on its first live change, but was created well before it.
    CONTINUE WHEN v_has_live AND btrim(coalesce(v_first_live_from, '')) = ''
      AND (l.created_at IS NULL OR l.created_at >= v_cutoff - interval '10 seconds');

    -- the stage the lead had next: an empty stage is the default «مخاطب اولیه», an unknown value none (no row goes to it)
    v_target := CASE
      WHEN btrim(coalesce(CASE WHEN v_has_live THEN v_first_live_from ELSE l.stage END, '')) = '' THEN 'lead'
      ELSE erp_crm_stage_code(CASE WHEN v_has_live THEN v_first_live_from ELSE l.stage END)
    END;
    v_created := coalesce(l.created_at, l.updated_at, v_cutoff, now()::timestamp);
    IF v_has_live AND v_created >= v_cutoff THEN
      v_created := v_cutoff - interval '2 seconds';
    END IF;

    -- creation stage: the old stage of the first change read from the lead form; with no stage activity at all, the stage
    -- the lead had next (exact only when that is the default «مخاطب اولیه»: a lead may have been created in a later stage
    -- or moved without a log row); otherwise guessed as «مخاطب اولیه». Soft-deleted activities are read on purpose: a
    -- deleted log row still records a stage change that happened.
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
      v_initial := coalesce(v_target, 'lead');
      v_initial_source := CASE WHEN v_initial = 'lead' AND v_target IS NOT NULL THEN 'backfill' ELSE 'backfill_estimated' END;
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
$$;
--> statement-breakpoint
CREATE FUNCTION erp_correct_ref_fiscal_year_boundaries() RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
  moved integer;
BEGIN
  -- 1) Boundary rows still carrying the old 21-March approximation (documents already reported are skipped)
  INSERT INTO ref_fiscal_year_corrections
    (document_id, doc_type, ref_number, document_date, old_fiscal_year, new_fiscal_year, status)
  SELECT d.id, d.type, d.ref_number, d.date, d.ref_fiscal_year, erp_ref_fiscal_year(d.date),
         CASE WHEN d.is_deleted = 0 AND length(d.ref_number) > 0 AND EXISTS (
                SELECT 1 FROM documents o
                 WHERE o.id <> d.id AND o.type = d.type AND o.is_deleted = 0
                   AND o.ref_fiscal_year = erp_ref_fiscal_year(d.date) AND o.ref_number = d.ref_number)
              THEN 'conflict' ELSE 'corrected' END
    FROM documents d
   WHERE d.ref_fiscal_year = EXTRACT(YEAR FROM d.date)::integer - 621
           - CASE WHEN EXTRACT(MONTH FROM d.date) < 3
                    OR (EXTRACT(MONTH FROM d.date) = 3 AND EXTRACT(DAY FROM d.date) < 21)
                  THEN 1 ELSE 0 END
     AND d.ref_fiscal_year <> erp_ref_fiscal_year(d.date)
     AND NOT EXISTS (SELECT 1 FROM ref_fiscal_year_corrections c WHERE c.document_id = d.id);

  -- 2) Move the non-conflicting rows; reference numbers stay as they are
  UPDATE documents d
     SET ref_fiscal_year = c.new_fiscal_year
    FROM ref_fiscal_year_corrections c
   WHERE c.document_id = d.id AND c.status = 'corrected' AND d.ref_fiscal_year = c.old_fiscal_year;
  GET DIAGNOSTICS moved = ROW_COUNT;

  -- 3) Keep an existing counter of the target year above the moved serials so automatic numbering never
  --    hands out a number that a moved document already uses (numeric suffix only, as in v7.0.60)
  UPDATE document_ref_counters k
     SET last_ref_number = s.max_serial
    FROM (
      SELECT c.doc_type, c.new_fiscal_year, MAX(CASE WHEN length(x.serial) <= 10 THEN x.serial::bigint END) AS max_serial
        FROM ref_fiscal_year_corrections c
        CROSS JOIN LATERAL (SELECT substring(c.ref_number FROM '([0-9]+)$') AS serial) x
       WHERE c.status = 'corrected' AND x.serial IS NOT NULL
       GROUP BY c.doc_type, c.new_fiscal_year
    ) s
   WHERE k.doc_type = s.doc_type AND k.fiscal_year = s.new_fiscal_year
     AND s.max_serial <= 2147483647 AND k.last_ref_number < s.max_serial;

  RETURN moved;
END;
$_$;
--> statement-breakpoint
CREATE FUNCTION erp_crm_stage_code(p_label text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
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
$$;
--> statement-breakpoint
CREATE FUNCTION erp_date_text_ok(v text, kind text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT v IS NULL OR v = '' OR CASE kind
    WHEN 'iso' THEN v ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    WHEN 'isots' THEN v ~ '^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'
    ELSE translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
      ~ '^((19|20|21)[0-9]{2}|1[345][0-9]{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$'
  END
$_$;
--> statement-breakpoint
CREATE FUNCTION erp_documents_fill_ref_fiscal_year() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.ref_fiscal_year IS NULL THEN
    NEW.ref_fiscal_year := erp_ref_fiscal_year(NEW.date);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION erp_items_current_stock_from_table() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.current_stock := COALESCE((SELECT SUM(s.current_stock) FROM item_warehouse_stocks s WHERE s.item_id = NEW.id), 0);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION erp_iws_refresh_item_current_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_item_id integer;
BEGIN
  v_item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  -- the BEFORE trigger on items recomputes the value from item_warehouse_stocks
  UPDATE items SET current_stock = 0 WHERE id = v_item_id;
  IF TG_OP = 'UPDATE' AND OLD.item_id IS DISTINCT FROM NEW.item_id THEN
    UPDATE items SET current_stock = 0 WHERE id = OLD.item_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION erp_jalali_to_gregorian(jy integer, jm integer, jd integer) RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$
  -- Nowruz (1 Farvardin) from erp_nowruz_march_day (migration 0024), plus the day of the Jalali year
  SELECT make_date(jy + 621, 3, erp_nowruz_march_day(jy + 621))
         + (CASE WHEN jm <= 6 THEN (jm - 1) * 31 ELSE 186 + (jm - 7) * 30 END + jd - 1)
$$;
--> statement-breakpoint
CREATE FUNCTION erp_nowruz_march_day(gy integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN gy BETWEEN 1921 AND 2121 THEN 20 + substr(
      '122112211121112111211121112111211121112111111111111111111111111111111111111011101110111011101110111011101110011001100110011001100110011001100010001000100010001000100010001000000001111111111111111111111',
      gy - 1920, 1)::integer
    ELSE 21
  END
$$;
--> statement-breakpoint
CREATE FUNCTION erp_ref_fiscal_year(ts timestamp without time zone) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN ts IS NULL THEN NULL
    ELSE EXTRACT(YEAR FROM ts)::integer - 621
         - CASE WHEN EXTRACT(MONTH FROM ts) < 3
                  OR (EXTRACT(MONTH FROM ts) = 3
                      AND EXTRACT(DAY FROM ts) < erp_nowruz_march_day(EXTRACT(YEAR FROM ts)::integer))
                THEN 1 ELSE 0 END
  END
$$;
--> statement-breakpoint
CREATE FUNCTION erp_repair_legacy_mdy_dates() RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
  pat constant text := '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-(1[345][0-9]{2})( AP)?$';
  fixed integer := 0;
  n integer;
BEGIN
  -- 1) journal_vouchers.date -> Jalali YYYY-MM-DD; refused when that Jalali fiscal year is closed
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason)
  SELECT 'journal_vouchers', v.id, 'date', v.date, x.m[3] || '-' || x.m[1] || '-' || x.m[2],
         CASE WHEN fp.status = 'closed' THEN 'refused' ELSE 'corrected' END,
         CASE WHEN fp.status = 'closed' THEN 'سال مالی ' || x.m[3] || ' بسته است' END
    FROM journal_vouchers v
    CROSS JOIN LATERAL (SELECT regexp_match(v.date, pat) AS m) x
    LEFT JOIN fiscal_periods fp ON fp.fiscal_year = x.m[3]::integer
   WHERE x.m IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'journal_vouchers' AND r.row_id = v.id AND r.column_name = 'date');
  UPDATE journal_vouchers v SET date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'journal_vouchers' AND r.column_name = 'date' AND r.row_id = v.id
     AND r.status = 'corrected' AND v.date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  fixed := fixed + n;

  -- 2) treasury_transactions.date -> Gregorian ISO
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status)
  SELECT 'treasury_transactions', t.id, 'date', t.date,
         to_char(erp_jalali_to_gregorian(x.m[3]::integer, x.m[1]::integer, x.m[2]::integer), 'YYYY-MM-DD'), 'corrected'
    FROM treasury_transactions t
    CROSS JOIN LATERAL (SELECT regexp_match(t.date, pat) AS m) x
   WHERE x.m IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'treasury_transactions' AND r.row_id = t.id AND r.column_name = 'date');
  UPDATE treasury_transactions t SET date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'treasury_transactions' AND r.column_name = 'date' AND r.row_id = t.id
     AND r.status = 'corrected' AND t.date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  fixed := fixed + n;

  -- 3) piecework_payrolls.payment_date -> Jalali YYYY-MM-DD
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status)
  SELECT 'piecework_payrolls', p.id, 'payment_date', p.payment_date, x.m[3] || '-' || x.m[1] || '-' || x.m[2], 'corrected'
    FROM piecework_payrolls p
    CROSS JOIN LATERAL (SELECT regexp_match(p.payment_date, pat) AS m) x
   WHERE x.m IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'piecework_payrolls' AND r.row_id = p.id AND r.column_name = 'payment_date');
  UPDATE piecework_payrolls p SET payment_date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'piecework_payrolls' AND r.column_name = 'payment_date' AND r.row_id = p.id
     AND r.status = 'corrected' AND p.payment_date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  fixed := fixed + n;

  RETURN fixed;
END;
$_$;
--> statement-breakpoint
CREATE FUNCTION erp_set_date_constraint(p_table text, p_column text, p_kind text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  cname text := 'chk_' || p_table || '_' || p_column || '_datefmt';
  bad boolean;
BEGIN
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', p_table, cname);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (erp_date_text_ok(%I, %L)) NOT VALID', p_table, cname, p_column, p_kind);
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE NOT erp_date_text_ok(%I, %L))', p_table, p_column, p_kind) INTO bad;
  IF bad THEN
    RAISE WARNING '%.%: rows that do not match the % date format kept; constraint % left NOT VALID', p_table, p_column, p_kind, cname;
    RETURN false;
  END IF;
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, cname);
  RETURN true;
END
$$;
--> statement-breakpoint
CREATE FUNCTION erp_set_iso_date_constraint(p_table text, p_column text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  cname text := 'chk_' || p_table || '_' || p_column || '_datefmt';
  bad boolean;
BEGIN
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', p_table, cname);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (erp_date_text_ok(%I, %L)) NOT VALID', p_table, cname, p_column, 'iso');
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE NOT erp_date_text_ok(%I, %L))', p_table, p_column, 'iso') INTO bad;
  IF bad THEN
    RAISE WARNING '%.%: rows that are not ISO dates kept (see legacy_date_repairs); constraint % left NOT VALID', p_table, p_column, cname;
    RETURN false;
  END IF;
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, cname);
  RETURN true;
END
$$;
--> statement-breakpoint
CREATE FUNCTION erp_sync_crm_iso_companions() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  n integer;
  total integer := 0;
BEGIN
  -- record a non-empty companion value that differs from the (ISO or empty) main value, then copy the main value
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
  SELECT 'crm_activities', a.id, 'activity_date_iso', a.activity_date_iso, COALESCE(a.activity_date, ''), 'corrected',
         'هم‌سان با activity_date', 'calendar'
    FROM crm_activities a
   WHERE COALESCE(a.activity_date_iso, '') <> '' AND a.activity_date_iso IS DISTINCT FROM COALESCE(a.activity_date, '')
     AND erp_date_text_ok(a.activity_date, 'iso')
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'crm_activities' AND r.row_id = a.id
                       AND r.column_name = 'activity_date_iso' AND r.repair_kind = 'calendar' AND r.old_value = a.activity_date_iso);
  UPDATE crm_activities SET activity_date_iso = COALESCE(activity_date, '')
   WHERE activity_date_iso IS DISTINCT FROM COALESCE(activity_date, '') AND erp_date_text_ok(activity_date, 'iso');
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;

  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
  SELECT 'crm_activities', a.id, 'next_followup_date_iso', a.next_followup_date_iso, COALESCE(a.next_followup_date, ''), 'corrected',
         'هم‌سان با next_followup_date', 'calendar'
    FROM crm_activities a
   WHERE COALESCE(a.next_followup_date_iso, '') <> '' AND a.next_followup_date_iso IS DISTINCT FROM COALESCE(a.next_followup_date, '')
     AND erp_date_text_ok(a.next_followup_date, 'iso')
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = 'crm_activities' AND r.row_id = a.id
                       AND r.column_name = 'next_followup_date_iso' AND r.repair_kind = 'calendar' AND r.old_value = a.next_followup_date_iso);
  UPDATE crm_activities SET next_followup_date_iso = COALESCE(next_followup_date, '')
   WHERE next_followup_date_iso IS DISTINCT FROM COALESCE(next_followup_date, '') AND erp_date_text_ok(next_followup_date, 'iso');
  GET DIAGNOSTICS n = ROW_COUNT;
  total := total + n;
  RETURN total;
END
$$;
--> statement-breakpoint
CREATE FUNCTION erp_sync_iso_companion(p_table text, p_main text, p_companion text) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
  n integer;
BEGIN
  EXECUTE format($q$
    INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
    SELECT %1$L, t.id, %3$L, t.%3$I, COALESCE(t.%2$I, ''), 'corrected', %4$L, 'calendar'
      FROM %1$I t
     WHERE COALESCE(t.%3$I, '') <> '' AND t.%3$I IS DISTINCT FROM COALESCE(t.%2$I, '')
       AND erp_date_text_ok(t.%2$I, 'iso')
       AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r WHERE r.table_name = %1$L AND r.row_id = t.id
                         AND r.column_name = %3$L AND r.repair_kind = 'calendar' AND r.old_value = t.%3$I)
  $q$, p_table, p_main, p_companion, 'هم‌سان با ' || p_main);
  EXECUTE format($q$
    UPDATE %1$I SET %3$I = COALESCE(%2$I, '')
     WHERE %3$I IS DISTINCT FROM COALESCE(%2$I, '') AND erp_date_text_ok(%2$I, 'iso')
  $q$, p_table, p_main, p_companion);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$_$;
--> statement-breakpoint
CREATE FUNCTION erp_text_date_kind(v text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN v IS NULL OR btrim(v) = '' THEN 'empty'
    WHEN erp_text_date_to_iso(v) IS NULL THEN 'invalid'
    WHEN erp_text_date_to_iso(v) = v THEN 'iso'
    WHEN btrim(translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')) ~ '^1[345][0-9]{2}' THEN 'jalali'
    ELSE 'gregorian'
  END
$$;
--> statement-breakpoint
CREATE FUNCTION erp_text_date_to_iso(v text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE
  s text;
  m text[];
  y integer;
  mo integer;
  d integer;
  g date;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  s := btrim(translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'));
  IF s = '' THEN RETURN NULL; END IF;
  m := regexp_match(s, '^([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$');
  IF m IS NULL THEN RETURN NULL; END IF;
  y := m[1]::integer;
  mo := m[2]::integer;
  d := m[3]::integer;
  IF mo < 1 OR mo > 12 OR d < 1 THEN RETURN NULL; END IF;
  IF y BETWEEN 1900 AND 2199 THEN
    BEGIN
      g := make_date(y, mo, d);
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    RETURN to_char(g, 'YYYY-MM-DD');
  ELSIF y BETWEEN 1300 AND 1500 THEN
    IF (mo <= 6 AND d > 31) OR (mo > 6 AND d > 30) THEN RETURN NULL; END IF;
    g := erp_jalali_to_gregorian(y, mo, d);
    -- 30 Esfand of a common year falls on 1 Farvardin of the next year
    IF mo = 12 AND d = 30 AND g = erp_jalali_to_gregorian(y + 1, 1, 1) THEN RETURN NULL; END IF;
    RETURN to_char(g, 'YYYY-MM-DD');
  END IF;
  RETURN NULL;
END
$_$;
--> statement-breakpoint
CREATE FUNCTION erp_unify_journal_voucher_dates() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
  SELECT 'journal_vouchers', v.id, 'date', v.date, COALESCE(x.iso, v.date),
         CASE WHEN x.iso IS NULL OR fp.status = 'closed' THEN 'refused' ELSE 'corrected' END,
         CASE WHEN x.iso IS NULL THEN 'تاریخ قابل تشخیص نیست؛ مقدار قبلی دست نخورد'
              WHEN fp.status = 'closed' THEN 'سال مالی ' || fp.fiscal_year || ' بسته است' END,
         'calendar'
    FROM journal_vouchers v
    CROSS JOIN LATERAL (SELECT erp_text_date_to_iso(v.date) AS iso) x
    LEFT JOIN fiscal_periods fp ON x.iso IS NOT NULL AND fp.fiscal_year = erp_ref_fiscal_year(x.iso::timestamp)
   WHERE btrim(COALESCE(v.date, '')) <> ''
     AND v.date IS DISTINCT FROM x.iso
     AND NOT EXISTS (SELECT 1 FROM legacy_date_repairs r
                      WHERE r.table_name = 'journal_vouchers' AND r.column_name = 'date' AND r.row_id = v.id
                        AND r.repair_kind = 'calendar' AND r.old_value = v.date);
  UPDATE journal_vouchers v SET date = r.new_value
    FROM legacy_date_repairs r
   WHERE r.table_name = 'journal_vouchers' AND r.column_name = 'date' AND r.row_id = v.id
     AND r.repair_kind = 'calendar' AND r.status = 'corrected' AND v.date = r.old_value;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
CREATE FUNCTION erp_unify_text_date_column(p_table text, p_column text) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
  n integer;
BEGIN
  -- 1) record every non-empty, non-canonical value once per old value (re-running adds nothing)
  EXECUTE format($q$
    INSERT INTO legacy_date_repairs (table_name, row_id, column_name, old_value, new_value, status, reason, repair_kind)
    SELECT %1$L, t.id, %2$L, t.%2$I, COALESCE(x.iso, t.%2$I),
           CASE WHEN x.iso IS NULL THEN 'refused' ELSE 'corrected' END,
           CASE WHEN x.iso IS NULL THEN 'تاریخ قابل تشخیص نیست؛ مقدار قبلی دست نخورد' END,
           'calendar'
      FROM %1$I t
      CROSS JOIN LATERAL (SELECT erp_text_date_to_iso(t.%2$I) AS iso) x
     WHERE btrim(COALESCE(t.%2$I, '')) <> ''
       AND t.%2$I IS DISTINCT FROM x.iso
       AND NOT EXISTS (
         SELECT 1 FROM legacy_date_repairs r
          WHERE r.table_name = %1$L AND r.column_name = %2$L AND r.row_id = t.id
            AND r.repair_kind = 'calendar' AND r.old_value = t.%2$I)
  $q$, p_table, p_column);
  -- 2) apply the corrected values (only where the row still holds the recorded old value)
  EXECUTE format($q$
    UPDATE %1$I t SET %2$I = r.new_value
      FROM legacy_date_repairs r
     WHERE r.table_name = %1$L AND r.column_name = %2$L AND r.row_id = t.id
       AND r.repair_kind = 'calendar' AND r.status = 'corrected' AND t.%2$I = r.old_value
  $q$, p_table, p_column);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$_$;
--> statement-breakpoint
CREATE FUNCTION erp_update_with_unvalidated_checks(p_table text, p_sql text) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  c record;
  names text[] := '{}';
  defs text[] := '{}';
  n bigint;
BEGIN
  FOR c IN SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = p_table::regclass AND contype = 'c' AND NOT convalidated ORDER BY conname LOOP
    names := names || c.conname::text;
    defs := defs || c.def;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p_table::regclass, c.conname);
  END LOOP;
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  FOR i IN 1 .. COALESCE(array_length(names, 1), 0) LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table::regclass, names[i], defs[i]);
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
CREATE FUNCTION set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TABLE _repair_0011_timestamps_backup (
    id integer NOT NULL,
    table_name text NOT NULL,
    row_id integer NOT NULL,
    column_name text NOT NULL,
    original_date text,
    repaired_date text,
    backed_up_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE _repair_0011_timestamps_backup_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE _repair_0011_timestamps_backup_id_seq OWNED BY _repair_0011_timestamps_backup.id;
--> statement-breakpoint
CREATE TABLE accounting_settings (
    id integer NOT NULL,
    key text NOT NULL,
    account_id integer,
    description text DEFAULT ''::text,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE accounting_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE accounting_settings_id_seq OWNED BY accounting_settings.id;
--> statement-breakpoint
CREATE TABLE accounts (
    id integer NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    level text NOT NULL,
    parent_id integer,
    account_type text NOT NULL,
    nature text DEFAULT 'debit'::text NOT NULL,
    description text DEFAULT ''::text,
    is_system integer DEFAULT 0,
    is_active integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_accounts_account_type CHECK (((is_deleted = 1) OR (account_type = ANY (ARRAY['asset'::text, 'liability'::text, 'equity'::text, 'revenue'::text, 'expense'::text, 'cost_of_sales'::text])))),
    CONSTRAINT chk_accounts_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_accounts_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_accounts_is_system_flag CHECK ((is_system = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_accounts_level CHECK (((is_deleted = 1) OR (level = ANY (ARRAY['group'::text, 'general'::text, 'subsidiary'::text, 'detailed'::text])))),
    CONSTRAINT chk_accounts_nature CHECK (((is_deleted = 1) OR (nature = ANY (ARRAY['debit'::text, 'credit'::text, 'both'::text]))))
);
--> statement-breakpoint
CREATE SEQUENCE accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE accounts_id_seq OWNED BY accounts.id;
--> statement-breakpoint
CREATE TABLE activity_logs (
    id integer NOT NULL,
    user_id integer,
    username text NOT NULL,
    user_full_name text DEFAULT ''::text,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text DEFAULT ''::text,
    description text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address text DEFAULT ''::text,
    "timestamp" timestamp without time zone DEFAULT now(),
    trace_id text DEFAULT ''::text
);
--> statement-breakpoint
CREATE SEQUENCE activity_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE activity_logs_id_seq OWNED BY activity_logs.id;
--> statement-breakpoint
CREATE TABLE app_settings (
    key text NOT NULL,
    value text NOT NULL
);
--> statement-breakpoint
CREATE TABLE bank_accounts (
    id integer NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    type text DEFAULT 'bank'::text NOT NULL,
    bank_name text DEFAULT ''::text,
    account_number text DEFAULT ''::text,
    sheba_number text DEFAULT ''::text,
    card_number text DEFAULT ''::text,
    branch text DEFAULT ''::text,
    initial_balance numeric(18,4) DEFAULT 0,
    current_balance numeric(18,4) DEFAULT 0,
    currency text DEFAULT 'IRR'::text,
    account_id integer,
    is_active integer DEFAULT 1,
    notes text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    opening_date text DEFAULT ''::text,
    CONSTRAINT chk_bank_accounts_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_bank_accounts_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_bank_accounts_opening_date_datefmt CHECK (erp_date_text_ok(opening_date, 'iso'::text)),
    CONSTRAINT chk_bank_balance_nonneg CHECK (((initial_balance >= (0)::numeric) AND (current_balance >= (0)::numeric)))
);
--> statement-breakpoint
CREATE SEQUENCE bank_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE bank_accounts_id_seq OWNED BY bank_accounts.id;
--> statement-breakpoint
CREATE TABLE birthday_greetings (
    id integer NOT NULL,
    personnel_id integer NOT NULL,
    jalali_year integer NOT NULL,
    sender_user_id integer NOT NULL,
    reaction text,
    message text DEFAULT ''::text NOT NULL,
    is_deleted integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_birthday_greetings_content CHECK (((reaction IS NOT NULL) OR (btrim(message) <> ''::text))),
    CONSTRAINT chk_birthday_greetings_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_birthday_greetings_message CHECK ((char_length(message) <= 200)),
    CONSTRAINT chk_birthday_greetings_reaction CHECK (((reaction IS NULL) OR (reaction = ANY (ARRAY['party'::text, 'cake'::text, 'clap'::text, 'heart'::text]))))
);
--> statement-breakpoint
CREATE SEQUENCE birthday_greetings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE birthday_greetings_id_seq OWNED BY birthday_greetings.id;
--> statement-breakpoint
CREATE TABLE categories (
    id integer NOT NULL,
    name text NOT NULL,
    prefix text NOT NULL,
    type text NOT NULL,
    default_unit text DEFAULT 'عدد'::text,
    is_deleted integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_categories_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE categories_id_seq OWNED BY categories.id;
--> statement-breakpoint
CREATE TABLE cheques (
    id integer NOT NULL,
    type text NOT NULL,
    cheque_number text NOT NULL,
    sayad_number text DEFAULT ''::text,
    bank_name text NOT NULL,
    branch text DEFAULT ''::text,
    issue_date text NOT NULL,
    due_date text NOT NULL,
    amount numeric(18,4) NOT NULL,
    currency text DEFAULT 'IRR'::text,
    party_type text DEFAULT 'customer'::text,
    party_id integer,
    party_name text NOT NULL,
    status text DEFAULT 'received'::text,
    drawer_name text DEFAULT ''::text,
    payee_name text DEFAULT ''::text,
    bank_account_id integer,
    voucher_id integer,
    description text DEFAULT ''::text,
    status_history jsonb DEFAULT '[]'::jsonb,
    created_by_id integer,
    created_at timestamp without time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    attachments jsonb DEFAULT '[]'::jsonb,
    purpose text,
    party_account_id integer,
    reconciled integer DEFAULT 0,
    reconciled_at text DEFAULT ''::text,
    reconciled_batch text DEFAULT ''::text,
    CONSTRAINT chk_cheques_due_date_datefmt CHECK (erp_date_text_ok(due_date, 'iso'::text)),
    CONSTRAINT chk_cheques_history_array CHECK (((status_history IS NULL) OR (jsonb_typeof(status_history) = 'array'::text))),
    CONSTRAINT chk_cheques_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_cheques_issue_date_datefmt CHECK (erp_date_text_ok(issue_date, 'iso'::text)),
    CONSTRAINT chk_cheques_purpose CHECK (((purpose IS NULL) OR (purpose = ANY (ARRAY['settlement'::text, 'advance'::text, 'deductions'::text, 'other'::text])))),
    CONSTRAINT chk_cheques_reconciled_at_datefmt CHECK (erp_date_text_ok(reconciled_at, 'isots'::text)),
    CONSTRAINT chk_cheques_reconciled_flag CHECK ((reconciled = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE cheques_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE cheques_id_seq OWNED BY cheques.id;
--> statement-breakpoint
CREATE TABLE crm_activities (
    id integer NOT NULL,
    lead_id integer,
    customer_id integer,
    type text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    result text DEFAULT ''::text,
    logged_by text DEFAULT ''::text,
    assigned_to text DEFAULT ''::text,
    assigned_personnel_id integer,
    mentions jsonb DEFAULT '[]'::jsonb,
    activity_date text DEFAULT ''::text,
    activity_date_iso text DEFAULT ''::text,
    next_followup_date text DEFAULT ''::text,
    next_followup_date_iso text DEFAULT ''::text,
    next_followup_task text DEFAULT ''::text,
    is_followup_completed integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp without time zone,
    updated_by text DEFAULT ''::text,
    CONSTRAINT chk_crm_activities_activity_date_datefmt CHECK (erp_date_text_ok(activity_date, 'iso'::text)),
    CONSTRAINT chk_crm_activities_activity_date_iso_datefmt CHECK (erp_date_text_ok(activity_date_iso, 'iso'::text)),
    CONSTRAINT chk_crm_activities_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_crm_activities_is_followup_completed_flag CHECK ((is_followup_completed = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_crm_activities_next_followup_date_datefmt CHECK (erp_date_text_ok(next_followup_date, 'iso'::text)),
    CONSTRAINT chk_crm_activities_next_followup_date_iso_datefmt CHECK (erp_date_text_ok(next_followup_date_iso, 'iso'::text))
);
--> statement-breakpoint
CREATE SEQUENCE crm_activities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE crm_activities_id_seq OWNED BY crm_activities.id;
--> statement-breakpoint
CREATE TABLE crm_lead_stage_history (
    id integer NOT NULL,
    lead_id integer NOT NULL,
    from_stage text,
    to_stage text NOT NULL,
    lost_reason text DEFAULT ''::text NOT NULL,
    assigned_personnel_id integer,
    changed_by_id integer,
    changed_by_name text DEFAULT ''::text NOT NULL,
    changed_at timestamp without time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'live'::text NOT NULL,
    CONSTRAINT chk_crm_lead_stage_history_source CHECK ((source = ANY (ARRAY['live'::text, 'backfill'::text, 'backfill_estimated'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE crm_lead_stage_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE crm_lead_stage_history_id_seq OWNED BY crm_lead_stage_history.id;
--> statement-breakpoint
CREATE TABLE crm_leads (
    id integer NOT NULL,
    title text NOT NULL,
    customer_id integer,
    customer_name text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    company text DEFAULT ''::text,
    source text DEFAULT 'تماس تلفنی'::text,
    stage text DEFAULT 'lead'::text,
    estimated_value numeric(18,4) DEFAULT 0,
    currency text DEFAULT 'IRR'::text,
    probability integer DEFAULT 50,
    assigned_to text DEFAULT ''::text,
    assigned_personnel_id integer,
    expected_close_date text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    status text DEFAULT 'active'::text,
    contacts jsonb DEFAULT '[]'::jsonb,
    has_proforma integer DEFAULT 0,
    proforma_id integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    created_by text DEFAULT ''::text,
    is_deleted integer DEFAULT 0,
    lost_reason text DEFAULT ''::text,
    lost_reason_note text DEFAULT ''::text,
    CONSTRAINT chk_crm_leads_expected_close_date_datefmt CHECK (erp_date_text_ok(expected_close_date, 'iso'::text)),
    CONSTRAINT chk_crm_leads_has_proforma_flag CHECK ((has_proforma = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_crm_leads_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_crm_leads_lost_reason CHECK (((lost_reason IS NULL) OR (lost_reason = ANY (ARRAY[''::text, 'price'::text, 'quality'::text, 'delivery'::text, 'competitor'::text, 'no_response'::text, 'other'::text]))))
);
--> statement-breakpoint
CREATE SEQUENCE crm_leads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE crm_leads_id_seq OWNED BY crm_leads.id;
--> statement-breakpoint
CREATE TABLE customer_tag_links (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    tag_id integer NOT NULL,
    created_by_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE customer_tag_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE customer_tag_links_id_seq OWNED BY customer_tag_links.id;
--> statement-breakpoint
CREATE TABLE customer_tags (
    id integer NOT NULL,
    name text NOT NULL,
    color text DEFAULT 'slate'::text NOT NULL,
    created_by_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_customer_tags_color CHECK ((color = ANY (ARRAY['slate'::text, 'blue'::text, 'emerald'::text, 'amber'::text, 'rose'::text, 'purple'::text, 'cyan'::text]))),
    CONSTRAINT chk_customer_tags_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE customer_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE customer_tags_id_seq OWNED BY customer_tags.id;
--> statement-breakpoint
CREATE TABLE customers (
    id integer NOT NULL,
    name text NOT NULL,
    contact_name text DEFAULT ''::text,
    country text DEFAULT 'ایران'::text,
    province text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    city text DEFAULT ''::text,
    address text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    party_type text DEFAULT 'customer'::text,
    supplier_category text DEFAULT ''::text,
    bank_info jsonb DEFAULT '{}'::jsonb,
    contacts jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    website text DEFAULT ''::text,
    email text DEFAULT ''::text,
    instagram text DEFAULT ''::text,
    CONSTRAINT chk_customers_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE customers_id_seq OWNED BY customers.id;
--> statement-breakpoint
CREATE TABLE daily_log_visibility_repairs (
    id integer NOT NULL,
    daily_log_id integer NOT NULL,
    old_visibility text,
    new_visibility text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE daily_log_visibility_repairs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE daily_log_visibility_repairs_id_seq OWNED BY daily_log_visibility_repairs.id;
--> statement-breakpoint
CREATE TABLE daily_work_logs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    username text NOT NULL,
    user_full_name text DEFAULT ''::text,
    date text NOT NULL,
    date_iso text DEFAULT ''::text,
    start_time text DEFAULT '08:00'::text,
    end_time text DEFAULT '17:00'::text,
    work_hours numeric(18,4) DEFAULT 8,
    work_mode text DEFAULT 'onsite'::text,
    title text NOT NULL,
    content text NOT NULL,
    project_id integer,
    project_name text DEFAULT ''::text,
    tags jsonb DEFAULT '[]'::jsonb,
    mentions jsonb DEFAULT '[]'::jsonb,
    visibility text DEFAULT 'mentioned_only'::text NOT NULL,
    allowed_users jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'submitted'::text,
    manager_notes text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT chk_daily_work_logs_date_datefmt CHECK (erp_date_text_ok(date, 'iso'::text)),
    CONSTRAINT chk_daily_work_logs_date_iso_datefmt CHECK (erp_date_text_ok(date_iso, 'iso'::text)),
    CONSTRAINT chk_daily_work_logs_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_daily_work_logs_visibility CHECK ((visibility = ANY (ARRAY['mentioned_only'::text, 'private'::text, 'managers'::text, 'custom'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE daily_work_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE daily_work_logs_id_seq OWNED BY daily_work_logs.id;
--> statement-breakpoint
CREATE TABLE dead_letter_events (
    id integer NOT NULL,
    original_event_id text NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    source text DEFAULT 'outbox'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    failure_reason text NOT NULL,
    error_stack text DEFAULT ''::text,
    retry_count integer DEFAULT 0,
    status text DEFAULT 'quarantined'::text NOT NULL,
    quarantined_at timestamp without time zone DEFAULT now(),
    resolved_at timestamp without time zone,
    resolved_by integer,
    resolution_notes text DEFAULT ''::text
);
--> statement-breakpoint
CREATE SEQUENCE dead_letter_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE dead_letter_events_id_seq OWNED BY dead_letter_events.id;
--> statement-breakpoint
CREATE TABLE document_items (
    id integer NOT NULL,
    document_id integer NOT NULL,
    item_id integer NOT NULL,
    quantity numeric(18,4) NOT NULL,
    unit_price numeric(18,4) DEFAULT 0,
    discount numeric(18,4) DEFAULT 0,
    location text DEFAULT 'main'::text,
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_document_items_discount CHECK (((COALESCE(is_deleted, 0) = 1) OR (COALESCE(discount, (0)::numeric) >= (0)::numeric))),
    CONSTRAINT chk_document_items_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_document_items_quantity CHECK (((COALESCE(is_deleted, 0) = 1) OR (quantity >= (0)::numeric))),
    CONSTRAINT chk_document_items_unit_price CHECK (((COALESCE(is_deleted, 0) = 1) OR (COALESCE(unit_price, (0)::numeric) >= (0)::numeric)))
);
--> statement-breakpoint
CREATE SEQUENCE document_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE document_items_id_seq OWNED BY document_items.id;
--> statement-breakpoint
CREATE TABLE document_ref_counters (
    doc_type character varying(20) NOT NULL,
    fiscal_year integer NOT NULL,
    last_ref_number integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE documents (
    id integer NOT NULL,
    type text NOT NULL,
    ref_number text NOT NULL,
    date timestamp without time zone NOT NULL,
    crm_lead_id integer,
    "user" text,
    notes text,
    buyer_name text DEFAULT ''::text,
    buyer_city text DEFAULT ''::text,
    buyer_phone text DEFAULT ''::text,
    buyer_address text DEFAULT ''::text,
    status text DEFAULT 'final'::text,
    currency text DEFAULT 'IRR'::text,
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    deleted_at timestamp without time zone,
    deleted_by text,
    project_id integer,
    attachments jsonb DEFAULT '[]'::jsonb,
    ref_fiscal_year integer,
    vat_percent numeric(5,2) DEFAULT 0 NOT NULL,
    vat_amount numeric(18,4) DEFAULT 0 NOT NULL,
    exchange_rate numeric(18,4),
    return_of_document_id integer,
    service_charge_amount numeric(18,4) DEFAULT 0 NOT NULL,
    party_id integer,
    procurement_requisition_id integer,
    recipient_personnel_id integer,
    CONSTRAINT chk_documents_date_gregorian CHECK (((date IS NULL) OR ((date)::text = ''::text) OR ((SUBSTRING(TRIM(BOTH FROM (date)::text) FROM 1 FOR 4) ~ '^[0-9]{4}$'::text) AND ((SUBSTRING(TRIM(BOTH FROM (date)::text) FROM 1 FOR 4))::integer >= 1900)))),
    CONSTRAINT chk_documents_exchange_rate_positive CHECK (((exchange_rate IS NULL) OR (exchange_rate > (0)::numeric))),
    CONSTRAINT chk_documents_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_documents_service_charge_amount_non_negative CHECK ((service_charge_amount >= (0)::numeric)),
    CONSTRAINT chk_documents_status CHECK (((COALESCE(is_deleted, 0) = 1) OR (COALESCE(status, ''::text) = ANY (ARRAY['draft'::text, 'proforma'::text, 'final'::text])))),
    CONSTRAINT chk_documents_type CHECK (((COALESCE(is_deleted, 0) = 1) OR (type = ANY (ARRAY['receipt'::text, 'purchase'::text, 'production_receipt'::text, 'return'::text, 'invoice'::text, 'proforma'::text, 'remittance'::text, 'waste'::text, 'audit'::text, 'transfer'::text])))),
    CONSTRAINT chk_documents_vat_amount_non_negative CHECK ((vat_amount >= (0)::numeric)),
    CONSTRAINT chk_documents_vat_percent_range CHECK (((vat_percent >= (0)::numeric) AND (vat_percent <= (100)::numeric)))
);
--> statement-breakpoint
CREATE SEQUENCE documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE documents_id_seq OWNED BY documents.id;
--> statement-breakpoint
CREATE TABLE event_action_logs (
    id integer NOT NULL,
    rule_id integer,
    rule_name text DEFAULT ''::text,
    event_id text NOT NULL,
    event_type text NOT NULL,
    action_type text NOT NULL,
    status text NOT NULL,
    result jsonb DEFAULT '{}'::jsonb,
    error_message text DEFAULT ''::text,
    execution_duration_ms integer DEFAULT 0,
    executed_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE event_action_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE event_action_logs_id_seq OWNED BY event_action_logs.id;
--> statement-breakpoint
CREATE TABLE event_action_rule_retirements (
    id integer NOT NULL,
    rule_id integer NOT NULL,
    rule_name text DEFAULT ''::text NOT NULL,
    action_type text NOT NULL,
    was_active integer NOT NULL,
    action_config jsonb,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_event_action_rule_retirements_was_active_flag CHECK ((was_active = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE event_action_rule_retirements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE event_action_rule_retirements_id_seq OWNED BY event_action_rule_retirements.id;
--> statement-breakpoint
CREATE TABLE event_action_rules (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    event_type text NOT NULL,
    conditions_json jsonb DEFAULT '[]'::jsonb,
    action_type text NOT NULL,
    action_config_json jsonb DEFAULT '{}'::jsonb,
    is_active integer DEFAULT 1,
    execution_count integer DEFAULT 0,
    last_executed_at timestamp without time zone,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_event_action_rules_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE event_action_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE event_action_rules_id_seq OWNED BY event_action_rules.id;
--> statement-breakpoint
CREATE TABLE file_attachments (
    id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    storage_path text NOT NULL,
    original_name text DEFAULT ''::text NOT NULL,
    mime_type text DEFAULT 'application/octet-stream'::text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    is_deleted integer DEFAULT 0 NOT NULL,
    light_storage_path text,
    CONSTRAINT chk_file_attachments_entity_type CHECK ((entity_type = ANY (ARRAY['document'::text, 'journal_voucher'::text, 'cheque'::text, 'treasury_transaction'::text, 'production_project'::text, 'piecework_payroll'::text, 'crm_lead'::text, 'crm_activity'::text]))),
    CONSTRAINT chk_file_attachments_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_file_attachments_size CHECK ((size_bytes >= 0))
);
--> statement-breakpoint
CREATE TABLE fiscal_periods (
    fiscal_year integer NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    closed_at timestamp without time zone,
    closed_by text,
    closing_voucher_id integer,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_fiscal_periods_status CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);
--> statement-breakpoint
CREATE TABLE form_drafts (
    id integer NOT NULL,
    user_id integer,
    username text DEFAULT ''::text,
    session_id text DEFAULT ''::text,
    entity_type text NOT NULL,
    draft_key text DEFAULT 'default'::text,
    payload jsonb NOT NULL,
    summary text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone,
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_form_drafts_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE form_drafts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE form_drafts_id_seq OWNED BY form_drafts.id;
--> statement-breakpoint
CREATE TABLE idempotency_keys (
    id integer NOT NULL,
    key text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    request_method text,
    request_path text,
    request_payload jsonb,
    response_status integer,
    response_body jsonb,
    created_by_id integer,
    locked_at timestamp without time zone,
    locked_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    expires_at timestamp without time zone
);
--> statement-breakpoint
CREATE SEQUENCE idempotency_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE idempotency_keys_id_seq OWNED BY idempotency_keys.id;
--> statement-breakpoint
CREATE TABLE integration_delivery_jobs (
    id integer NOT NULL,
    kind text NOT NULL,
    target_id integer NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    event jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    next_attempt_at timestamp without time zone DEFAULT now(),
    locked_at timestamp without time zone,
    last_error text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_integration_delivery_jobs_attempts CHECK (((attempts >= 0) AND (max_attempts >= 1))),
    CONSTRAINT chk_integration_delivery_jobs_kind CHECK ((kind = ANY (ARRAY['webhook'::text, 'rule_action'::text, 'messenger'::text]))),
    CONSTRAINT chk_integration_delivery_jobs_status CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE integration_delivery_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE integration_delivery_jobs_id_seq OWNED BY integration_delivery_jobs.id;
--> statement-breakpoint
CREATE TABLE inventory_reconciliation_anomalies (
    id integer NOT NULL,
    run_id text NOT NULL,
    item_id integer NOT NULL,
    warehouse_id integer,
    warehouse_code text DEFAULT ''::text NOT NULL,
    kind text NOT NULL,
    ledger_qty numeric(18,4),
    before_qty numeric(18,4),
    after_qty numeric(18,4),
    details text DEFAULT ''::text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE inventory_reconciliation_anomalies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE inventory_reconciliation_anomalies_id_seq OWNED BY inventory_reconciliation_anomalies.id;
--> statement-breakpoint
CREATE TABLE item_code_counters (
    scope character varying(20) NOT NULL,
    prefix_key character varying(60) NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE item_code_history (
    id integer NOT NULL,
    item_id integer NOT NULL,
    old_code text NOT NULL,
    new_code text NOT NULL,
    reason text NOT NULL,
    user_id integer,
    username text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE item_code_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE item_code_history_id_seq OWNED BY item_code_history.id;
--> statement-breakpoint
CREATE TABLE item_opening_voucher_items (
    voucher_id integer NOT NULL,
    item_id integer NOT NULL,
    amount numeric(18,4) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE item_price_title_cleanup (
    id integer NOT NULL,
    item_price_id integer NOT NULL,
    item_id integer NOT NULL,
    title text NOT NULL,
    price numeric(18,4) NOT NULL,
    currency text,
    reason text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE item_price_title_cleanup_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE item_price_title_cleanup_id_seq OWNED BY item_price_title_cleanup.id;
--> statement-breakpoint
CREATE TABLE item_prices (
    id integer NOT NULL,
    item_id integer NOT NULL,
    title text NOT NULL,
    price numeric(18,4) NOT NULL,
    currency text DEFAULT 'IRR'::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_item_prices_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE item_prices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE item_prices_id_seq OWNED BY item_prices.id;
--> statement-breakpoint
CREATE TABLE item_warehouse_stocks (
    id integer NOT NULL,
    item_id integer NOT NULL,
    warehouse_id integer NOT NULL,
    warehouse_code text NOT NULL,
    current_stock numeric(18,4) DEFAULT 0 NOT NULL,
    reserved_stock numeric(18,4) DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_iws_current_stock_non_negative CHECK ((current_stock >= (0)::numeric))
);
--> statement-breakpoint
CREATE SEQUENCE item_warehouse_stocks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE item_warehouse_stocks_id_seq OWNED BY item_warehouse_stocks.id;
--> statement-breakpoint
CREATE TABLE items (
    id integer NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    current_stock numeric(18,4) DEFAULT 0,
    unit text NOT NULL,
    category text DEFAULT ''::text,
    image text DEFAULT ''::text,
    thumbnail text DEFAULT ''::text,
    reorder_point numeric(18,4) DEFAULT 0,
    weighted_average_cost numeric(18,4) DEFAULT 0,
    color text,
    weight numeric(18,4),
    material text,
    size text,
    last_kardex_rebuild_at timestamp without time zone,
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    collections text[] DEFAULT '{}'::text[] NOT NULL,
    design_year integer,
    transfer_code text,
    product_description text,
    technical_notes text,
    CONSTRAINT chk_items_collections_count CHECK ((cardinality(collections) <= 20)),
    CONSTRAINT chk_items_design_year CHECK (((design_year IS NULL) OR ((design_year >= 1300) AND (design_year <= 1500)))),
    CONSTRAINT chk_items_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_items_wac_nonneg CHECK ((weighted_average_cost >= (0)::numeric))
);
--> statement-breakpoint
CREATE SEQUENCE items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE items_id_seq OWNED BY items.id;
--> statement-breakpoint
CREATE TABLE items_stocks_archive (
    item_id integer NOT NULL,
    stocks jsonb,
    current_stock numeric(18,4),
    archived_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE journal_voucher_items (
    id integer NOT NULL,
    voucher_id integer NOT NULL,
    account_id integer NOT NULL,
    row_order integer DEFAULT 1,
    detailed_type text DEFAULT 'none'::text,
    detailed_id integer,
    detailed_name text DEFAULT ''::text,
    debit numeric(18,4) DEFAULT 0 NOT NULL,
    credit numeric(18,4) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'IRR'::text,
    exchange_rate numeric(18,4) DEFAULT 1,
    description text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_journal_voucher_items_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_jvi_amount_present CHECK (((is_deleted = 1) OR (debit <> (0)::numeric) OR (credit <> (0)::numeric))),
    CONSTRAINT chk_jvi_amounts_non_negative CHECK (((is_deleted = 1) OR ((debit >= (0)::numeric) AND (credit >= (0)::numeric))))
);
--> statement-breakpoint
CREATE SEQUENCE journal_voucher_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE journal_voucher_items_id_seq OWNED BY journal_voucher_items.id;
--> statement-breakpoint
CREATE SEQUENCE journal_voucher_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE TABLE journal_vouchers (
    id integer NOT NULL,
    voucher_number integer NOT NULL,
    manual_voucher_number text DEFAULT ''::text,
    date text NOT NULL,
    voucher_type text DEFAULT 'general'::text,
    status text DEFAULT 'approved'::text,
    total_debit numeric(18,4) DEFAULT 0 NOT NULL,
    total_credit numeric(18,4) DEFAULT 0 NOT NULL,
    description text NOT NULL,
    reference_module text DEFAULT 'manual'::text,
    reference_id integer,
    reference_number text DEFAULT ''::text,
    currency text DEFAULT 'IRR'::text,
    created_by_id integer,
    created_by_username text DEFAULT ''::text,
    approved_by_id integer,
    created_at timestamp without time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    attachments jsonb DEFAULT '[]'::jsonb,
    source_document_id integer,
    source_payroll_id integer,
    source_cheque_id integer,
    source_bom_allocation_id integer,
    source_fiscal_year integer,
    updated_by_id integer,
    CONSTRAINT chk_journal_vouchers_date_datefmt CHECK (erp_date_text_ok(date, 'iso'::text)),
    CONSTRAINT chk_journal_vouchers_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_jv_status CHECK (((is_deleted = 1) OR (status = ANY (ARRAY['draft'::text, 'approved'::text, 'permanent'::text])))),
    CONSTRAINT chk_jv_voucher_type CHECK (((is_deleted = 1) OR (voucher_type = ANY (ARRAY['general'::text, 'opening'::text, 'closing'::text, 'sales'::text, 'purchase'::text, 'treasury'::text, 'payroll'::text, 'adjustment'::text, 'settlement'::text]))))
);
--> statement-breakpoint
CREATE SEQUENCE journal_vouchers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE journal_vouchers_id_seq OWNED BY journal_vouchers.id;
--> statement-breakpoint
CREATE TABLE legacy_date_repairs (
    id integer NOT NULL,
    table_name text NOT NULL,
    row_id integer NOT NULL,
    column_name text NOT NULL,
    old_value text NOT NULL,
    new_value text NOT NULL,
    status text NOT NULL,
    reason text,
    created_at timestamp without time zone DEFAULT now(),
    repair_kind text DEFAULT 'mdy'::text NOT NULL,
    CONSTRAINT chk_legacy_date_repairs_repair_kind CHECK ((repair_kind = ANY (ARRAY['mdy'::text, 'calendar'::text]))),
    CONSTRAINT chk_legacy_date_repairs_status CHECK ((status = ANY (ARRAY['corrected'::text, 'refused'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE legacy_date_repairs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE legacy_date_repairs_id_seq OWNED BY legacy_date_repairs.id;
--> statement-breakpoint
CREATE TABLE media_assets (
    id integer NOT NULL,
    section_id integer NOT NULL,
    item_id integer,
    kind text NOT NULL,
    shot_type text DEFAULT 'other'::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_cover integer DEFAULT 0 NOT NULL,
    original_name text DEFAULT ''::text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    sha256 text NOT NULL,
    width integer,
    height integer,
    duration_seconds numeric(10,2),
    is_low_quality integer DEFAULT 0 NOT NULL,
    light_bytes integer,
    thumb_bytes integer,
    light_error text DEFAULT ''::text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_by_user_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0 NOT NULL,
    deleted_at timestamp without time zone,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT chk_media_assets_is_cover_flag CHECK ((is_cover = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_media_assets_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_media_assets_is_low_quality_flag CHECK ((is_low_quality = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_media_assets_kind CHECK ((kind = ANY (ARRAY['image'::text, 'video'::text]))),
    CONSTRAINT chk_media_assets_sha256 CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT chk_media_assets_shot_type CHECK ((shot_type = ANY (ARRAY['white_background'::text, 'side'::text, 'detail'::text, 'on_model'::text, 'packaging'::text, 'video'::text, 'other'::text]))),
    CONSTRAINT chk_media_assets_size CHECK (((size_bytes > 0) AND (size_bytes <= 52428800))),
    CONSTRAINT chk_media_assets_tags_count CHECK ((cardinality(tags) <= 20))
);
--> statement-breakpoint
CREATE SEQUENCE media_assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE media_assets_id_seq OWNED BY media_assets.id;
--> statement-breakpoint
CREATE TABLE media_sections (
    id integer NOT NULL,
    kind text DEFAULT 'custom'::text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_media_sections_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_media_sections_kind CHECK ((kind = ANY (ARRAY['products'::text, 'custom'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE media_sections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE media_sections_id_seq OWNED BY media_sections.id;
--> statement-breakpoint
CREATE TABLE messenger_bots (
    messenger text NOT NULL,
    token text DEFAULT ''::text NOT NULL,
    bot_username text DEFAULT ''::text NOT NULL,
    updated_by_id integer,
    updated_at timestamp without time zone DEFAULT now(),
    update_offset bigint DEFAULT 0 NOT NULL,
    wrong_codes_count integer DEFAULT 0 NOT NULL,
    wrong_codes_since timestamp without time zone,
    CONSTRAINT chk_messenger_bots_messenger CHECK ((messenger = ANY (ARRAY['bale'::text, 'telegram'::text])))
);
--> statement-breakpoint
CREATE TABLE messenger_link_codes (
    id integer NOT NULL,
    user_id integer NOT NULL,
    messenger text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_messenger_link_codes_messenger CHECK ((messenger = ANY (ARRAY['bale'::text, 'telegram'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE messenger_link_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE messenger_link_codes_id_seq OWNED BY messenger_link_codes.id;
--> statement-breakpoint
CREATE TABLE migrations_log (
    id integer NOT NULL,
    name text NOT NULL,
    applied_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE migrations_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE migrations_log_id_seq OWNED BY migrations_log.id;
--> statement-breakpoint
CREATE TABLE notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    sender_id integer,
    sender_name text DEFAULT ''::text,
    type text DEFAULT 'mention'::text,
    title text NOT NULL,
    message text NOT NULL,
    link text DEFAULT ''::text,
    is_read integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    dismissed_at timestamp without time zone,
    CONSTRAINT chk_notifications_is_read_flag CHECK ((is_read = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE notifications_id_seq OWNED BY notifications.id;
--> statement-breakpoint
CREATE TABLE outbox_events (
    id integer NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    retry_count integer DEFAULT 0,
    next_retry_at timestamp without time zone,
    last_error text DEFAULT ''::text,
    occurred_at timestamp without time zone DEFAULT now(),
    processed_at timestamp without time zone,
    locked_at timestamp without time zone,
    locked_by text DEFAULT ''::text,
    completed_handlers jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE outbox_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE outbox_events_id_seq OWNED BY outbox_events.id;
--> statement-breakpoint
CREATE TABLE payroll_eidi_rates (
    id integer NOT NULL,
    jalali_year integer NOT NULL,
    method text DEFAULT 'percent_of_work'::text NOT NULL,
    percent numeric(7,4) DEFAULT 0 NOT NULL,
    yearly_cap numeric(18,4) DEFAULT 0 NOT NULL,
    labor_days numeric(7,2) DEFAULT 0 NOT NULL,
    labor_cap_days numeric(7,2) DEFAULT 0 NOT NULL,
    min_daily_wage numeric(18,4) DEFAULT 0 NOT NULL,
    fixed_amount numeric(18,4) DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_payroll_eidi_rates_method CHECK ((method = ANY (ARRAY['percent_of_work'::text, 'labor_law'::text, 'fixed_amount'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE payroll_eidi_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE payroll_eidi_rates_id_seq OWNED BY payroll_eidi_rates.id;
--> statement-breakpoint
CREATE TABLE payroll_statutory_rates (
    id integer NOT NULL,
    jalali_year integer NOT NULL,
    employee_insurance_percent numeric(7,4) DEFAULT 0 NOT NULL,
    employer_insurance_percent numeric(7,4) DEFAULT 0 NOT NULL,
    insurance_wage_cap numeric(18,4) DEFAULT 0 NOT NULL,
    tax_brackets jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_insurance_deducted_from_tax integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_payroll_statutory_rates_is_insurance_deducted_from_tax_flag CHECK ((is_insurance_deducted_from_tax = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE payroll_statutory_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE payroll_statutory_rates_id_seq OWNED BY payroll_statutory_rates.id;
--> statement-breakpoint
CREATE TABLE pending_materials (
    id integer NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    category text DEFAULT ''::text,
    type text DEFAULT 'raw_material'::text,
    project_id integer,
    project_title text DEFAULT ''::text,
    requested_by text DEFAULT ''::text,
    status text DEFAULT 'pending'::text,
    reorder_point numeric(18,4) DEFAULT 0,
    weighted_average_cost numeric(18,4) DEFAULT 0,
    color text DEFAULT ''::text,
    weight numeric(18,4) DEFAULT 0,
    material text DEFAULT ''::text,
    size text DEFAULT ''::text,
    image text DEFAULT ''::text,
    thumbnail text DEFAULT ''::text,
    rejection_reason text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    item_id integer,
    CONSTRAINT chk_pending_materials_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE pending_materials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE pending_materials_id_seq OWNED BY pending_materials.id;
--> statement-breakpoint
CREATE TABLE personnel (
    id integer NOT NULL,
    first_name text DEFAULT ''::text,
    last_name text DEFAULT ''::text,
    full_name text NOT NULL,
    personnel_code text DEFAULT ''::text,
    user_id integer,
    gender text DEFAULT 'مرد'::text,
    birth_date text DEFAULT ''::text,
    nationality text DEFAULT 'ایرانی'::text,
    national_id text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    employment_status text DEFAULT 'فعال'::text,
    salary_type text DEFAULT 'none'::text,
    monthly_salary numeric(18,4) DEFAULT 0,
    job_title text DEFAULT ''::text,
    education text DEFAULT ''::text,
    end_date text DEFAULT ''::text,
    termination_reason text DEFAULT ''::text,
    specialized_skills text DEFAULT ''::text,
    other_skills text DEFAULT ''::text,
    referral_source text DEFAULT ''::text,
    card_number text DEFAULT ''::text,
    account_number text DEFAULT ''::text,
    sheba_number text DEFAULT ''::text,
    bank_name text DEFAULT ''::text,
    nobitex_username text DEFAULT ''::text,
    nobitex_password text DEFAULT ''::text,
    address text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    version integer DEFAULT 1 NOT NULL,
    start_date text DEFAULT ''::text,
    is_insurance_covered integer DEFAULT 0 NOT NULL,
    is_tax_covered integer DEFAULT 0 NOT NULL,
    is_eidi_covered integer DEFAULT 1 NOT NULL,
    is_birthday_visible integer DEFAULT 1 NOT NULL,
    CONSTRAINT chk_personnel_birth_date_datefmt CHECK (erp_date_text_ok(birth_date, 'iso'::text)),
    CONSTRAINT chk_personnel_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'iso'::text)),
    CONSTRAINT chk_personnel_is_birthday_visible_flag CHECK ((is_birthday_visible = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_personnel_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_personnel_is_eidi_covered_flag CHECK ((is_eidi_covered = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_personnel_is_insurance_covered_flag CHECK ((is_insurance_covered = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_personnel_is_tax_covered_flag CHECK ((is_tax_covered = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_personnel_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'iso'::text))
);
--> statement-breakpoint
CREATE SEQUENCE personnel_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE personnel_id_seq OWNED BY personnel.id;
--> statement-breakpoint
CREATE TABLE petty_cash_expense_lines (
    id integer NOT NULL,
    treasury_transaction_id integer NOT NULL,
    line_no integer NOT NULL,
    account_id integer NOT NULL,
    amount numeric(18,4) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    seller_name text DEFAULT ''::text NOT NULL,
    invoice_number text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_petty_cash_expense_lines_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_petty_cash_expense_lines_line_no CHECK ((line_no >= 1))
);
--> statement-breakpoint
CREATE SEQUENCE petty_cash_expense_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE petty_cash_expense_lines_id_seq OWNED BY petty_cash_expense_lines.id;
--> statement-breakpoint
CREATE TABLE piecework_logs (
    id integer NOT NULL,
    personnel_id integer NOT NULL,
    task_id integer NOT NULL,
    project_id integer,
    date text NOT NULL,
    date_iso text DEFAULT ''::text,
    quantity numeric(18,4) NOT NULL,
    unit_rate numeric(18,4) NOT NULL,
    total_amount numeric(18,4) NOT NULL,
    notes text DEFAULT ''::text,
    payroll_id integer,
    status text DEFAULT 'pending'::text,
    created_by_id integer,
    created_by_username text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_piecework_logs_date_datefmt CHECK (erp_date_text_ok(date, 'iso'::text)),
    CONSTRAINT chk_piecework_logs_date_iso_datefmt CHECK (erp_date_text_ok(date_iso, 'iso'::text)),
    CONSTRAINT chk_piecework_logs_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE piecework_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE piecework_logs_id_seq OWNED BY piecework_logs.id;
--> statement-breakpoint
CREATE SEQUENCE piecework_payroll_number_seq
    START WITH 1001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE TABLE piecework_payrolls (
    id integer NOT NULL,
    payroll_number text NOT NULL,
    personnel_id integer NOT NULL,
    start_date text NOT NULL,
    end_date text NOT NULL,
    title text NOT NULL,
    total_piecework_amount numeric(18,4) DEFAULT 0 NOT NULL,
    total_bonuses numeric(18,4) DEFAULT 0,
    total_deductions numeric(18,4) DEFAULT 0,
    net_payable numeric(18,4) NOT NULL,
    total_fixed_amount numeric(18,4) DEFAULT 0,
    advance_deduction numeric(18,4) DEFAULT 0,
    status text DEFAULT 'draft'::text,
    payment_date text DEFAULT ''::text,
    payment_method text DEFAULT ''::text,
    payment_reference text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    created_by_id integer,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    attachments jsonb DEFAULT '[]'::jsonb,
    paid_amount numeric(18,4) DEFAULT 0,
    fixed_salary_months jsonb DEFAULT '[]'::jsonb NOT NULL,
    deductions_description text DEFAULT ''::text NOT NULL,
    is_prepayment integer DEFAULT 0 NOT NULL,
    prepayment_reason text DEFAULT ''::text NOT NULL,
    employee_insurance numeric(18,4) DEFAULT 0 NOT NULL,
    employer_insurance numeric(18,4) DEFAULT 0 NOT NULL,
    income_tax numeric(18,4) DEFAULT 0 NOT NULL,
    statutory_override_reason text DEFAULT ''::text NOT NULL,
    is_statutory_split integer DEFAULT 1 NOT NULL,
    eidi_amount numeric(18,4) DEFAULT 0 NOT NULL,
    eidi_from_accrual numeric(18,4) DEFAULT 0 NOT NULL,
    eidi_year integer,
    is_eidi integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_piecework_payrolls_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'iso'::text)),
    CONSTRAINT chk_piecework_payrolls_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_piecework_payrolls_is_eidi_flag CHECK ((is_eidi = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_piecework_payrolls_is_prepayment_flag CHECK ((is_prepayment = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_piecework_payrolls_is_statutory_split_flag CHECK ((is_statutory_split = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_piecework_payrolls_payment_date_datefmt CHECK (erp_date_text_ok(payment_date, 'iso'::text)),
    CONSTRAINT chk_piecework_payrolls_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'iso'::text))
);
--> statement-breakpoint
CREATE SEQUENCE piecework_payrolls_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE piecework_payrolls_id_seq OWNED BY piecework_payrolls.id;
--> statement-breakpoint
CREATE TABLE piecework_personnel_rates (
    id integer NOT NULL,
    personnel_id integer NOT NULL,
    task_id integer NOT NULL,
    custom_rate numeric(18,4) NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_piecework_personnel_rates_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE piecework_personnel_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE piecework_personnel_rates_id_seq OWNED BY piecework_personnel_rates.id;
--> statement-breakpoint
CREATE SEQUENCE piecework_task_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE TABLE piecework_task_rate_history (
    id integer NOT NULL,
    task_id integer NOT NULL,
    task_code text DEFAULT ''::text,
    task_title text DEFAULT ''::text,
    old_rate numeric(18,4) DEFAULT 0,
    new_rate numeric(18,4) NOT NULL,
    change_type text DEFAULT 'rate_change'::text,
    reason text DEFAULT ''::text,
    changed_by_user_id integer,
    changed_by_username text DEFAULT ''::text,
    effective_date text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    personnel_id integer,
    CONSTRAINT chk_piecework_task_rate_history_effective_date_datefmt CHECK (erp_date_text_ok(effective_date, 'iso'::text))
);
--> statement-breakpoint
CREATE SEQUENCE piecework_task_rate_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE piecework_task_rate_history_id_seq OWNED BY piecework_task_rate_history.id;
--> statement-breakpoint
CREATE TABLE piecework_tasks (
    id integer NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    category text DEFAULT 'سایر'::text,
    default_rate numeric(18,4) DEFAULT 0,
    unit text DEFAULT 'عدد'::text,
    description text DEFAULT ''::text,
    is_active integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_piecework_tasks_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_piecework_tasks_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE piecework_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE piecework_tasks_id_seq OWNED BY piecework_tasks.id;
--> statement-breakpoint
CREATE TABLE production_projects (
    id integer NOT NULL,
    project_code text NOT NULL,
    title text NOT NULL,
    customer_id integer,
    customer_name text DEFAULT ''::text,
    item_id integer,
    item_code text DEFAULT ''::text,
    item_name text DEFAULT ''::text,
    quantity numeric(18,4) DEFAULT 1 NOT NULL,
    unit text DEFAULT 'عدد'::text,
    start_date text DEFAULT ''::text,
    end_date text DEFAULT ''::text,
    status text DEFAULT 'planned'::text,
    priority text DEFAULT 'medium'::text,
    description text DEFAULT ''::text,
    products jsonb DEFAULT '[]'::jsonb,
    inventory_control jsonb DEFAULT '{}'::jsonb,
    stage_schedules jsonb DEFAULT '{}'::jsonb,
    custom_stages jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    created_by text DEFAULT ''::text,
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    attachments jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT chk_pp_inv_control_object CHECK (((inventory_control IS NULL) OR (jsonb_typeof(inventory_control) = 'object'::text))),
    CONSTRAINT chk_production_projects_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'iso'::text)),
    CONSTRAINT chk_production_projects_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_production_projects_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'iso'::text))
);
--> statement-breakpoint
CREATE SEQUENCE production_projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE production_projects_id_seq OWNED BY production_projects.id;
--> statement-breakpoint
CREATE TABLE project_bom_allocations (
    id integer NOT NULL,
    project_id integer NOT NULL,
    project_code text NOT NULL,
    item_id integer NOT NULL,
    item_code text NOT NULL,
    item_name text NOT NULL,
    quantity numeric(18,4) NOT NULL,
    unit text DEFAULT 'عدد'::text,
    source_transaction_id integer,
    source_location text DEFAULT 'main'::text,
    status text DEFAULT 'allocated'::text NOT NULL,
    user_id integer,
    username text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    allocated_at timestamp without time zone DEFAULT now(),
    consumed_at timestamp without time zone,
    released_at timestamp without time zone,
    is_deleted integer DEFAULT 0,
    recipient_personnel_id integer,
    CONSTRAINT chk_project_bom_allocations_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE project_bom_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE project_bom_allocations_id_seq OWNED BY project_bom_allocations.id;
--> statement-breakpoint
CREATE TABLE project_managers (
    id integer NOT NULL,
    project_id integer NOT NULL,
    user_id integer NOT NULL,
    created_by_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE project_managers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE project_managers_id_seq OWNED BY project_managers.id;
--> statement-breakpoint
CREATE TABLE project_product_stage_progress (
    id integer NOT NULL,
    project_id integer NOT NULL,
    item_id integer NOT NULL,
    item_code text DEFAULT ''::text NOT NULL,
    item_name text DEFAULT ''::text,
    quantity numeric(18,4) DEFAULT 0 NOT NULL,
    stage_order integer NOT NULL,
    stage_title text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    updated_at text DEFAULT ''::text,
    updated_by_name text DEFAULT ''::text,
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_project_product_stage_progress_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE project_product_stage_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE project_product_stage_progress_id_seq OWNED BY project_product_stage_progress.id;
--> statement-breakpoint
CREATE TABLE project_reservation_releases (
    id integer NOT NULL,
    document_id integer,
    project_id integer NOT NULL,
    item_id integer,
    qty_field text NOT NULL,
    quantity numeric(18,4) NOT NULL,
    reservation_row jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    restored_at timestamp without time zone,
    bom_allocation_id integer,
    CONSTRAINT chk_project_reservation_releases_source CHECK ((num_nonnulls(document_id, bom_allocation_id) = 1)),
    CONSTRAINT chk_prr_qty_field CHECK ((qty_field = ANY (ARRAY['convertedReservedQty'::text, 'convertedQty'::text, 'reservedQty'::text, 'warehouseStockQty'::text, 'stockQty'::text]))),
    CONSTRAINT chk_prr_quantity_positive CHECK ((quantity > (0)::numeric))
);
--> statement-breakpoint
CREATE SEQUENCE project_reservation_releases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE project_reservation_releases_id_seq OWNED BY project_reservation_releases.id;
--> statement-breakpoint
CREATE TABLE project_stages (
    id integer NOT NULL,
    project_id integer NOT NULL,
    stage_order integer DEFAULT 1 NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'pending'::text,
    start_date text DEFAULT ''::text,
    end_date text DEFAULT ''::text,
    assigned_personnel jsonb DEFAULT '[]'::jsonb,
    required_resources jsonb DEFAULT '[]'::jsonb,
    progress_percent integer DEFAULT 0,
    notes text DEFAULT ''::text,
    completed_at text DEFAULT ''::text,
    is_deleted integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_project_stages_completed_at_datefmt CHECK (erp_date_text_ok(completed_at, 'isots'::text)),
    CONSTRAINT chk_project_stages_end_date_datefmt CHECK (erp_date_text_ok(end_date, 'iso'::text)),
    CONSTRAINT chk_project_stages_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_project_stages_start_date_datefmt CHECK (erp_date_text_ok(start_date, 'iso'::text))
);
--> statement-breakpoint
CREATE SEQUENCE project_stages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE project_stages_id_seq OWNED BY project_stages.id;
--> statement-breakpoint
CREATE TABLE purchase_requisitions (
    id integer NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    project_id integer,
    project_code text DEFAULT ''::text,
    project_name text DEFAULT ''::text,
    status text DEFAULT 'pending'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    required_date text DEFAULT ''::text,
    requested_by_id integer,
    requested_by_name text DEFAULT ''::text,
    assigned_to_id integer,
    assigned_to_name text DEFAULT ''::text,
    workflow_instance_id integer,
    notes text DEFAULT ''::text,
    total_estimated_amount numeric(18,2) DEFAULT 0,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_deleted integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    consolidated_into_id integer,
    CONSTRAINT chk_purchase_requisitions_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_purchase_requisitions_required_date_datefmt CHECK (erp_date_text_ok(required_date, 'iso'::text))
);
--> statement-breakpoint
CREATE SEQUENCE purchase_requisitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE purchase_requisitions_id_seq OWNED BY purchase_requisitions.id;
--> statement-breakpoint
CREATE TABLE ref_fiscal_year_corrections (
    id integer NOT NULL,
    document_id integer NOT NULL,
    doc_type text NOT NULL,
    ref_number text NOT NULL,
    document_date timestamp without time zone NOT NULL,
    old_fiscal_year integer NOT NULL,
    new_fiscal_year integer NOT NULL,
    status text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_ref_fy_corrections_status CHECK ((status = ANY (ARRAY['corrected'::text, 'conflict'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE ref_fiscal_year_corrections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE ref_fiscal_year_corrections_id_seq OWNED BY ref_fiscal_year_corrections.id;
--> statement-breakpoint
CREATE TABLE roles (
    id integer NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    description text DEFAULT ''::text,
    permissions jsonb DEFAULT '[]'::jsonb,
    is_system integer DEFAULT 0,
    CONSTRAINT chk_roles_is_system_flag CHECK ((is_system = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE roles_id_seq OWNED BY roles.id;
--> statement-breakpoint
CREATE TABLE statutory_remittance_lines (
    id integer NOT NULL,
    treasury_transaction_id integer NOT NULL,
    kind text NOT NULL,
    jalali_year integer NOT NULL,
    jalali_month integer NOT NULL,
    personnel_id integer NOT NULL,
    amount numeric(18,4) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_statutory_remittance_lines_amount CHECK ((amount > (0)::numeric)),
    CONSTRAINT chk_statutory_remittance_lines_kind CHECK ((kind = ANY (ARRAY['insurance'::text, 'tax'::text]))),
    CONSTRAINT chk_statutory_remittance_lines_month CHECK (((jalali_month >= 1) AND (jalali_month <= 12)))
);
--> statement-breakpoint
CREATE SEQUENCE statutory_remittance_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE statutory_remittance_lines_id_seq OWNED BY statutory_remittance_lines.id;
--> statement-breakpoint
CREATE TABLE stock_receipt_confirmations (
    id integer NOT NULL,
    document_id integer,
    bom_allocation_id integer,
    personnel_id integer NOT NULL,
    status text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    confirmed_by_id integer NOT NULL,
    confirmed_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_stock_receipt_confirmations_source CHECK ((num_nonnulls(document_id, bom_allocation_id) = 1)),
    CONSTRAINT chk_stock_receipt_confirmations_status CHECK ((status = ANY (ARRAY['received'::text, 'discrepancy'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE stock_receipt_confirmations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE stock_receipt_confirmations_id_seq OWNED BY stock_receipt_confirmations.id;
--> statement-breakpoint
CREATE TABLE task_categories (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    is_deleted integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_task_categories_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE task_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE task_categories_id_seq OWNED BY task_categories.id;
--> statement-breakpoint
CREATE TABLE transactions (
    id integer NOT NULL,
    item_id integer NOT NULL,
    document_id integer,
    type text NOT NULL,
    quantity numeric(18,4) NOT NULL,
    unit_price numeric(18,4) DEFAULT 0,
    total_price numeric(18,4) DEFAULT 0,
    date timestamp without time zone NOT NULL,
    document_type text,
    document_ref text,
    created_by text,
    notes text,
    location text DEFAULT 'main'::text,
    reversal_of_id integer,
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_transactions_date_gregorian CHECK (((date IS NULL) OR ((date)::text = ''::text) OR ((SUBSTRING(TRIM(BOTH FROM (date)::text) FROM 1 FOR 4) ~ '^[0-9]{4}$'::text) AND ((SUBSTRING(TRIM(BOTH FROM (date)::text) FROM 1 FOR 4))::integer >= 1900)))),
    CONSTRAINT chk_transactions_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE transactions_id_seq OWNED BY transactions.id;
--> statement-breakpoint
CREATE TABLE transfers (
    id integer NOT NULL,
    code text NOT NULL,
    title text DEFAULT ''::text,
    image text DEFAULT ''::text,
    thumbnail text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_deleted integer DEFAULT 0,
    CONSTRAINT chk_transfers_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE transfers_id_seq OWNED BY transfers.id;
--> statement-breakpoint
CREATE TABLE treasury_transactions (
    id integer NOT NULL,
    transaction_number text NOT NULL,
    type text NOT NULL,
    date text NOT NULL,
    method text NOT NULL,
    amount numeric(18,4) NOT NULL,
    currency text DEFAULT 'IRR'::text,
    exchange_rate numeric(18,4) DEFAULT 1,
    bank_account_id integer,
    party_type text DEFAULT 'customer'::text,
    party_id integer,
    party_name text NOT NULL,
    tracking_number text DEFAULT ''::text,
    voucher_id integer,
    cheque_id integer,
    document_id integer,
    payroll_id integer,
    reversal_of_id integer,
    description text DEFAULT ''::text,
    status text DEFAULT 'completed'::text,
    reconciled integer DEFAULT 0,
    reconciled_at text DEFAULT ''::text,
    reconciled_batch text DEFAULT ''::text,
    created_by_id integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL,
    is_deleted integer DEFAULT 0,
    attachments jsonb DEFAULT '[]'::jsonb,
    purpose text,
    contra_account_id integer,
    CONSTRAINT chk_treasury_transactions_date_datefmt CHECK (erp_date_text_ok(date, 'iso'::text)),
    CONSTRAINT chk_treasury_transactions_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_treasury_transactions_purpose CHECK (((purpose IS NULL) OR (purpose = ANY (ARRAY['settlement'::text, 'advance'::text, 'deductions'::text, 'other'::text])))),
    CONSTRAINT chk_treasury_transactions_reconciled_at_datefmt CHECK (erp_date_text_ok(reconciled_at, 'isots'::text)),
    CONSTRAINT chk_tt_amount_pos CHECK ((amount > (0)::numeric))
);
--> statement-breakpoint
CREATE SEQUENCE treasury_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE treasury_transactions_id_seq OWNED BY treasury_transactions.id;
--> statement-breakpoint
CREATE SEQUENCE treasury_tx_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE TABLE user_messenger_links (
    id integer NOT NULL,
    user_id integer NOT NULL,
    messenger text NOT NULL,
    chat_id text NOT NULL,
    chat_name text DEFAULT ''::text NOT NULL,
    is_active integer DEFAULT 1 NOT NULL,
    linked_at timestamp without time zone DEFAULT now(),
    unlinked_at timestamp without time zone,
    unlink_reason text DEFAULT ''::text NOT NULL,
    CONSTRAINT chk_user_messenger_links_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_user_messenger_links_messenger CHECK ((messenger = ANY (ARRAY['bale'::text, 'telegram'::text]))),
    CONSTRAINT chk_user_messenger_links_unlink_reason CHECK ((unlink_reason = ANY (ARRAY[''::text, 'user'::text, 'stop'::text, 'blocked'::text, 'relinked'::text, 'bot_changed'::text, 'user_deleted'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE user_messenger_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE user_messenger_links_id_seq OWNED BY user_messenger_links.id;
--> statement-breakpoint
CREATE TABLE user_notification_preferences (
    id integer NOT NULL,
    user_id integer NOT NULL,
    category text NOT NULL,
    send_to_messenger integer DEFAULT 1 NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_user_notification_preferences_category CHECK ((category = ANY (ARRAY['workflow_task'::text, 'workflow_sla'::text, 'payslip'::text, 'mention'::text, 'daily_log_review'::text, 'crm_followup'::text, 'crm_won'::text, 'event_rule'::text, 'workshop'::text, 'settings_change'::text]))),
    CONSTRAINT chk_user_notification_preferences_send_to_messenger_flag CHECK ((send_to_messenger = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE user_notification_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE user_notification_preferences_id_seq OWNED BY user_notification_preferences.id;
--> statement-breakpoint
CREATE TABLE user_sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    sid text NOT NULL,
    token_version integer DEFAULT 0 NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    ip_address text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    revoke_reason text DEFAULT ''::text NOT NULL,
    CONSTRAINT chk_user_sessions_revoke_reason CHECK ((revoke_reason = ANY (ARRAY[''::text, 'logout'::text, 'closed_by_user'::text, 'closed_by_admin'::text, 'others_closed'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE user_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE user_sessions_id_seq OWNED BY user_sessions.id;
--> statement-breakpoint
CREATE TABLE users (
    id integer NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    full_name text NOT NULL,
    role text,
    avatar_url text DEFAULT ''::text,
    must_reset_password integer DEFAULT 0,
    failed_login_count integer DEFAULT 0,
    locked_until text,
    token_version integer DEFAULT 0,
    is_deleted integer DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    last_failed_login_at text,
    is_presence_visible integer DEFAULT 1 NOT NULL,
    whats_new_seen_version text DEFAULT ''::text NOT NULL,
    CONSTRAINT chk_users_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_users_is_presence_visible_flag CHECK ((is_presence_visible = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_users_last_failed_login_at_datefmt CHECK (erp_date_text_ok(last_failed_login_at, 'isots'::text)),
    CONSTRAINT chk_users_role_active CHECK (((is_deleted = 1) OR (role IS NOT NULL)))
);
--> statement-breakpoint
CREATE SEQUENCE users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE users_id_seq OWNED BY users.id;
--> statement-breakpoint
CREATE TABLE warehouses (
    id integer NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    is_active integer DEFAULT 1,
    CONSTRAINT chk_warehouses_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE warehouses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE warehouses_id_seq OWNED BY warehouses.id;
--> statement-breakpoint
CREATE TABLE wc_product_links (
    id integer NOT NULL,
    item_id integer NOT NULL,
    wc_product_id integer NOT NULL,
    wc_variation_id integer DEFAULT 0 NOT NULL,
    site_sku text DEFAULT ''::text NOT NULL,
    site_stock integer,
    site_manage_stock integer DEFAULT 0 NOT NULL,
    last_read_at timestamp without time zone,
    last_pushed_at timestamp without time zone,
    last_error text DEFAULT ''::text NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    is_deleted integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    site_type text DEFAULT ''::text NOT NULL,
    site_regular_price text,
    price_error text DEFAULT ''::text NOT NULL,
    price_failure_count integer DEFAULT 0 NOT NULL,
    sku_error text DEFAULT ''::text NOT NULL,
    sku_failure_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_wc_product_links_failure_count CHECK ((failure_count >= 0)),
    CONSTRAINT chk_wc_product_links_field_failure_counts CHECK (((price_failure_count >= 0) AND (sku_failure_count >= 0))),
    CONSTRAINT chk_wc_product_links_ids CHECK (((wc_product_id > 0) AND (wc_variation_id >= 0))),
    CONSTRAINT chk_wc_product_links_is_deleted_flag CHECK ((is_deleted = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_wc_product_links_site_manage_stock_flag CHECK ((site_manage_stock = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE wc_product_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE wc_product_links_id_seq OWNED BY wc_product_links.id;
--> statement-breakpoint
CREATE TABLE wc_sync_runs (
    id integer NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    user_id integer,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    finished_at timestamp without time zone,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text DEFAULT ''::text NOT NULL,
    CONSTRAINT chk_wc_sync_runs_kind CHECK ((kind = ANY (ARRAY['refresh'::text, 'stock_push'::text, 'price_push'::text, 'sku_push'::text]))),
    CONSTRAINT chk_wc_sync_runs_status CHECK ((status = ANY (ARRAY['ok'::text, 'partial'::text, 'failed'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE wc_sync_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE wc_sync_runs_id_seq OWNED BY wc_sync_runs.id;
--> statement-breakpoint
CREATE TABLE webhook_deliveries (
    id integer NOT NULL,
    subscription_id integer NOT NULL,
    subscription_name text DEFAULT ''::text,
    event_id text NOT NULL,
    event_type text NOT NULL,
    target_url text NOT NULL,
    status_code integer DEFAULT 0,
    status text NOT NULL,
    response_body text DEFAULT ''::text,
    error_message text DEFAULT ''::text,
    signature text DEFAULT ''::text,
    attempt integer DEFAULT 1,
    duration_ms integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE webhook_deliveries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE webhook_deliveries_id_seq OWNED BY webhook_deliveries.id;
--> statement-breakpoint
CREATE TABLE webhook_event_pattern_repairs (
    id integer NOT NULL,
    subscription_id integer NOT NULL,
    subscription_name text DEFAULT ''::text NOT NULL,
    target_url text DEFAULT ''::text NOT NULL,
    old_patterns jsonb NOT NULL,
    new_patterns jsonb NOT NULL,
    dropped_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
    was_active integer NOT NULL,
    deactivated integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_webhook_event_pattern_repairs_deactivated_flag CHECK ((deactivated = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_webhook_event_pattern_repairs_was_active_flag CHECK ((was_active = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE webhook_event_pattern_repairs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE webhook_event_pattern_repairs_id_seq OWNED BY webhook_event_pattern_repairs.id;
--> statement-breakpoint
CREATE TABLE webhook_subscriptions (
    id integer NOT NULL,
    name text NOT NULL,
    target_url text NOT NULL,
    secret_key text NOT NULL,
    event_patterns jsonb DEFAULT '["*"]'::jsonb,
    custom_headers jsonb DEFAULT '{}'::jsonb,
    is_active integer DEFAULT 1,
    retry_limit integer DEFAULT 3,
    timeout_ms integer DEFAULT 5000,
    total_deliveries integer DEFAULT 0,
    successful_deliveries integer DEFAULT 0,
    failed_deliveries integer DEFAULT 0,
    last_delivery_at timestamp without time zone,
    last_status text DEFAULT 'idle'::text,
    last_error text DEFAULT ''::text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_webhook_subscriptions_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE webhook_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE webhook_subscriptions_id_seq OWNED BY webhook_subscriptions.id;
--> statement-breakpoint
CREATE TABLE woocommerce_order_logs (
    id integer NOT NULL,
    wc_order_id text NOT NULL,
    erp_document_id integer,
    status text NOT NULL,
    buyer_name text DEFAULT ''::text,
    total_amount numeric(15,2) DEFAULT '0'::numeric,
    payload jsonb,
    error_message text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE woocommerce_order_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE woocommerce_order_logs_id_seq OWNED BY woocommerce_order_logs.id;
--> statement-breakpoint
CREATE TABLE workflow_definition_versions (
    id integer NOT NULL,
    definition_id integer NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    dsl_json jsonb DEFAULT '{}'::jsonb,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    status text DEFAULT 'retired'::text NOT NULL,
    CONSTRAINT chk_workflow_definition_versions_status CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'retired'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE workflow_definition_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_definition_versions_id_seq OWNED BY workflow_definition_versions.id;
--> statement-breakpoint
CREATE TABLE workflow_definitions (
    id integer NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    entity_type text NOT NULL,
    version integer DEFAULT 1,
    is_active integer DEFAULT 1,
    description text DEFAULT ''::text,
    dsl_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    is_archived integer DEFAULT 0 NOT NULL,
    published_version integer,
    CONSTRAINT chk_workflow_definitions_archived_inactive CHECK (((is_archived = 0) OR (is_active = 0))),
    CONSTRAINT chk_workflow_definitions_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_workflow_definitions_is_archived_flag CHECK ((is_archived = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE workflow_definitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_definitions_id_seq OWNED BY workflow_definitions.id;
--> statement-breakpoint
CREATE TABLE workflow_delegations (
    id integer NOT NULL,
    from_user_id integer NOT NULL,
    to_user_id integer NOT NULL,
    scope text DEFAULT 'ALL'::text NOT NULL,
    start_date timestamp without time zone NOT NULL,
    end_date timestamp without time zone NOT NULL,
    is_active integer DEFAULT 1,
    reason text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_workflow_delegations_is_active_flag CHECK ((is_active = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE workflow_delegations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_delegations_id_seq OWNED BY workflow_delegations.id;
--> statement-breakpoint
CREATE TABLE workflow_history_logs (
    id integer NOT NULL,
    instance_id integer NOT NULL,
    from_state_id integer,
    to_state_id integer,
    transition_id integer,
    performed_by integer,
    performed_by_name text DEFAULT ''::text,
    action_key text NOT NULL,
    action_title text DEFAULT ''::text,
    comment text DEFAULT ''::text,
    snapshot_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE workflow_history_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_history_logs_id_seq OWNED BY workflow_history_logs.id;
--> statement-breakpoint
CREATE TABLE workflow_instances (
    id integer NOT NULL,
    workflow_definition_id integer NOT NULL,
    definition_version integer DEFAULT 1,
    snapshot_dsl jsonb DEFAULT '{}'::jsonb,
    approval_progress_json jsonb DEFAULT '{}'::jsonb,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    current_state_id integer NOT NULL,
    status text DEFAULT 'IN_PROGRESS'::text,
    started_by integer,
    started_by_name text DEFAULT ''::text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_wi_dsl_object CHECK (((snapshot_dsl IS NULL) OR (jsonb_typeof(snapshot_dsl) = 'object'::text)))
);
--> statement-breakpoint
CREATE SEQUENCE workflow_instances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_instances_id_seq OWNED BY workflow_instances.id;
--> statement-breakpoint
CREATE TABLE workflow_pending_approvals (
    id integer NOT NULL,
    instance_id integer NOT NULL,
    transition_id integer NOT NULL,
    assigned_role text DEFAULT ''::text,
    assigned_user_id integer,
    status text DEFAULT 'PENDING'::text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE workflow_pending_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_pending_approvals_id_seq OWNED BY workflow_pending_approvals.id;
--> statement-breakpoint
CREATE TABLE workflow_states (
    id integer NOT NULL,
    workflow_definition_id integer NOT NULL,
    state_key text NOT NULL,
    title text NOT NULL,
    state_type text DEFAULT 'intermediate'::text,
    color text DEFAULT 'gray'::text,
    step_order integer DEFAULT 0,
    sla_hours integer DEFAULT 24,
    position_x integer DEFAULT 100,
    position_y integer DEFAULT 100
);
--> statement-breakpoint
CREATE SEQUENCE workflow_states_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_states_id_seq OWNED BY workflow_states.id;
--> statement-breakpoint
CREATE TABLE workflow_task_reopen_log (
    id integer NOT NULL,
    task_id integer NOT NULL,
    instance_id integer NOT NULL,
    task_title text DEFAULT ''::text NOT NULL,
    due_at timestamp without time zone,
    action text NOT NULL,
    reason text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT chk_wtrl_action CHECK ((action = ANY (ARRAY['reopened'::text, 'kept_expired'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE workflow_task_reopen_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_task_reopen_log_id_seq OWNED BY workflow_task_reopen_log.id;
--> statement-breakpoint
CREATE TABLE workflow_tasks (
    id integer NOT NULL,
    instance_id integer NOT NULL,
    transition_id integer,
    assigned_user_id integer,
    assigned_role text DEFAULT ''::text,
    candidate_users jsonb DEFAULT '[]'::jsonb,
    candidate_roles jsonb DEFAULT '[]'::jsonb,
    delegated_to_user_id integer,
    status text DEFAULT 'pending'::text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text,
    due_at timestamp without time zone,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    sla_reminded_at timestamp without time zone
);
--> statement-breakpoint
CREATE SEQUENCE workflow_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_tasks_id_seq OWNED BY workflow_tasks.id;
--> statement-breakpoint
CREATE TABLE workflow_transitions (
    id integer NOT NULL,
    workflow_definition_id integer NOT NULL,
    from_state_id integer NOT NULL,
    to_state_id integer NOT NULL,
    action_key text NOT NULL,
    title text NOT NULL,
    required_role text DEFAULT ''::text,
    required_permission text DEFAULT ''::text,
    approval_rule_type text DEFAULT 'SINGLE'::text,
    k_value integer DEFAULT 1,
    rule_conditions_json jsonb DEFAULT '[]'::jsonb,
    auto_action_key text DEFAULT ''::text,
    is_initiator_excluded integer DEFAULT 0 NOT NULL,
    is_initiator_only integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_workflow_transitions_is_initiator_excluded_flag CHECK ((is_initiator_excluded = ANY (ARRAY[0, 1]))),
    CONSTRAINT chk_workflow_transitions_is_initiator_only_flag CHECK ((is_initiator_only = ANY (ARRAY[0, 1])))
);
--> statement-breakpoint
CREATE SEQUENCE workflow_transitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workflow_transitions_id_seq OWNED BY workflow_transitions.id;
--> statement-breakpoint
CREATE TABLE workshop_task_reports (
    id integer NOT NULL,
    project_id integer NOT NULL,
    stage_id integer NOT NULL,
    product_id text NOT NULL,
    row_id text NOT NULL,
    personnel_id integer NOT NULL,
    task_id integer,
    quantity numeric(18,4) NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    approved_quantity numeric(18,4),
    review_note text DEFAULT ''::text NOT NULL,
    reviewed_by_id integer,
    reviewed_at timestamp without time zone,
    piecework_log_id integer,
    created_by_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT chk_workshop_task_reports_approved_quantity CHECK (((approved_quantity IS NULL) OR (approved_quantity > (0)::numeric))),
    CONSTRAINT chk_workshop_task_reports_quantity CHECK ((quantity > (0)::numeric)),
    CONSTRAINT chk_workshop_task_reports_status CHECK ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE workshop_task_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE workshop_task_reports_id_seq OWNED BY workshop_task_reports.id;
--> statement-breakpoint
ALTER TABLE ONLY _repair_0011_timestamps_backup ALTER COLUMN id SET DEFAULT nextval('_repair_0011_timestamps_backup_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY accounting_settings ALTER COLUMN id SET DEFAULT nextval('accounting_settings_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY accounts ALTER COLUMN id SET DEFAULT nextval('accounts_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY activity_logs ALTER COLUMN id SET DEFAULT nextval('activity_logs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY bank_accounts ALTER COLUMN id SET DEFAULT nextval('bank_accounts_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY birthday_greetings ALTER COLUMN id SET DEFAULT nextval('birthday_greetings_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY categories ALTER COLUMN id SET DEFAULT nextval('categories_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY cheques ALTER COLUMN id SET DEFAULT nextval('cheques_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY crm_activities ALTER COLUMN id SET DEFAULT nextval('crm_activities_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY crm_lead_stage_history ALTER COLUMN id SET DEFAULT nextval('crm_lead_stage_history_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY crm_leads ALTER COLUMN id SET DEFAULT nextval('crm_leads_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY customer_tag_links ALTER COLUMN id SET DEFAULT nextval('customer_tag_links_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY customer_tags ALTER COLUMN id SET DEFAULT nextval('customer_tags_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY customers ALTER COLUMN id SET DEFAULT nextval('customers_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY daily_log_visibility_repairs ALTER COLUMN id SET DEFAULT nextval('daily_log_visibility_repairs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY daily_work_logs ALTER COLUMN id SET DEFAULT nextval('daily_work_logs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY dead_letter_events ALTER COLUMN id SET DEFAULT nextval('dead_letter_events_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY document_items ALTER COLUMN id SET DEFAULT nextval('document_items_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY documents ALTER COLUMN id SET DEFAULT nextval('documents_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY event_action_logs ALTER COLUMN id SET DEFAULT nextval('event_action_logs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY event_action_rule_retirements ALTER COLUMN id SET DEFAULT nextval('event_action_rule_retirements_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY event_action_rules ALTER COLUMN id SET DEFAULT nextval('event_action_rules_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY form_drafts ALTER COLUMN id SET DEFAULT nextval('form_drafts_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY idempotency_keys ALTER COLUMN id SET DEFAULT nextval('idempotency_keys_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY integration_delivery_jobs ALTER COLUMN id SET DEFAULT nextval('integration_delivery_jobs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY inventory_reconciliation_anomalies ALTER COLUMN id SET DEFAULT nextval('inventory_reconciliation_anomalies_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY item_code_history ALTER COLUMN id SET DEFAULT nextval('item_code_history_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY item_price_title_cleanup ALTER COLUMN id SET DEFAULT nextval('item_price_title_cleanup_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY item_prices ALTER COLUMN id SET DEFAULT nextval('item_prices_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY item_warehouse_stocks ALTER COLUMN id SET DEFAULT nextval('item_warehouse_stocks_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY items ALTER COLUMN id SET DEFAULT nextval('items_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY journal_voucher_items ALTER COLUMN id SET DEFAULT nextval('journal_voucher_items_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers ALTER COLUMN id SET DEFAULT nextval('journal_vouchers_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY legacy_date_repairs ALTER COLUMN id SET DEFAULT nextval('legacy_date_repairs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY media_assets ALTER COLUMN id SET DEFAULT nextval('media_assets_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY media_sections ALTER COLUMN id SET DEFAULT nextval('media_sections_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY messenger_link_codes ALTER COLUMN id SET DEFAULT nextval('messenger_link_codes_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY migrations_log ALTER COLUMN id SET DEFAULT nextval('migrations_log_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY notifications ALTER COLUMN id SET DEFAULT nextval('notifications_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY outbox_events ALTER COLUMN id SET DEFAULT nextval('outbox_events_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY payroll_eidi_rates ALTER COLUMN id SET DEFAULT nextval('payroll_eidi_rates_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY payroll_statutory_rates ALTER COLUMN id SET DEFAULT nextval('payroll_statutory_rates_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY pending_materials ALTER COLUMN id SET DEFAULT nextval('pending_materials_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY personnel ALTER COLUMN id SET DEFAULT nextval('personnel_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY petty_cash_expense_lines ALTER COLUMN id SET DEFAULT nextval('petty_cash_expense_lines_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY piecework_logs ALTER COLUMN id SET DEFAULT nextval('piecework_logs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY piecework_payrolls ALTER COLUMN id SET DEFAULT nextval('piecework_payrolls_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY piecework_personnel_rates ALTER COLUMN id SET DEFAULT nextval('piecework_personnel_rates_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY piecework_task_rate_history ALTER COLUMN id SET DEFAULT nextval('piecework_task_rate_history_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY piecework_tasks ALTER COLUMN id SET DEFAULT nextval('piecework_tasks_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY production_projects ALTER COLUMN id SET DEFAULT nextval('production_projects_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY project_bom_allocations ALTER COLUMN id SET DEFAULT nextval('project_bom_allocations_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY project_managers ALTER COLUMN id SET DEFAULT nextval('project_managers_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY project_product_stage_progress ALTER COLUMN id SET DEFAULT nextval('project_product_stage_progress_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY project_reservation_releases ALTER COLUMN id SET DEFAULT nextval('project_reservation_releases_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY project_stages ALTER COLUMN id SET DEFAULT nextval('project_stages_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions ALTER COLUMN id SET DEFAULT nextval('purchase_requisitions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY ref_fiscal_year_corrections ALTER COLUMN id SET DEFAULT nextval('ref_fiscal_year_corrections_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY roles ALTER COLUMN id SET DEFAULT nextval('roles_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY statutory_remittance_lines ALTER COLUMN id SET DEFAULT nextval('statutory_remittance_lines_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY stock_receipt_confirmations ALTER COLUMN id SET DEFAULT nextval('stock_receipt_confirmations_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY task_categories ALTER COLUMN id SET DEFAULT nextval('task_categories_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY transactions ALTER COLUMN id SET DEFAULT nextval('transactions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY transfers ALTER COLUMN id SET DEFAULT nextval('transfers_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions ALTER COLUMN id SET DEFAULT nextval('treasury_transactions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY user_messenger_links ALTER COLUMN id SET DEFAULT nextval('user_messenger_links_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY user_notification_preferences ALTER COLUMN id SET DEFAULT nextval('user_notification_preferences_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY user_sessions ALTER COLUMN id SET DEFAULT nextval('user_sessions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY users ALTER COLUMN id SET DEFAULT nextval('users_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY warehouses ALTER COLUMN id SET DEFAULT nextval('warehouses_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY wc_product_links ALTER COLUMN id SET DEFAULT nextval('wc_product_links_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY wc_sync_runs ALTER COLUMN id SET DEFAULT nextval('wc_sync_runs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY webhook_deliveries ALTER COLUMN id SET DEFAULT nextval('webhook_deliveries_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY webhook_event_pattern_repairs ALTER COLUMN id SET DEFAULT nextval('webhook_event_pattern_repairs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY webhook_subscriptions ALTER COLUMN id SET DEFAULT nextval('webhook_subscriptions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY woocommerce_order_logs ALTER COLUMN id SET DEFAULT nextval('woocommerce_order_logs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_definition_versions ALTER COLUMN id SET DEFAULT nextval('workflow_definition_versions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_definitions ALTER COLUMN id SET DEFAULT nextval('workflow_definitions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_delegations ALTER COLUMN id SET DEFAULT nextval('workflow_delegations_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_history_logs ALTER COLUMN id SET DEFAULT nextval('workflow_history_logs_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_instances ALTER COLUMN id SET DEFAULT nextval('workflow_instances_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_pending_approvals ALTER COLUMN id SET DEFAULT nextval('workflow_pending_approvals_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_states ALTER COLUMN id SET DEFAULT nextval('workflow_states_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_task_reopen_log ALTER COLUMN id SET DEFAULT nextval('workflow_task_reopen_log_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_tasks ALTER COLUMN id SET DEFAULT nextval('workflow_tasks_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workflow_transitions ALTER COLUMN id SET DEFAULT nextval('workflow_transitions_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports ALTER COLUMN id SET DEFAULT nextval('workshop_task_reports_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY _repair_0011_timestamps_backup
    ADD CONSTRAINT _repair_0011_timestamps_backup_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY accounting_settings
    ADD CONSTRAINT accounting_settings_key_key UNIQUE (key);
--> statement-breakpoint
ALTER TABLE ONLY accounting_settings
    ADD CONSTRAINT accounting_settings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);
--> statement-breakpoint
ALTER TABLE ONLY bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY birthday_greetings
    ADD CONSTRAINT birthday_greetings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY cheques
    ADD CONSTRAINT cheques_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY crm_activities
    ADD CONSTRAINT crm_activities_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY crm_lead_stage_history
    ADD CONSTRAINT crm_lead_stage_history_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY crm_leads
    ADD CONSTRAINT crm_leads_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY customer_tag_links
    ADD CONSTRAINT customer_tag_links_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY customer_tags
    ADD CONSTRAINT customer_tags_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY daily_log_visibility_repairs
    ADD CONSTRAINT daily_log_visibility_repairs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY daily_work_logs
    ADD CONSTRAINT daily_work_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY dead_letter_events
    ADD CONSTRAINT dead_letter_events_original_event_id_key UNIQUE (original_event_id);
--> statement-breakpoint
ALTER TABLE ONLY dead_letter_events
    ADD CONSTRAINT dead_letter_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY document_items
    ADD CONSTRAINT document_items_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY document_ref_counters
    ADD CONSTRAINT document_ref_counters_pkey PRIMARY KEY (doc_type, fiscal_year);
--> statement-breakpoint
ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY event_action_logs
    ADD CONSTRAINT event_action_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY event_action_rule_retirements
    ADD CONSTRAINT event_action_rule_retirements_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY event_action_rules
    ADD CONSTRAINT event_action_rules_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY file_attachments
    ADD CONSTRAINT file_attachments_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY fiscal_periods
    ADD CONSTRAINT fiscal_periods_pkey PRIMARY KEY (fiscal_year);
--> statement-breakpoint
ALTER TABLE ONLY form_drafts
    ADD CONSTRAINT form_drafts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY item_warehouse_stocks
    ADD CONSTRAINT idx_item_warehouse_unique UNIQUE (item_id, warehouse_id);
--> statement-breakpoint
ALTER TABLE ONLY integration_delivery_jobs
    ADD CONSTRAINT integration_delivery_jobs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY inventory_reconciliation_anomalies
    ADD CONSTRAINT inventory_reconciliation_anomalies_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY item_code_counters
    ADD CONSTRAINT item_code_counters_pkey PRIMARY KEY (scope, prefix_key);
--> statement-breakpoint
ALTER TABLE ONLY item_code_history
    ADD CONSTRAINT item_code_history_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY item_opening_voucher_items
    ADD CONSTRAINT item_opening_voucher_items_pk PRIMARY KEY (voucher_id, item_id);
--> statement-breakpoint
ALTER TABLE ONLY item_price_title_cleanup
    ADD CONSTRAINT item_price_title_cleanup_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY item_prices
    ADD CONSTRAINT item_prices_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY item_warehouse_stocks
    ADD CONSTRAINT item_warehouse_stocks_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY items_stocks_archive
    ADD CONSTRAINT items_stocks_archive_pkey PRIMARY KEY (item_id);
--> statement-breakpoint
ALTER TABLE ONLY journal_voucher_items
    ADD CONSTRAINT journal_voucher_items_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT journal_vouchers_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY legacy_date_repairs
    ADD CONSTRAINT legacy_date_repairs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY media_sections
    ADD CONSTRAINT media_sections_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY messenger_bots
    ADD CONSTRAINT messenger_bots_pkey PRIMARY KEY (messenger);
--> statement-breakpoint
ALTER TABLE ONLY messenger_link_codes
    ADD CONSTRAINT messenger_link_codes_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY migrations_log
    ADD CONSTRAINT migrations_log_name_key UNIQUE (name);
--> statement-breakpoint
ALTER TABLE ONLY migrations_log
    ADD CONSTRAINT migrations_log_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY outbox_events
    ADD CONSTRAINT outbox_events_event_id_key UNIQUE (event_id);
--> statement-breakpoint
ALTER TABLE ONLY outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY payroll_eidi_rates
    ADD CONSTRAINT payroll_eidi_rates_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY payroll_statutory_rates
    ADD CONSTRAINT payroll_statutory_rates_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY pending_materials
    ADD CONSTRAINT pending_materials_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY personnel
    ADD CONSTRAINT personnel_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY petty_cash_expense_lines
    ADD CONSTRAINT petty_cash_expense_lines_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_logs
    ADD CONSTRAINT piecework_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_payrolls
    ADD CONSTRAINT piecework_payrolls_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_personnel_rates
    ADD CONSTRAINT piecework_personnel_rates_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_task_rate_history
    ADD CONSTRAINT piecework_task_rate_history_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_tasks
    ADD CONSTRAINT piecework_tasks_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY production_projects
    ADD CONSTRAINT production_projects_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY production_projects
    ADD CONSTRAINT production_projects_project_code_key UNIQUE (project_code);
--> statement-breakpoint
ALTER TABLE ONLY project_bom_allocations
    ADD CONSTRAINT project_bom_allocations_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY project_managers
    ADD CONSTRAINT project_managers_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY project_product_stage_progress
    ADD CONSTRAINT project_product_stage_progress_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY project_reservation_releases
    ADD CONSTRAINT project_reservation_releases_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY project_stages
    ADD CONSTRAINT project_stages_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_code_key UNIQUE (code);
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY ref_fiscal_year_corrections
    ADD CONSTRAINT ref_fiscal_year_corrections_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY roles
    ADD CONSTRAINT roles_code_key UNIQUE (code);
--> statement-breakpoint
ALTER TABLE ONLY roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY statutory_remittance_lines
    ADD CONSTRAINT statutory_remittance_lines_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY stock_receipt_confirmations
    ADD CONSTRAINT stock_receipt_confirmations_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY task_categories
    ADD CONSTRAINT task_categories_name_key UNIQUE (name);
--> statement-breakpoint
ALTER TABLE ONLY task_categories
    ADD CONSTRAINT task_categories_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY transfers
    ADD CONSTRAINT transfers_code_key UNIQUE (code);
--> statement-breakpoint
ALTER TABLE ONLY transfers
    ADD CONSTRAINT transfers_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT treasury_transactions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY daily_log_visibility_repairs
    ADD CONSTRAINT uq_daily_log_visibility_repairs_log UNIQUE (daily_log_id);
--> statement-breakpoint
ALTER TABLE ONLY event_action_rule_retirements
    ADD CONSTRAINT uq_event_action_rule_retirements_rule UNIQUE (rule_id);
--> statement-breakpoint
ALTER TABLE ONLY integration_delivery_jobs
    ADD CONSTRAINT uq_integration_delivery_jobs_target_event UNIQUE (kind, target_id, event_id);
--> statement-breakpoint
ALTER TABLE ONLY item_price_title_cleanup
    ADD CONSTRAINT uq_item_price_title_cleanup_price UNIQUE (item_price_id);
--> statement-breakpoint
ALTER TABLE ONLY messenger_link_codes
    ADD CONSTRAINT uq_messenger_link_codes_code UNIQUE (messenger, code_hash);
--> statement-breakpoint
ALTER TABLE ONLY user_notification_preferences
    ADD CONSTRAINT uq_user_notification_preferences_user_category UNIQUE (user_id, category);
--> statement-breakpoint
ALTER TABLE ONLY webhook_event_pattern_repairs
    ADD CONSTRAINT uq_webhook_event_pattern_repairs_subscription UNIQUE (subscription_id);
--> statement-breakpoint
ALTER TABLE ONLY user_messenger_links
    ADD CONSTRAINT user_messenger_links_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY user_notification_preferences
    ADD CONSTRAINT user_notification_preferences_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY users
    ADD CONSTRAINT users_username_key UNIQUE (username);
--> statement-breakpoint
ALTER TABLE ONLY warehouses
    ADD CONSTRAINT warehouses_code_key UNIQUE (code);
--> statement-breakpoint
ALTER TABLE ONLY warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY wc_product_links
    ADD CONSTRAINT wc_product_links_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY wc_sync_runs
    ADD CONSTRAINT wc_sync_runs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY webhook_event_pattern_repairs
    ADD CONSTRAINT webhook_event_pattern_repairs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY webhook_subscriptions
    ADD CONSTRAINT webhook_subscriptions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY woocommerce_order_logs
    ADD CONSTRAINT woocommerce_order_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY woocommerce_order_logs
    ADD CONSTRAINT woocommerce_order_logs_wc_order_id_key UNIQUE (wc_order_id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_definition_versions
    ADD CONSTRAINT workflow_definition_versions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_definitions
    ADD CONSTRAINT workflow_definitions_code_key UNIQUE (code);
--> statement-breakpoint
ALTER TABLE ONLY workflow_definitions
    ADD CONSTRAINT workflow_definitions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_delegations
    ADD CONSTRAINT workflow_delegations_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_history_logs
    ADD CONSTRAINT workflow_history_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_instances
    ADD CONSTRAINT workflow_instances_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_pending_approvals
    ADD CONSTRAINT workflow_pending_approvals_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_states
    ADD CONSTRAINT workflow_states_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_task_reopen_log
    ADD CONSTRAINT workflow_task_reopen_log_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_tasks
    ADD CONSTRAINT workflow_tasks_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_transitions
    ADD CONSTRAINT workflow_transitions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT workshop_task_reports_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX activity_logs_action ON activity_logs USING btree (action);
--> statement-breakpoint
CREATE INDEX activity_logs_entity ON activity_logs USING btree (entity);
--> statement-breakpoint
CREATE INDEX activity_logs_search_trgm ON activity_logs USING gin ((((((((COALESCE(description, ''::text) || ''::text) || COALESCE(user_full_name, ''::text)) || ''::text) || COALESCE(username, ''::text)) || ''::text) || COALESCE(entity, ''::text))) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX activity_logs_timestamp ON activity_logs USING btree ("timestamp");
--> statement-breakpoint
CREATE INDEX activity_logs_trace_id ON activity_logs USING btree (trace_id) WHERE (trace_id <> ''::text);
--> statement-breakpoint
CREATE INDEX activity_logs_username ON activity_logs USING btree (username);
--> statement-breakpoint
CREATE INDEX customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX doc_items_doc_id ON document_items USING btree (document_id);
--> statement-breakpoint
CREATE INDEX doc_items_item_id ON document_items USING btree (item_id);
--> statement-breakpoint
CREATE INDEX docs_date ON documents USING btree (date);
--> statement-breakpoint
CREATE INDEX docs_type_deleted ON documents USING btree (type, is_deleted);
--> statement-breakpoint
CREATE INDEX idx_acc_code ON accounts USING btree (code);
--> statement-breakpoint
CREATE INDEX idx_acc_deleted ON accounts USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_acc_level ON accounts USING btree (level);
--> statement-breakpoint
CREATE INDEX idx_acc_parent ON accounts USING btree (parent_id);
--> statement-breakpoint
CREATE INDEX idx_acc_type ON accounts USING btree (account_type);
--> statement-breakpoint
CREATE INDEX idx_accounting_settings_account_id ON accounting_settings USING btree (account_id) WHERE (account_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_act_log_user ON activity_logs USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_action_logs_event ON event_action_logs USING btree (event_id);
--> statement-breakpoint
CREATE INDEX idx_action_logs_rule ON event_action_logs USING btree (rule_id, executed_at);
--> statement-breakpoint
CREATE INDEX idx_action_rules_event_active ON event_action_rules USING btree (event_type, is_active);
--> statement-breakpoint
CREATE INDEX idx_bank_accounts_account_id ON bank_accounts USING btree (account_id) WHERE (account_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_bank_code ON bank_accounts USING btree (code);
--> statement-breakpoint
CREATE INDEX idx_bank_deleted ON bank_accounts USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_bank_type ON bank_accounts USING btree (type);
--> statement-breakpoint
CREATE INDEX idx_birthday_greetings_personnel ON birthday_greetings USING btree (personnel_id, jalali_year);
--> statement-breakpoint
CREATE INDEX idx_birthday_greetings_sender ON birthday_greetings USING btree (sender_user_id);
--> statement-breakpoint
CREATE INDEX idx_bom_alloc_item ON project_bom_allocations USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_bom_alloc_proj ON project_bom_allocations USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_bom_alloc_src_tx ON project_bom_allocations USING btree (source_transaction_id);
--> statement-breakpoint
CREATE INDEX idx_bom_alloc_status ON project_bom_allocations USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_cheques_bank_account_id ON cheques USING btree (bank_account_id) WHERE (bank_account_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_cheques_created_by_id ON cheques USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_cheques_party_account_id ON cheques USING btree (party_account_id) WHERE (party_account_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_cheques_voucher_id ON cheques USING btree (voucher_id) WHERE (voucher_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_chq_deleted ON cheques USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_chq_due ON cheques USING btree (due_date);
--> statement-breakpoint
CREATE INDEX idx_chq_sayad ON cheques USING btree (sayad_number);
--> statement-breakpoint
CREATE INDEX idx_chq_status ON cheques USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_chq_type ON cheques USING btree (type);
--> statement-breakpoint
CREATE INDEX idx_crm_act_cust ON crm_activities USING btree (customer_id);
--> statement-breakpoint
CREATE INDEX idx_crm_act_date ON crm_activities USING btree (activity_date);
--> statement-breakpoint
CREATE INDEX idx_crm_act_date_iso ON crm_activities USING btree (activity_date_iso);
--> statement-breakpoint
CREATE INDEX idx_crm_act_deleted ON crm_activities USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_crm_act_lead ON crm_activities USING btree (lead_id);
--> statement-breakpoint
CREATE INDEX idx_crm_act_next_iso ON crm_activities USING btree (next_followup_date_iso);
--> statement-breakpoint
CREATE INDEX idx_crm_activities_assigned_personnel_id ON crm_activities USING btree (assigned_personnel_id) WHERE (assigned_personnel_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_crm_assigned ON crm_leads USING btree (assigned_to);
--> statement-breakpoint
CREATE INDEX idx_crm_deleted ON crm_leads USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_crm_lead_stage_history_changed_at ON crm_lead_stage_history USING btree (changed_at);
--> statement-breakpoint
CREATE INDEX idx_crm_lead_stage_history_lead ON crm_lead_stage_history USING btree (lead_id, changed_at);
--> statement-breakpoint
CREATE INDEX idx_crm_lead_stage_history_personnel ON crm_lead_stage_history USING btree (assigned_personnel_id) WHERE (assigned_personnel_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_crm_lead_stage_history_user ON crm_lead_stage_history USING btree (changed_by_id) WHERE (changed_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_crm_leads_assigned_personnel_id ON crm_leads USING btree (assigned_personnel_id) WHERE (assigned_personnel_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_crm_leads_customer_id ON crm_leads USING btree (customer_id) WHERE (customer_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_crm_proforma ON crm_leads USING btree (proforma_id);
--> statement-breakpoint
CREATE INDEX idx_crm_stage ON crm_leads USING btree (stage);
--> statement-breakpoint
CREATE INDEX idx_customer_tag_links_created_by ON customer_tag_links USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_customer_tag_links_tag ON customer_tag_links USING btree (tag_id);
--> statement-breakpoint
CREATE INDEX idx_customer_tags_created_by ON customer_tags USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_customers_is_deleted ON customers USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_customers_party_type ON customers USING btree (party_type);
--> statement-breakpoint
CREATE INDEX idx_daily_work_logs_project_id ON daily_work_logs USING btree (project_id) WHERE (project_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_dead_letter_events_resolved_by ON dead_letter_events USING btree (resolved_by) WHERE (resolved_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_dlq_aggregate ON dead_letter_events USING btree (aggregate_type, aggregate_id);
--> statement-breakpoint
CREATE INDEX idx_dlq_event_type ON dead_letter_events USING btree (event_type);
--> statement-breakpoint
CREATE INDEX idx_dlq_status ON dead_letter_events USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_doc_items_deleted ON document_items USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_docs_buyer_name ON documents USING btree (buyer_name);
--> statement-breakpoint
CREATE INDEX idx_docs_procurement_requisition ON documents USING btree (procurement_requisition_id) WHERE (procurement_requisition_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_docs_project ON documents USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_docs_return_of_document ON documents USING btree (return_of_document_id);
--> statement-breakpoint
CREATE INDEX idx_docs_type_ref_fiscal_year ON documents USING btree (type, ref_fiscal_year);
--> statement-breakpoint
CREATE INDEX idx_documents_crm_lead_id ON documents USING btree (crm_lead_id) WHERE (crm_lead_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_documents_party_id ON documents USING btree (party_id) WHERE (party_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_documents_recipient_personnel_id ON documents USING btree (recipient_personnel_id) WHERE (recipient_personnel_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_dwl_date ON daily_work_logs USING btree (date);
--> statement-breakpoint
CREATE INDEX idx_dwl_date_iso ON daily_work_logs USING btree (date_iso);
--> statement-breakpoint
CREATE INDEX idx_dwl_deleted ON daily_work_logs USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_dwl_user ON daily_work_logs USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_dwl_vis ON daily_work_logs USING btree (visibility);
--> statement-breakpoint
CREATE INDEX idx_event_action_rules_created_by ON event_action_rules USING btree (created_by) WHERE (created_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_file_attachments_entity ON file_attachments USING btree (entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX idx_fiscal_periods_closing_voucher_id ON fiscal_periods USING btree (closing_voucher_id) WHERE (closing_voucher_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_form_drafts_session ON form_drafts USING btree (session_id);
--> statement-breakpoint
CREATE INDEX idx_form_drafts_updated ON form_drafts USING btree (updated_at);
--> statement-breakpoint
CREATE INDEX idx_form_drafts_user_entity ON form_drafts USING btree (user_id, entity_type, draft_key);
--> statement-breakpoint
CREATE INDEX idx_idemp_created_by ON idempotency_keys USING btree (created_by_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_idemp_user_scope_key ON idempotency_keys USING btree (created_by_id, scope, key) NULLS NOT DISTINCT;
--> statement-breakpoint
CREATE INDEX idx_idempotency_key ON idempotency_keys USING btree (key);
--> statement-breakpoint
CREATE INDEX idx_idempotency_scope_status ON idempotency_keys USING btree (scope, status);
--> statement-breakpoint
CREATE INDEX idx_integration_delivery_jobs_due ON integration_delivery_jobs USING btree (status, next_attempt_at);
--> statement-breakpoint
CREATE INDEX idx_inv_recon_anomalies_item ON inventory_reconciliation_anomalies USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_inv_recon_anomalies_run ON inventory_reconciliation_anomalies USING btree (run_id);
--> statement-breakpoint
CREATE INDEX idx_inventory_reconciliation_anomalies_warehouse_id ON inventory_reconciliation_anomalies USING btree (warehouse_id) WHERE (warehouse_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_iovi_item ON item_opening_voucher_items USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_item_code_history_item ON item_code_history USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_item_code_history_old_code ON item_code_history USING btree (old_code);
--> statement-breakpoint
CREATE INDEX idx_item_code_history_user ON item_code_history USING btree (user_id) WHERE (user_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_items_collections ON items USING gin (collections);
--> statement-breakpoint
CREATE INDEX idx_items_design_year ON items USING btree (design_year) WHERE (design_year IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_items_transfer_code ON items USING btree (transfer_code) WHERE (transfer_code IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_iws_item_id ON item_warehouse_stocks USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_iws_warehouse_code ON item_warehouse_stocks USING btree (warehouse_code);
--> statement-breakpoint
CREATE INDEX idx_iws_warehouse_id ON item_warehouse_stocks USING btree (warehouse_id);
--> statement-breakpoint
CREATE INDEX idx_journal_vouchers_approved_by_id ON journal_vouchers USING btree (approved_by_id) WHERE (approved_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_journal_vouchers_created_by_id ON journal_vouchers USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_journal_vouchers_source_document_id ON journal_vouchers USING btree (source_document_id) WHERE (source_document_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_journal_vouchers_source_payroll_id ON journal_vouchers USING btree (source_payroll_id) WHERE (source_payroll_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_journal_vouchers_updated_by_id ON journal_vouchers USING btree (updated_by_id) WHERE (updated_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_jv_date ON journal_vouchers USING btree (date);
--> statement-breakpoint
CREATE INDEX idx_jv_deleted ON journal_vouchers USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_jv_module ON journal_vouchers USING btree (reference_module);
--> statement-breakpoint
CREATE INDEX idx_jv_number ON journal_vouchers USING btree (voucher_number);
--> statement-breakpoint
CREATE INDEX idx_jv_reference ON journal_vouchers USING btree (reference_module, reference_id);
--> statement-breakpoint
CREATE INDEX idx_jv_source_bom_allocation ON journal_vouchers USING btree (source_bom_allocation_id) WHERE (source_bom_allocation_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_jv_source_cheque ON journal_vouchers USING btree (source_cheque_id) WHERE (source_cheque_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_jv_source_fiscal_year ON journal_vouchers USING btree (source_fiscal_year) WHERE (source_fiscal_year IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_jv_status ON journal_vouchers USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_jvi_account ON journal_voucher_items USING btree (account_id);
--> statement-breakpoint
CREATE INDEX idx_jvi_deleted ON journal_voucher_items USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_jvi_detailed ON journal_voucher_items USING btree (detailed_type, detailed_id);
--> statement-breakpoint
CREATE INDEX idx_jvi_voucher ON journal_voucher_items USING btree (voucher_id);
--> statement-breakpoint
CREATE INDEX idx_media_assets_item_id ON media_assets USING btree (item_id) WHERE (item_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_media_assets_section_id ON media_assets USING btree (section_id, is_deleted, sort_order);
--> statement-breakpoint
CREATE INDEX idx_media_assets_sha256 ON media_assets USING btree (sha256);
--> statement-breakpoint
CREATE INDEX idx_media_assets_tags ON media_assets USING gin (tags);
--> statement-breakpoint
CREATE INDEX idx_messenger_bots_updated_by_id ON messenger_bots USING btree (updated_by_id) WHERE (updated_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_messenger_link_codes_user_id ON messenger_link_codes USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_notif_read ON notifications USING btree (is_read);
--> statement-breakpoint
CREATE INDEX idx_notif_user ON notifications USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_notifications_sender_id ON notifications USING btree (sender_id) WHERE (sender_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_outbox_aggregate ON outbox_events USING btree (aggregate_type, aggregate_id);
--> statement-breakpoint
CREATE INDEX idx_outbox_status_locked ON outbox_events USING btree (status, locked_at);
--> statement-breakpoint
CREATE INDEX idx_outbox_status_next ON outbox_events USING btree (status, next_retry_at);
--> statement-breakpoint
CREATE INDEX idx_personnel_code ON personnel USING btree (personnel_code);
--> statement-breakpoint
CREATE INDEX idx_personnel_deleted ON personnel USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_personnel_status ON personnel USING btree (employment_status);
--> statement-breakpoint
CREATE INDEX idx_personnel_user ON personnel USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_petty_cash_expense_lines_account ON petty_cash_expense_lines USING btree (account_id);
--> statement-breakpoint
CREATE INDEX idx_piecework_logs_created_by_id ON piecework_logs USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_piecework_payrolls_created_by_id ON piecework_payrolls USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_piecework_task_rate_history_changed_by_user_id ON piecework_task_rate_history USING btree (changed_by_user_id) WHERE (changed_by_user_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_plog_date ON piecework_logs USING btree (date);
--> statement-breakpoint
CREATE INDEX idx_plog_date_iso ON piecework_logs USING btree (date_iso);
--> statement-breakpoint
CREATE INDEX idx_plog_deleted ON piecework_logs USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_plog_payroll ON piecework_logs USING btree (payroll_id);
--> statement-breakpoint
CREATE INDEX idx_plog_personnel ON piecework_logs USING btree (personnel_id);
--> statement-breakpoint
CREATE INDEX idx_plog_project ON piecework_logs USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_plog_task ON piecework_logs USING btree (task_id);
--> statement-breakpoint
CREATE INDEX idx_pmat_code ON pending_materials USING btree (code);
--> statement-breakpoint
CREATE INDEX idx_pmat_deleted ON pending_materials USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_pmat_item ON pending_materials USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_pmat_project ON pending_materials USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_pmat_status ON pending_materials USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_ppay_deleted ON piecework_payrolls USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_ppay_eidi_year ON piecework_payrolls USING btree (personnel_id, eidi_year) WHERE (eidi_year IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_ppay_number ON piecework_payrolls USING btree (payroll_number);
--> statement-breakpoint
CREATE INDEX idx_ppay_personnel ON piecework_payrolls USING btree (personnel_id);
--> statement-breakpoint
CREATE INDEX idx_ppay_status ON piecework_payrolls USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_ppr_personnel ON piecework_personnel_rates USING btree (personnel_id);
--> statement-breakpoint
CREATE INDEX idx_ppr_task ON piecework_personnel_rates USING btree (task_id);
--> statement-breakpoint
CREATE INDEX idx_ppsp_deleted ON project_product_stage_progress USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_ppsp_item ON project_product_stage_progress USING btree (project_id, item_id);
--> statement-breakpoint
CREATE INDEX idx_ppsp_order ON project_product_stage_progress USING btree (project_id, stage_order);
--> statement-breakpoint
CREATE INDEX idx_pr_code ON purchase_requisitions USING btree (code);
--> statement-breakpoint
CREATE INDEX idx_pr_consolidated_into ON purchase_requisitions USING btree (consolidated_into_id) WHERE (consolidated_into_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_pr_deleted ON purchase_requisitions USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_pr_priority ON purchase_requisitions USING btree (priority);
--> statement-breakpoint
CREATE INDEX idx_pr_project ON purchase_requisitions USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_pr_status ON purchase_requisitions USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_pr_workflow ON purchase_requisitions USING btree (workflow_instance_id);
--> statement-breakpoint
CREATE INDEX idx_production_projects_customer_id ON production_projects USING btree (customer_id) WHERE (customer_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_production_projects_item_id ON production_projects USING btree (item_id) WHERE (item_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_proj_code ON production_projects USING btree (project_code);
--> statement-breakpoint
CREATE INDEX idx_proj_deleted ON production_projects USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_proj_status ON production_projects USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_project_bom_allocations_recipient_personnel_id ON project_bom_allocations USING btree (recipient_personnel_id) WHERE (recipient_personnel_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_project_bom_allocations_user_id ON project_bom_allocations USING btree (user_id) WHERE (user_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_project_managers_created_by ON project_managers USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_project_managers_user ON project_managers USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_project_product_stage_progress_item_id ON project_product_stage_progress USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_project_reservation_releases_bom_allocation_id ON project_reservation_releases USING btree (bom_allocation_id) WHERE (bom_allocation_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_project_reservation_releases_project_id ON project_reservation_releases USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_prr_document ON project_reservation_releases USING btree (document_id);
--> statement-breakpoint
CREATE INDEX idx_ptask_cat ON piecework_tasks USING btree (category);
--> statement-breakpoint
CREATE INDEX idx_ptask_code ON piecework_tasks USING btree (code);
--> statement-breakpoint
CREATE INDEX idx_ptask_deleted ON piecework_tasks USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_ptrh_created ON piecework_task_rate_history USING btree (created_at);
--> statement-breakpoint
CREATE INDEX idx_ptrh_personnel ON piecework_task_rate_history USING btree (personnel_id) WHERE (personnel_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_ptrh_task ON piecework_task_rate_history USING btree (task_id);
--> statement-breakpoint
CREATE INDEX idx_purchase_requisitions_assigned_to_id ON purchase_requisitions USING btree (assigned_to_id) WHERE (assigned_to_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_purchase_requisitions_requested_by_id ON purchase_requisitions USING btree (requested_by_id) WHERE (requested_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_ref_fiscal_year_corrections_document_id ON ref_fiscal_year_corrections USING btree (document_id);
--> statement-breakpoint
CREATE INDEX idx_stage_order ON project_stages USING btree (stage_order);
--> statement-breakpoint
CREATE INDEX idx_stage_proj ON project_stages USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_statutory_remittance_lines_personnel_id ON statutory_remittance_lines USING btree (personnel_id);
--> statement-breakpoint
CREATE INDEX idx_statutory_remittance_lines_treasury_transaction_id ON statutory_remittance_lines USING btree (treasury_transaction_id);
--> statement-breakpoint
CREATE INDEX idx_stock_receipt_confirmations_confirmed_by ON stock_receipt_confirmations USING btree (confirmed_by_id);
--> statement-breakpoint
CREATE INDEX idx_stock_receipt_confirmations_personnel ON stock_receipt_confirmations USING btree (personnel_id);
--> statement-breakpoint
CREATE INDEX idx_transfer_code ON transfers USING btree (code);
--> statement-breakpoint
CREATE INDEX idx_transfer_deleted ON transfers USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_treasury_transactions_cheque_id ON treasury_transactions USING btree (cheque_id) WHERE (cheque_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_treasury_transactions_contra_account_id ON treasury_transactions USING btree (contra_account_id) WHERE (contra_account_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_treasury_transactions_created_by_id ON treasury_transactions USING btree (created_by_id) WHERE (created_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_treasury_transactions_document_id ON treasury_transactions USING btree (document_id) WHERE (document_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_treasury_transactions_payroll_id ON treasury_transactions USING btree (payroll_id) WHERE (payroll_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_treasury_transactions_voucher_id ON treasury_transactions USING btree (voucher_id) WHERE (voucher_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_tt_bank ON treasury_transactions USING btree (bank_account_id);
--> statement-breakpoint
CREATE INDEX idx_tt_date ON treasury_transactions USING btree (date);
--> statement-breakpoint
CREATE INDEX idx_tt_deleted ON treasury_transactions USING btree (is_deleted);
--> statement-breakpoint
CREATE INDEX idx_tt_type ON treasury_transactions USING btree (type);
--> statement-breakpoint
CREATE INDEX idx_user_messenger_links_user_id ON user_messenger_links USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_user_sessions_user_id ON user_sessions USING btree (user_id, id);
--> statement-breakpoint
CREATE INDEX idx_users_role ON users USING btree (role) WHERE (role IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_wc_erp_doc ON woocommerce_order_logs USING btree (erp_document_id);
--> statement-breakpoint
CREATE INDEX idx_wc_order_id ON woocommerce_order_logs USING btree (wc_order_id);
--> statement-breakpoint
CREATE INDEX idx_wc_product_links_item ON wc_product_links USING btree (item_id);
--> statement-breakpoint
CREATE INDEX idx_wc_status ON woocommerce_order_logs USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_wc_sync_runs_kind ON wc_sync_runs USING btree (kind, id);
--> statement-breakpoint
CREATE INDEX idx_wc_sync_runs_user ON wc_sync_runs USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_wdv_def_ver ON workflow_definition_versions USING btree (definition_id, version);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliv_event ON webhook_deliveries USING btree (event_id);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliv_sub ON webhook_deliveries USING btree (subscription_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_webhook_subs_active ON webhook_subscriptions USING btree (is_active);
--> statement-breakpoint
CREATE INDEX idx_webhook_subscriptions_created_by ON webhook_subscriptions USING btree (created_by) WHERE (created_by IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_wfd_active ON workflow_delegations USING btree (is_active);
--> statement-breakpoint
CREATE INDEX idx_wfd_from_user ON workflow_delegations USING btree (from_user_id);
--> statement-breakpoint
CREATE INDEX idx_wfd_to_user ON workflow_delegations USING btree (to_user_id);
--> statement-breakpoint
CREATE INDEX idx_wfh_instance ON workflow_history_logs USING btree (instance_id);
--> statement-breakpoint
CREATE INDEX idx_wfi_entity ON workflow_instances USING btree (entity_type, entity_id);
--> statement-breakpoint
CREATE INDEX idx_wfpa_instance ON workflow_pending_approvals USING btree (instance_id);
--> statement-breakpoint
CREATE INDEX idx_wfs_definition ON workflow_states USING btree (workflow_definition_id);
--> statement-breakpoint
CREATE INDEX idx_wft_assigned_user ON workflow_tasks USING btree (assigned_user_id);
--> statement-breakpoint
CREATE INDEX idx_wft_instance ON workflow_tasks USING btree (instance_id);
--> statement-breakpoint
CREATE INDEX idx_wft_sla_due ON workflow_tasks USING btree (due_at) WHERE ((status = 'pending'::text) AND (sla_reminded_at IS NULL));
--> statement-breakpoint
CREATE INDEX idx_wft_status ON workflow_tasks USING btree (status);
--> statement-breakpoint
CREATE INDEX idx_wftr_definition ON workflow_transitions USING btree (workflow_definition_id);
--> statement-breakpoint
CREATE INDEX idx_workflow_instances_workflow_definition_id ON workflow_instances USING btree (workflow_definition_id);
--> statement-breakpoint
CREATE INDEX idx_workflow_transitions_from_state_id ON workflow_transitions USING btree (from_state_id);
--> statement-breakpoint
CREATE INDEX idx_workflow_transitions_to_state_id ON workflow_transitions USING btree (to_state_id);
--> statement-breakpoint
CREATE INDEX idx_workshop_task_reports_created_by ON workshop_task_reports USING btree (created_by_id);
--> statement-breakpoint
CREATE INDEX idx_workshop_task_reports_personnel ON workshop_task_reports USING btree (personnel_id);
--> statement-breakpoint
CREATE INDEX idx_workshop_task_reports_piecework_log ON workshop_task_reports USING btree (piecework_log_id) WHERE (piecework_log_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_workshop_task_reports_project ON workshop_task_reports USING btree (project_id);
--> statement-breakpoint
CREATE INDEX idx_workshop_task_reports_reviewed_by ON workshop_task_reports USING btree (reviewed_by_id) WHERE (reviewed_by_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_workshop_task_reports_stage ON workshop_task_reports USING btree (stage_id);
--> statement-breakpoint
CREATE INDEX idx_workshop_task_reports_task ON workshop_task_reports USING btree (task_id) WHERE (task_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX item_prices_item_id ON item_prices USING btree (item_id);
--> statement-breakpoint
CREATE INDEX items_category ON items USING btree (category);
--> statement-breakpoint
CREATE INDEX items_code ON items USING btree (code);
--> statement-breakpoint
CREATE INDEX items_name_trgm_idx ON items USING gin (name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX items_type_deleted ON items USING btree (type, is_deleted);
--> statement-breakpoint
CREATE INDEX tx_date ON transactions USING btree (date);
--> statement-breakpoint
CREATE INDEX tx_doc_id ON transactions USING btree (document_id);
--> statement-breakpoint
CREATE INDEX tx_item_active_date ON transactions USING btree (item_id, is_deleted, date);
--> statement-breakpoint
CREATE INDEX tx_item_date_id_active ON transactions USING btree (item_id, is_deleted, date, id);
--> statement-breakpoint
CREATE INDEX tx_item_loc_active ON transactions USING btree (item_id, location, is_deleted);
--> statement-breakpoint
CREATE INDEX tx_type_deleted ON transactions USING btree (type, is_deleted);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_accounts_code_active ON accounts USING btree (code) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_birthday_greetings_live ON birthday_greetings USING btree (personnel_id, jalali_year, sender_user_id) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_categories_name_active ON categories USING btree (lower(btrim(name))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_cheques_sayad_number_active ON cheques USING btree (sayad_number) WHERE ((is_deleted = 0) AND (sayad_number IS NOT NULL) AND (sayad_number <> ''::text));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_customer_tag_links_customer_tag ON customer_tag_links USING btree (customer_id, tag_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_customer_tags_name_active ON customer_tags USING btree (lower(btrim(name))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_customers_name_active ON customers USING btree (lower(btrim(name))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_documents_type_fy_ref_active ON documents USING btree (type, ref_fiscal_year, ref_number) WHERE ((is_deleted = 0) AND (length(ref_number) > 0));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_form_drafts_live_user_key ON form_drafts USING btree (user_id, entity_type, draft_key) WHERE ((is_deleted = 0) AND (user_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_items_code_active ON items USING btree (upper(btrim(code))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_items_name_active ON items USING btree (lower(btrim(name))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_jv_source_document_active ON journal_vouchers USING btree (source_document_id) WHERE ((is_deleted = 0) AND (source_document_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_jv_source_payroll_active ON journal_vouchers USING btree (source_payroll_id) WHERE ((is_deleted = 0) AND (source_payroll_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_jv_voucher_number ON journal_vouchers USING btree (voucher_number);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_media_assets_cover_item ON media_assets USING btree (item_id) WHERE ((is_cover = 1) AND (is_deleted = 0) AND (item_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_media_sections_products ON media_sections USING btree (kind) WHERE ((kind = 'products'::text) AND (is_deleted = 0));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_media_sections_title_active ON media_sections USING btree (lower(btrim(title))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_notifications_due_reminder ON notifications USING btree (user_id, type, link) WHERE (type = 'crm_due_task'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_notifications_social ON notifications USING btree (user_id, type, link) WHERE (type = ANY (ARRAY['colleague_birthday'::text, 'birthday_greeting'::text]));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_notifications_workshop_reminder ON notifications USING btree (user_id, type, link) WHERE (type = ANY (ARRAY['workshop_task_due_soon'::text, 'workshop_task_overdue'::text]));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_payroll_eidi_rates_year ON payroll_eidi_rates USING btree (jalali_year);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_payroll_statutory_rates_year ON payroll_statutory_rates USING btree (jalali_year);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_personnel_code_active ON personnel USING btree (lower(btrim(personnel_code))) WHERE ((is_deleted = 0) AND (btrim(personnel_code) <> ''::text));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_personnel_national_id_active ON personnel USING btree (btrim(national_id)) WHERE ((is_deleted = 0) AND (btrim(national_id) <> ''::text));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_personnel_user_active ON personnel USING btree (user_id) WHERE ((is_deleted = 0) AND (user_id IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_petty_cash_expense_lines_transaction_line ON petty_cash_expense_lines USING btree (treasury_transaction_id, line_no);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_piecework_personnel_rates_active ON piecework_personnel_rates USING btree (personnel_id, task_id) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_ppsp_project_item_stage ON project_product_stage_progress USING btree (project_id, item_id, stage_order);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_project_managers_project_user ON project_managers USING btree (project_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_project_stages_order_active ON project_stages USING btree (project_id, stage_order) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_ptask_code_active ON piecework_tasks USING btree (lower(btrim(code))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_stock_receipt_confirmations_allocation ON stock_receipt_confirmations USING btree (bom_allocation_id) WHERE (bom_allocation_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_stock_receipt_confirmations_document ON stock_receipt_confirmations USING btree (document_id) WHERE (document_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_user_messenger_links_chat_active ON user_messenger_links USING btree (messenger, chat_id) WHERE (is_active = 1);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_user_messenger_links_user_active ON user_messenger_links USING btree (user_id, messenger) WHERE (is_active = 1);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_user_sessions_sid ON user_sessions USING btree (sid);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_users_username_key ON users USING btree (lower(btrim(username))) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_wc_product_links_item_live ON wc_product_links USING btree (item_id) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_wc_product_links_product_live ON wc_product_links USING btree (wc_product_id, wc_variation_id) WHERE (is_deleted = 0);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_wdv_definition_published ON workflow_definition_versions USING btree (definition_id) WHERE (status = 'published'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_wdv_definition_version ON workflow_definition_versions USING btree (definition_id, version);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_workflow_definitions_active_entity_type ON workflow_definitions USING btree (entity_type) WHERE (is_active = 1);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_workflow_instances_open_entity ON workflow_instances USING btree (entity_type, entity_id) WHERE (status = 'IN_PROGRESS'::text);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_workshop_task_reports_live_row ON workshop_task_reports USING btree (project_id, stage_id, product_id, row_id) WHERE (status = ANY (ARRAY['submitted'::text, 'approved'::text]));
--> statement-breakpoint
CREATE TRIGGER trg_accounting_settings_updated_at BEFORE UPDATE ON accounting_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_crm_leads_updated_at BEFORE UPDATE ON crm_leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_documents_fill_ref_fiscal_year BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION erp_documents_fill_ref_fiscal_year();
--> statement-breakpoint
CREATE TRIGGER trg_event_action_rules_updated_at BEFORE UPDATE ON event_action_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_form_drafts_updated_at BEFORE UPDATE ON form_drafts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_item_prices_updated_at BEFORE UPDATE ON item_prices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_items_current_stock_from_table BEFORE INSERT OR UPDATE OF current_stock ON items FOR EACH ROW EXECUTE FUNCTION erp_items_current_stock_from_table();
--> statement-breakpoint
CREATE TRIGGER trg_iws_refresh_item_current_stock AFTER INSERT OR DELETE OR UPDATE OF current_stock, item_id ON item_warehouse_stocks FOR EACH ROW EXECUTE FUNCTION erp_iws_refresh_item_current_stock();
--> statement-breakpoint
CREATE TRIGGER trg_personnel_updated_at BEFORE UPDATE ON personnel FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_project_stages_updated_at BEFORE UPDATE ON project_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_treasury_transactions_updated_at BEFORE UPDATE ON treasury_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_woocommerce_order_logs_updated_at BEFORE UPDATE ON woocommerce_order_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER trg_workflow_instances_updated_at BEFORE UPDATE ON workflow_instances FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
ALTER TABLE ONLY crm_lead_stage_history
    ADD CONSTRAINT crm_lead_stage_history_assigned_personnel_id_fkey FOREIGN KEY (assigned_personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY crm_lead_stage_history
    ADD CONSTRAINT crm_lead_stage_history_changed_by_id_fkey FOREIGN KEY (changed_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY crm_lead_stage_history
    ADD CONSTRAINT crm_lead_stage_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES crm_leads(id);
--> statement-breakpoint
ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY fiscal_periods
    ADD CONSTRAINT fiscal_periods_closing_voucher_id_fkey FOREIGN KEY (closing_voucher_id) REFERENCES journal_vouchers(id);
--> statement-breakpoint
ALTER TABLE ONLY accounting_settings
    ADD CONSTRAINT fk_accounting_settings_account_id FOREIGN KEY (account_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY accounts
    ADD CONSTRAINT fk_accounts_parent FOREIGN KEY (parent_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY activity_logs
    ADD CONSTRAINT fk_activity_logs_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY bank_accounts
    ADD CONSTRAINT fk_bank_accounts_account_id FOREIGN KEY (account_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY birthday_greetings
    ADD CONSTRAINT fk_birthday_greetings_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY birthday_greetings
    ADD CONSTRAINT fk_birthday_greetings_sender FOREIGN KEY (sender_user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY cheques
    ADD CONSTRAINT fk_cheques_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY cheques
    ADD CONSTRAINT fk_cheques_created_by_id FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY cheques
    ADD CONSTRAINT fk_cheques_party_account FOREIGN KEY (party_account_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY cheques
    ADD CONSTRAINT fk_cheques_voucher_id FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id);
--> statement-breakpoint
ALTER TABLE ONLY crm_activities
    ADD CONSTRAINT fk_crm_activities_assigned_personnel_id FOREIGN KEY (assigned_personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY crm_activities
    ADD CONSTRAINT fk_crm_activities_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);
--> statement-breakpoint
ALTER TABLE ONLY crm_activities
    ADD CONSTRAINT fk_crm_activities_lead_id FOREIGN KEY (lead_id) REFERENCES crm_leads(id);
--> statement-breakpoint
ALTER TABLE ONLY crm_leads
    ADD CONSTRAINT fk_crm_leads_assigned_personnel_id FOREIGN KEY (assigned_personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY crm_leads
    ADD CONSTRAINT fk_crm_leads_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);
--> statement-breakpoint
ALTER TABLE ONLY customer_tag_links
    ADD CONSTRAINT fk_customer_tag_links_created_by FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY customer_tag_links
    ADD CONSTRAINT fk_customer_tag_links_customer FOREIGN KEY (customer_id) REFERENCES customers(id);
--> statement-breakpoint
ALTER TABLE ONLY customer_tag_links
    ADD CONSTRAINT fk_customer_tag_links_tag FOREIGN KEY (tag_id) REFERENCES customer_tags(id);
--> statement-breakpoint
ALTER TABLE ONLY customer_tags
    ADD CONSTRAINT fk_customer_tags_created_by FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY daily_work_logs
    ADD CONSTRAINT fk_daily_work_logs_project_id FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY daily_work_logs
    ADD CONSTRAINT fk_daily_work_logs_user_id FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY dead_letter_events
    ADD CONSTRAINT fk_dead_letter_events_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY document_items
    ADD CONSTRAINT fk_document_items_document_id FOREIGN KEY (document_id) REFERENCES documents(id);
--> statement-breakpoint
ALTER TABLE ONLY document_items
    ADD CONSTRAINT fk_document_items_item_id FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY documents
    ADD CONSTRAINT fk_documents_crm_lead_id FOREIGN KEY (crm_lead_id) REFERENCES crm_leads(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY documents
    ADD CONSTRAINT fk_documents_party FOREIGN KEY (party_id) REFERENCES customers(id);
--> statement-breakpoint
ALTER TABLE ONLY documents
    ADD CONSTRAINT fk_documents_procurement_requisition FOREIGN KEY (procurement_requisition_id) REFERENCES purchase_requisitions(id);
--> statement-breakpoint
ALTER TABLE ONLY documents
    ADD CONSTRAINT fk_documents_recipient_personnel FOREIGN KEY (recipient_personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY documents
    ADD CONSTRAINT fk_documents_return_of_document FOREIGN KEY (return_of_document_id) REFERENCES documents(id);
--> statement-breakpoint
ALTER TABLE ONLY event_action_logs
    ADD CONSTRAINT fk_event_action_logs_rule FOREIGN KEY (rule_id) REFERENCES event_action_rules(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY event_action_rules
    ADD CONSTRAINT fk_event_action_rules_created_by FOREIGN KEY (created_by) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY form_drafts
    ADD CONSTRAINT fk_form_drafts_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY idempotency_keys
    ADD CONSTRAINT fk_idempotency_keys_created_by_id FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY item_prices
    ADD CONSTRAINT fk_item_prices_item_id FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY journal_voucher_items
    ADD CONSTRAINT fk_journal_voucher_items_account_id FOREIGN KEY (account_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY journal_voucher_items
    ADD CONSTRAINT fk_journal_voucher_items_voucher_id FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id);
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT fk_journal_vouchers_approved_by_id FOREIGN KEY (approved_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT fk_journal_vouchers_created_by_id FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT fk_journal_vouchers_updated_by_id FOREIGN KEY (updated_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY media_assets
    ADD CONSTRAINT fk_media_assets_item FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY media_assets
    ADD CONSTRAINT fk_media_assets_section FOREIGN KEY (section_id) REFERENCES media_sections(id);
--> statement-breakpoint
ALTER TABLE ONLY messenger_bots
    ADD CONSTRAINT fk_messenger_bots_updated_by FOREIGN KEY (updated_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY messenger_link_codes
    ADD CONSTRAINT fk_messenger_link_codes_user FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY notifications
    ADD CONSTRAINT fk_notifications_sender_id FOREIGN KEY (sender_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY notifications
    ADD CONSTRAINT fk_notifications_user_id FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY pending_materials
    ADD CONSTRAINT fk_pending_materials_item_id FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY pending_materials
    ADD CONSTRAINT fk_pending_materials_project_id FOREIGN KEY (project_id) REFERENCES production_projects(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY personnel
    ADD CONSTRAINT fk_personnel_user_id FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY petty_cash_expense_lines
    ADD CONSTRAINT fk_petty_cash_expense_lines_account FOREIGN KEY (account_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY petty_cash_expense_lines
    ADD CONSTRAINT fk_petty_cash_expense_lines_treasury_transaction FOREIGN KEY (treasury_transaction_id) REFERENCES treasury_transactions(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_logs
    ADD CONSTRAINT fk_piecework_logs_created_by_id FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_logs
    ADD CONSTRAINT fk_piecework_logs_payroll_id FOREIGN KEY (payroll_id) REFERENCES piecework_payrolls(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_logs
    ADD CONSTRAINT fk_piecework_logs_personnel_id FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_logs
    ADD CONSTRAINT fk_piecework_logs_project_id FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_logs
    ADD CONSTRAINT fk_piecework_logs_task_id FOREIGN KEY (task_id) REFERENCES piecework_tasks(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_payrolls
    ADD CONSTRAINT fk_piecework_payrolls_created_by_id FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_payrolls
    ADD CONSTRAINT fk_piecework_payrolls_personnel_id FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_personnel_rates
    ADD CONSTRAINT fk_piecework_personnel_rates_personnel_id FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_personnel_rates
    ADD CONSTRAINT fk_piecework_personnel_rates_task_id FOREIGN KEY (task_id) REFERENCES piecework_tasks(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_task_rate_history
    ADD CONSTRAINT fk_piecework_task_rate_history_changed_by_user_id FOREIGN KEY (changed_by_user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY piecework_task_rate_history
    ADD CONSTRAINT fk_piecework_task_rate_history_task_id FOREIGN KEY (task_id) REFERENCES piecework_tasks(id);
--> statement-breakpoint
ALTER TABLE ONLY production_projects
    ADD CONSTRAINT fk_production_projects_customer_id FOREIGN KEY (customer_id) REFERENCES customers(id);
--> statement-breakpoint
ALTER TABLE ONLY production_projects
    ADD CONSTRAINT fk_production_projects_item_id FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY project_bom_allocations
    ADD CONSTRAINT fk_project_bom_allocations_item_id FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY project_bom_allocations
    ADD CONSTRAINT fk_project_bom_allocations_project_id FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY project_bom_allocations
    ADD CONSTRAINT fk_project_bom_allocations_recipient_personnel FOREIGN KEY (recipient_personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY project_bom_allocations
    ADD CONSTRAINT fk_project_bom_allocations_source_transaction_id FOREIGN KEY (source_transaction_id) REFERENCES transactions(id);
--> statement-breakpoint
ALTER TABLE ONLY project_bom_allocations
    ADD CONSTRAINT fk_project_bom_allocations_user_id FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY project_managers
    ADD CONSTRAINT fk_project_managers_created_by FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY project_managers
    ADD CONSTRAINT fk_project_managers_project FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY project_managers
    ADD CONSTRAINT fk_project_managers_user FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY project_reservation_releases
    ADD CONSTRAINT fk_project_reservation_releases_bom_allocation_id FOREIGN KEY (bom_allocation_id) REFERENCES project_bom_allocations(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY project_stages
    ADD CONSTRAINT fk_project_stages_project FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions
    ADD CONSTRAINT fk_purchase_requisitions_consolidated_into FOREIGN KEY (consolidated_into_id) REFERENCES purchase_requisitions(id);
--> statement-breakpoint
ALTER TABLE ONLY statutory_remittance_lines
    ADD CONSTRAINT fk_statutory_remittance_lines_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY statutory_remittance_lines
    ADD CONSTRAINT fk_statutory_remittance_lines_treasury_transaction FOREIGN KEY (treasury_transaction_id) REFERENCES treasury_transactions(id);
--> statement-breakpoint
ALTER TABLE ONLY stock_receipt_confirmations
    ADD CONSTRAINT fk_stock_receipt_confirmations_allocation FOREIGN KEY (bom_allocation_id) REFERENCES project_bom_allocations(id);
--> statement-breakpoint
ALTER TABLE ONLY stock_receipt_confirmations
    ADD CONSTRAINT fk_stock_receipt_confirmations_confirmed_by FOREIGN KEY (confirmed_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY stock_receipt_confirmations
    ADD CONSTRAINT fk_stock_receipt_confirmations_document FOREIGN KEY (document_id) REFERENCES documents(id);
--> statement-breakpoint
ALTER TABLE ONLY stock_receipt_confirmations
    ADD CONSTRAINT fk_stock_receipt_confirmations_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY transactions
    ADD CONSTRAINT fk_transactions_document_id FOREIGN KEY (document_id) REFERENCES documents(id);
--> statement-breakpoint
ALTER TABLE ONLY transactions
    ADD CONSTRAINT fk_transactions_item_id FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT fk_treasury_transactions_bank_account_id FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT fk_treasury_transactions_cheque_id FOREIGN KEY (cheque_id) REFERENCES cheques(id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT fk_treasury_transactions_contra_account FOREIGN KEY (contra_account_id) REFERENCES accounts(id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT fk_treasury_transactions_created_by_id FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT fk_treasury_transactions_document_id FOREIGN KEY (document_id) REFERENCES documents(id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT fk_treasury_transactions_payroll_id FOREIGN KEY (payroll_id) REFERENCES piecework_payrolls(id);
--> statement-breakpoint
ALTER TABLE ONLY treasury_transactions
    ADD CONSTRAINT fk_treasury_transactions_voucher_id FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id);
--> statement-breakpoint
ALTER TABLE ONLY user_messenger_links
    ADD CONSTRAINT fk_user_messenger_links_user FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY user_notification_preferences
    ADD CONSTRAINT fk_user_notification_preferences_user FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY user_sessions
    ADD CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY users
    ADD CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles(code) ON UPDATE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY wc_product_links
    ADD CONSTRAINT fk_wc_product_links_item FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY wc_sync_runs
    ADD CONSTRAINT fk_wc_sync_runs_user FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY webhook_deliveries
    ADD CONSTRAINT fk_webhook_deliveries_subscription FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY webhook_subscriptions
    ADD CONSTRAINT fk_webhook_subscriptions_created_by FOREIGN KEY (created_by) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_history_logs
    ADD CONSTRAINT fk_wf_history_instance FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY workflow_instances
    ADD CONSTRAINT fk_wf_instances_definition FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_pending_approvals
    ADD CONSTRAINT fk_wf_pending_instance FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY workflow_states
    ADD CONSTRAINT fk_wf_states_definition FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_tasks
    ADD CONSTRAINT fk_wf_tasks_instance FOREIGN KEY (instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY workflow_transitions
    ADD CONSTRAINT fk_wf_transitions_definition FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_transitions
    ADD CONSTRAINT fk_wf_transitions_from_state FOREIGN KEY (from_state_id) REFERENCES workflow_states(id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_transitions
    ADD CONSTRAINT fk_wf_transitions_to_state FOREIGN KEY (to_state_id) REFERENCES workflow_states(id);
--> statement-breakpoint
ALTER TABLE ONLY workflow_definition_versions
    ADD CONSTRAINT fk_wf_versions_definition FOREIGN KEY (definition_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY woocommerce_order_logs
    ADD CONSTRAINT fk_woocommerce_order_logs_erp_document_id FOREIGN KEY (erp_document_id) REFERENCES documents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT fk_workshop_task_reports_created_by FOREIGN KEY (created_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT fk_workshop_task_reports_personnel FOREIGN KEY (personnel_id) REFERENCES personnel(id);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT fk_workshop_task_reports_piecework_log FOREIGN KEY (piecework_log_id) REFERENCES piecework_logs(id);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT fk_workshop_task_reports_project FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT fk_workshop_task_reports_reviewed_by FOREIGN KEY (reviewed_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT fk_workshop_task_reports_stage FOREIGN KEY (stage_id) REFERENCES project_stages(id);
--> statement-breakpoint
ALTER TABLE ONLY workshop_task_reports
    ADD CONSTRAINT fk_workshop_task_reports_task FOREIGN KEY (task_id) REFERENCES piecework_tasks(id);
--> statement-breakpoint
ALTER TABLE ONLY inventory_reconciliation_anomalies
    ADD CONSTRAINT inventory_reconciliation_anomalies_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY inventory_reconciliation_anomalies
    ADD CONSTRAINT inventory_reconciliation_anomalies_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY item_code_history
    ADD CONSTRAINT item_code_history_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY item_code_history
    ADD CONSTRAINT item_code_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY item_opening_voucher_items
    ADD CONSTRAINT item_opening_voucher_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY item_opening_voucher_items
    ADD CONSTRAINT item_opening_voucher_items_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES journal_vouchers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY item_warehouse_stocks
    ADD CONSTRAINT item_warehouse_stocks_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY item_warehouse_stocks
    ADD CONSTRAINT item_warehouse_stocks_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY items_stocks_archive
    ADD CONSTRAINT items_stocks_archive_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT journal_vouchers_source_bom_allocation_id_fkey FOREIGN KEY (source_bom_allocation_id) REFERENCES project_bom_allocations(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT journal_vouchers_source_cheque_id_fkey FOREIGN KEY (source_cheque_id) REFERENCES cheques(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT journal_vouchers_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES documents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY journal_vouchers
    ADD CONSTRAINT journal_vouchers_source_payroll_id_fkey FOREIGN KEY (source_payroll_id) REFERENCES piecework_payrolls(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY project_product_stage_progress
    ADD CONSTRAINT project_product_stage_progress_item_id_fkey FOREIGN KEY (item_id) REFERENCES items(id);
--> statement-breakpoint
ALTER TABLE ONLY project_product_stage_progress
    ADD CONSTRAINT project_product_stage_progress_project_id_fkey FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY project_reservation_releases
    ADD CONSTRAINT project_reservation_releases_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY project_reservation_releases
    ADD CONSTRAINT project_reservation_releases_project_id_fkey FOREIGN KEY (project_id) REFERENCES production_projects(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_assigned_to_id_fkey FOREIGN KEY (assigned_to_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_project_id_fkey FOREIGN KEY (project_id) REFERENCES production_projects(id);
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_requested_by_id_fkey FOREIGN KEY (requested_by_id) REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE ONLY purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_workflow_instance_id_fkey FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id);
--> statement-breakpoint
ALTER TABLE ONLY ref_fiscal_year_corrections
    ADD CONSTRAINT ref_fiscal_year_corrections_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id);
--> statement-breakpoint
INSERT INTO roles (id, name, code, description, permissions, is_system) VALUES (1, 'مدیر سیستم', 'admin', 'همه مجوزها را همیشه دارد؛ مجوزهایش ویرایش نمی‌شود و حذف نمی‌شود', '[]', 1);
--> statement-breakpoint
INSERT INTO activity_logs (id, user_id, username, user_full_name, action, entity, entity_id, description, details, ip_address, "timestamp", trace_id) VALUES (1, NULL, 'system', 'سیستم', 'CREATE', 'نقش و دسترسی', '1', 'مهاجرت مدل مجوز: نقش ثابت "مدیر سیستم" ساخته شد', '{"roleId": 1, "roleCode": "admin", "roleName": "مدیر سیستم", "migration": "0066_system_admin_role"}', '', now(), '');
--> statement-breakpoint
INSERT INTO warehouses (id, name, code, is_active) VALUES (1, 'انبار مرکزی', 'main', 1);
--> statement-breakpoint
INSERT INTO media_sections (id, kind, title, description, sort_order, created_by, created_at, updated_at, version, is_deleted) VALUES (1, 'products', 'محصولات', 'تصویرها و فیلم‌های هر محصول', 0, 'سیستم', now(), now(), 1, 0);
--> statement-breakpoint
SELECT pg_catalog.setval('activity_logs_id_seq', 1, true);
--> statement-breakpoint
SELECT pg_catalog.setval('media_sections_id_seq', 1, true);
--> statement-breakpoint
SELECT pg_catalog.setval('piecework_payroll_number_seq', 1001, false);
--> statement-breakpoint
SELECT pg_catalog.setval('roles_id_seq', 1, true);
--> statement-breakpoint
SELECT pg_catalog.setval('warehouses_id_seq', 1, true);
--> statement-breakpoint
SET LOCAL check_function_bodies = DEFAULT;
