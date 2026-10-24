-- Drizzle Migration 0135: event privacy and the settings notice (10.3 package 5, decision ت۴۷ items 3 and 5)
--
-- 1. No amount or name in the stored rows of the event queue.
--    Since v10.2.7 (10.2 package 8, TD-1297) the treasury event («تراکنش خزانه تأیید شد») carries no amount, description
--    or void reason, and since v10.1.66 a payslip payment's treasury event carries no remaining balance either; from this
--    release the cheque status event («تغییر وضعیت چک») carries no amount and no party name. Rows written before those
--    releases still hold them in the outbox (outbox_events, kept 90 days once completed), the dead letter queue
--    (dead_letter_events) and the delivery jobs of webhooks and rules (integration_delivery_jobs.event). The product owner
--    chose to mask them, not to delete the rows: those keys are removed from the stored payload, every other key, the
--    row and its status stay, so a retried or replayed old event looks like a new one. A NOTICE counts the rows and one
--    activity_logs row records them.
-- 2. A change of «آستانه تراکنش کلان خزانه» notifies the system admins under the new notification category
--    `settings_change`, which a user may keep out of the messenger like the others: the category CHECK of
--    user_notification_preferences takes it.
-- Runs inside the migrator transaction; the updates go through erp_update_with_unvalidated_checks (0047).

CREATE TEMP TABLE tmp_event_private_keys ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('TreasuryTransactionApproved', ARRAY['amount', 'description', 'reason', 'remainingAmount']),
  ('ChequeStatusChanged', ARRAY['amount', 'partyName'])
) AS k(event_type, keys);
--> statement-breakpoint
CREATE TEMP TABLE tmp_event_mask_counts (source text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO tmp_event_mask_counts (source, n)
SELECT 'outbox_events', erp_update_with_unvalidated_checks('outbox_events', $sql$
UPDATE outbox_events o SET payload = o.payload - k.keys
FROM tmp_event_private_keys k
WHERE o.event_type = k.event_type AND jsonb_typeof(o.payload) = 'object' AND o.payload ?| k.keys
$sql$);
--> statement-breakpoint
INSERT INTO tmp_event_mask_counts (source, n)
SELECT 'dead_letter_events', erp_update_with_unvalidated_checks('dead_letter_events', $sql$
UPDATE dead_letter_events d SET payload = d.payload - k.keys
FROM tmp_event_private_keys k
WHERE d.event_type = k.event_type AND jsonb_typeof(d.payload) = 'object' AND d.payload ?| k.keys
$sql$);
--> statement-breakpoint
INSERT INTO tmp_event_mask_counts (source, n)
SELECT 'integration_delivery_jobs', erp_update_with_unvalidated_checks('integration_delivery_jobs', $sql$
UPDATE integration_delivery_jobs j SET event = jsonb_set(j.event, '{payload}', (j.event -> 'payload') - k.keys)
FROM tmp_event_private_keys k
WHERE j.event_type = k.event_type AND jsonb_typeof(j.event -> 'payload') = 'object' AND (j.event -> 'payload') ?| k.keys
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'رویدادهای سامانه', '0135',
  'مهاجرت ۰۱۳۵: مبلغ، شرح و نام طرف حساب از ردیف‌های قدیمی صف رویداد خزانه و چک پوشانده شد',
  jsonb_build_object('rows', jsonb_object_agg(c.source, c.n), 'migration', '0135_event_privacy_settings_notice'), '', now() AT TIME ZONE 'UTC'
FROM tmp_event_mask_counts c
HAVING sum(c.n) > 0;
--> statement-breakpoint
DO $$
DECLARE
  summary text;
BEGIN
  SELECT string_agg(format('%s %s', source, n), ', ' ORDER BY source) INTO summary FROM tmp_event_mask_counts WHERE n > 0;
  IF summary IS NOT NULL THEN
    RAISE NOTICE 'Migration 0135: amounts and names masked in old event rows (%)', summary;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE user_notification_preferences DROP CONSTRAINT IF EXISTS chk_user_notification_preferences_category;
--> statement-breakpoint
ALTER TABLE user_notification_preferences ADD CONSTRAINT chk_user_notification_preferences_category CHECK (category IN (
  'workflow_task', 'workflow_sla', 'payslip', 'mention', 'daily_log_review', 'crm_followup', 'crm_won', 'event_rule',
  'workshop', 'settings_change'
));
