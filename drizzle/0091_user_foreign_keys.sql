-- Drizzle Migration 0091: foreign keys of the user columns (v9.0.446 / TD-902, findings B01-31 / B01-32,
-- product-owner decision t6 «الف» of package 1)
--
-- Sixteen columns that the Drizzle schema declares as references to users (who created or approved a voucher, a
-- treasury row, a cheque, a payroll or a work log; the owner of a daily log, a draft, a notification or a personnel link;
-- who resolved a dead letter, who created a rule or a webhook) had no database constraint, so a row could keep a user id
-- that does not exist. Users are only soft-deleted, so the constraint never blocks an application path; the factory
-- reset removes the referencing rows before the users. The user columns of the workflow engine stay without a foreign
-- key by the package 14 rule (AGENTS §14.3) and are listed in FOREIGN_KEY_EXCEPTIONS (src/db/foreignKeyPolicy.ts).
--
-- Each foreign key is added with the ON DELETE its declaration names (form_drafts.user_id CASCADE, the others NO
-- ACTION), NOT VALID (enforced for new rows at once), and validated only when no existing row breaks it; old rows are
-- never changed or deleted here. A constraint left unvalidated is listed by the financial health check
-- (conditional_constraints_missing) and validated by the system admin once the data is clean. Runs inside the Drizzle
-- migrator transaction.

DO $$
DECLARE
  fk record;
  orphan boolean;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('fk_cheques_created_by_id', 'cheques', 'created_by_id', 'NO ACTION'),
      ('fk_daily_work_logs_user_id', 'daily_work_logs', 'user_id', 'NO ACTION'),
      ('fk_dead_letter_events_resolved_by', 'dead_letter_events', 'resolved_by', 'NO ACTION'),
      ('fk_event_action_rules_created_by', 'event_action_rules', 'created_by', 'NO ACTION'),
      ('fk_form_drafts_user_id', 'form_drafts', 'user_id', 'CASCADE'),
      ('fk_journal_vouchers_approved_by_id', 'journal_vouchers', 'approved_by_id', 'NO ACTION'),
      ('fk_journal_vouchers_created_by_id', 'journal_vouchers', 'created_by_id', 'NO ACTION'),
      ('fk_notifications_sender_id', 'notifications', 'sender_id', 'NO ACTION'),
      ('fk_notifications_user_id', 'notifications', 'user_id', 'NO ACTION'),
      ('fk_personnel_user_id', 'personnel', 'user_id', 'NO ACTION'),
      ('fk_piecework_logs_created_by_id', 'piecework_logs', 'created_by_id', 'NO ACTION'),
      ('fk_piecework_payrolls_created_by_id', 'piecework_payrolls', 'created_by_id', 'NO ACTION'),
      ('fk_piecework_task_rate_history_changed_by_user_id', 'piecework_task_rate_history', 'changed_by_user_id', 'NO ACTION'),
      ('fk_project_bom_allocations_user_id', 'project_bom_allocations', 'user_id', 'NO ACTION'),
      ('fk_treasury_transactions_created_by_id', 'treasury_transactions', 'created_by_id', 'NO ACTION'),
      ('fk_webhook_subscriptions_created_by', 'webhook_subscriptions', 'created_by', 'NO ACTION')
    ) AS t(name, tbl, col, on_delete)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = fk.name AND connamespace = current_schema()::regnamespace
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users (id) ON DELETE %s NOT VALID',
        fk.tbl, fk.name, fk.col, fk.on_delete);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users p WHERE p.id = c.%I))',
      fk.tbl, fk.col, fk.col) INTO orphan;
    IF orphan THEN
      RAISE NOTICE '% has rows whose % points to a missing user; % left NOT VALID (see the financial health check)',
        fk.tbl, fk.col, fk.name;
    ELSE
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tbl, fk.name);
    END IF;
  END LOOP;
END $$;
