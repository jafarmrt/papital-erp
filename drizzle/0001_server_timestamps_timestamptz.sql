-- v11 phase 4.2: server timestamps become timestamptz.
-- Every server-written timestamp column held UTC wall-clock time in a plain timestamp column, correct only because the
-- process and the session both run in UTC. Each one now stores the instant itself. The stored values were UTC, so
-- `USING col AT TIME ZONE 'UTC'` keeps every instant unchanged.
-- Two business dates stay plain timestamp on purpose: documents.date (and its document_date twin in
-- ref_fiscal_year_corrections) and transactions.date are Tehran wall-clock dates that fiscal numbering, filters and
-- "today" are built on.
-- Each ALTER TABLE rewrites its table once, so the conversion briefly needs free disk about the size of the table.
ALTER TABLE _repair_0011_timestamps_backup
  ALTER COLUMN backed_up_at TYPE timestamptz USING backed_up_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE accounting_settings
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE accounts
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE activity_logs
  ALTER COLUMN "timestamp" TYPE timestamptz USING "timestamp" AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE bank_accounts
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE birthday_greetings
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE cheques
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE crm_activities
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE crm_lead_stage_history
  ALTER COLUMN changed_at TYPE timestamptz USING changed_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE crm_leads
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE customer_tag_links
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE customer_tags
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE customers
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE daily_log_visibility_repairs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE daily_work_logs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE dead_letter_events
  ALTER COLUMN quarantined_at TYPE timestamptz USING quarantined_at AT TIME ZONE 'UTC',
  ALTER COLUMN resolved_at TYPE timestamptz USING resolved_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE documents
  ALTER COLUMN deleted_at TYPE timestamptz USING deleted_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE event_action_logs
  ALTER COLUMN executed_at TYPE timestamptz USING executed_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE event_action_rule_retirements
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE event_action_rules
  ALTER COLUMN last_executed_at TYPE timestamptz USING last_executed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE file_attachments
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE fiscal_periods
  ALTER COLUMN closed_at TYPE timestamptz USING closed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE form_drafts
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE idempotency_keys
  ALTER COLUMN locked_at TYPE timestamptz USING locked_at AT TIME ZONE 'UTC',
  ALTER COLUMN locked_until TYPE timestamptz USING locked_until AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE integration_delivery_jobs
  ALTER COLUMN next_attempt_at TYPE timestamptz USING next_attempt_at AT TIME ZONE 'UTC',
  ALTER COLUMN locked_at TYPE timestamptz USING locked_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE inventory_reconciliation_anomalies
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE item_code_history
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE item_opening_voucher_items
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE item_price_title_cleanup
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE item_prices
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE item_warehouse_stocks
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE items
  ALTER COLUMN last_kardex_rebuild_at TYPE timestamptz USING last_kardex_rebuild_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE items_stocks_archive
  ALTER COLUMN archived_at TYPE timestamptz USING archived_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE journal_voucher_items
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE journal_vouchers
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE legacy_date_repairs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE media_assets
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN deleted_at TYPE timestamptz USING deleted_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE media_sections
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE messenger_bots
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN wrong_codes_since TYPE timestamptz USING wrong_codes_since AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE messenger_link_codes
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE migrations_log
  ALTER COLUMN applied_at TYPE timestamptz USING applied_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE notifications
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN dismissed_at TYPE timestamptz USING dismissed_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE outbox_events
  ALTER COLUMN next_retry_at TYPE timestamptz USING next_retry_at AT TIME ZONE 'UTC',
  ALTER COLUMN occurred_at TYPE timestamptz USING occurred_at AT TIME ZONE 'UTC',
  ALTER COLUMN processed_at TYPE timestamptz USING processed_at AT TIME ZONE 'UTC',
  ALTER COLUMN locked_at TYPE timestamptz USING locked_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE payroll_eidi_rates
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE payroll_statutory_rates
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE pending_materials
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE personnel
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE petty_cash_expense_lines
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE piecework_logs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE piecework_payrolls
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE piecework_personnel_rates
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE piecework_task_rate_history
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE piecework_tasks
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE production_projects
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE project_bom_allocations
  ALTER COLUMN allocated_at TYPE timestamptz USING allocated_at AT TIME ZONE 'UTC',
  ALTER COLUMN consumed_at TYPE timestamptz USING consumed_at AT TIME ZONE 'UTC',
  ALTER COLUMN released_at TYPE timestamptz USING released_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE project_managers
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE project_reservation_releases
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN restored_at TYPE timestamptz USING restored_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE project_stages
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE purchase_requisitions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE ref_fiscal_year_corrections
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE statutory_remittance_lines
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE stock_receipt_confirmations
  ALTER COLUMN confirmed_at TYPE timestamptz USING confirmed_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE task_categories
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE transfers
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE treasury_transactions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE user_messenger_links
  ALTER COLUMN linked_at TYPE timestamptz USING linked_at AT TIME ZONE 'UTC',
  ALTER COLUMN unlinked_at TYPE timestamptz USING unlinked_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE user_notification_preferences
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE user_sessions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_seen_at TYPE timestamptz USING last_seen_at AT TIME ZONE 'UTC',
  ALTER COLUMN expires_at TYPE timestamptz USING expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN revoked_at TYPE timestamptz USING revoked_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE users
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE wc_product_links
  ALTER COLUMN last_read_at TYPE timestamptz USING last_read_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_pushed_at TYPE timestamptz USING last_pushed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE wc_sync_runs
  ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC',
  ALTER COLUMN finished_at TYPE timestamptz USING finished_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE webhook_deliveries
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE webhook_event_pattern_repairs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE webhook_subscriptions
  ALTER COLUMN last_delivery_at TYPE timestamptz USING last_delivery_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE woocommerce_order_logs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_definition_versions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_definitions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_delegations
  ALTER COLUMN start_date TYPE timestamptz USING start_date AT TIME ZONE 'UTC',
  ALTER COLUMN end_date TYPE timestamptz USING end_date AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_history_logs
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_instances
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_pending_approvals
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_task_reopen_log
  ALTER COLUMN due_at TYPE timestamptz USING due_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workflow_tasks
  ALTER COLUMN due_at TYPE timestamptz USING due_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN sla_reminded_at TYPE timestamptz USING sla_reminded_at AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE workshop_task_reports
  ALTER COLUMN reviewed_at TYPE timestamptz USING reviewed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';
--> statement-breakpoint
-- The stage-history backfill keeps its working instants in timestamptz too, so nothing passes through a session time zone.
CREATE OR REPLACE FUNCTION erp_backfill_crm_lead_stage_history() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  l record;
  ev record;
  v_has_live boolean;
  v_cutoff timestamptz;
  v_first_live_from text;
  v_target text;
  v_initial text;
  v_initial_source text;
  v_created timestamptz;
  v_prev text;
  v_prev_at timestamptz;
  v_to text;
  v_from text;
  v_at timestamptz;
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
    v_created := coalesce(l.created_at, l.updated_at, v_cutoff, now());
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
