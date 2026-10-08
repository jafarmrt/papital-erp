-- Drizzle Migration 0090: foreign keys of webhook deliveries and rule action logs (v9.0.445 / TD-611, finding B01-31,
-- product-owner decision t6 «الف» of package 1)
--
-- The Drizzle schema declares webhook_deliveries.subscription_id ON DELETE CASCADE and event_action_logs.rule_id
-- ON DELETE SET NULL, but the database had neither constraint: deleting a webhook subscription or a rule left its
-- delivery rows and its log rows pointing to an id that no longer exists. Each foreign key is added with its declared
-- ON DELETE, NOT VALID (enforced for new rows at once), and validated only when no existing row breaks it; old rows are
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
      ('fk_webhook_deliveries_subscription', 'webhook_deliveries', 'subscription_id', 'webhook_subscriptions', 'CASCADE'),
      ('fk_event_action_logs_rule', 'event_action_logs', 'rule_id', 'event_action_rules', 'SET NULL')
    ) AS t(name, tbl, col, ref, on_delete)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = fk.name AND connamespace = current_schema()::regnamespace
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (id) ON DELETE %s NOT VALID',
        fk.tbl, fk.name, fk.col, fk.ref, fk.on_delete);
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = c.%I))',
      fk.tbl, fk.col, fk.ref, fk.col) INTO orphan;
    IF orphan THEN
      RAISE NOTICE '% has rows whose % points to a missing % row; % left NOT VALID (see the financial health check)',
        fk.tbl, fk.col, fk.ref, fk.name;
    ELSE
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tbl, fk.name);
    END IF;
  END LOOP;
END $$;
