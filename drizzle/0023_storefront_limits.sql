-- v12 phase 8b (docs/roadmap/V12_SITE_NEXT_START_PLAN.md §5, site review 2.7 and 2.11): the limits of the new site.
--
-- storefront_orders.approval_reminded_at: when the colleagues who handle site orders got the bell that an «به حساب»
--   order's wait for their confirmation runs out (APPROVAL_REMINDER_HOURS before reserve_until); null = not yet, so the
--   minute sweep rings it once. Existing orders were never reminded: null describes them.
-- The notification category site_sms (a budget of the site's texts, login codes or order texts, is nearly spent): the
--   category check of user_notification_preferences takes the new value.
-- The two new settings (sf_approval_hours, sf_sms_order_hourly_cap) live in app_settings and need no change here: until
--   the owner saves them, an «به حساب» order waits 72 hours and order texts have a budget of 200 an hour of their own.
-- Runs inside the Drizzle migrator transaction.

ALTER TABLE storefront_orders ADD COLUMN IF NOT EXISTS approval_reminded_at timestamptz;
--> statement-breakpoint
ALTER TABLE user_notification_preferences DROP CONSTRAINT IF EXISTS chk_user_notification_preferences_category;
--> statement-breakpoint
ALTER TABLE user_notification_preferences ADD CONSTRAINT chk_user_notification_preferences_category CHECK ((category = ANY (ARRAY['workflow_task'::text, 'workflow_sla'::text, 'payslip'::text, 'mention'::text, 'daily_log_review'::text, 'crm_followup'::text, 'crm_won'::text, 'event_rule'::text, 'workshop'::text, 'settings_change'::text, 'site_order'::text, 'site_buyer'::text, 'site_inquiry'::text, 'site_sms'::text])));
