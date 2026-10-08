-- Drizzle Migration 0084: rule actions «workflow_trigger» and «sms_simulation» retired (v9.0.364 / TD-712, product-owner decision t4 a)
--
-- The «workflow_trigger» action of an automatic event rule did nothing and reported «queued», and «sms_simulation» only
-- wrote a log line. Both action types were removed: a rule is created or activated only with an in-app notification,
-- a webhook or an audit-log action. Every existing rule of a removed type is recorded in event_action_rule_retirements
-- (its name, type, configuration and whether it was active) and deactivated; the rule itself is kept, so its owner can
-- change its action type or delete it. The financial health check lists such rules (event_rule_retired_action).
-- Runs inside the Drizzle migrator transaction.

CREATE TABLE IF NOT EXISTS event_action_rule_retirements (
  id serial PRIMARY KEY,
  rule_id integer NOT NULL,
  rule_name text NOT NULL DEFAULT '',
  action_type text NOT NULL,
  was_active integer NOT NULL,
  action_config jsonb,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT uq_event_action_rule_retirements_rule UNIQUE (rule_id),
  CONSTRAINT chk_event_action_rule_retirements_was_active_flag CHECK (was_active IN (0, 1))
);
--> statement-breakpoint
INSERT INTO event_action_rule_retirements (rule_id, rule_name, action_type, was_active, action_config)
SELECT r.id, coalesce(r.name, ''), r.action_type, CASE WHEN r.is_active = 1 THEN 1 ELSE 0 END, r.action_config_json
  FROM event_action_rules r
 WHERE r.action_type IN ('workflow_trigger', 'sms_simulation')
ON CONFLICT (rule_id) DO NOTHING;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('event_action_rules', $sql$
UPDATE event_action_rules
   SET is_active = 0, updated_at = now()
 WHERE action_type IN ('workflow_trigger', 'sms_simulation') AND is_active IS DISTINCT FROM 0
$sql$);
