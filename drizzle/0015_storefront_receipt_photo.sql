-- v11 phase 8.2a, part 2 (docs/roadmap/V11_STOREFRONT_8_2_START_PLAN.md §5): the receipt photo and the order notices.
-- 1. file_attachments takes the entity type storefront_receipt (the photo of a card-to-card receipt; the general
--    attachment route never serves it, only the site orders page does).
-- 2. the notification category site_order (a new site order, a new card-to-card receipt): a user may turn its messenger
--    copy off like any other category, so the category check of user_notification_preferences takes the new value.
-- Only two check constraints are widened; no row is changed. Runs inside the Drizzle migrator transaction.

ALTER TABLE file_attachments DROP CONSTRAINT IF EXISTS chk_file_attachments_entity_type;
--> statement-breakpoint
ALTER TABLE file_attachments ADD CONSTRAINT chk_file_attachments_entity_type CHECK ((entity_type = ANY (ARRAY['document'::text, 'journal_voucher'::text, 'cheque'::text, 'treasury_transaction'::text, 'production_project'::text, 'piecework_payroll'::text, 'crm_lead'::text, 'crm_activity'::text, 'storefront_receipt'::text])));
--> statement-breakpoint

ALTER TABLE user_notification_preferences DROP CONSTRAINT IF EXISTS chk_user_notification_preferences_category;
--> statement-breakpoint
ALTER TABLE user_notification_preferences ADD CONSTRAINT chk_user_notification_preferences_category CHECK ((category = ANY (ARRAY['workflow_task'::text, 'workflow_sla'::text, 'payslip'::text, 'mention'::text, 'daily_log_review'::text, 'crm_followup'::text, 'crm_won'::text, 'event_rule'::text, 'workshop'::text, 'settings_change'::text, 'site_order'::text])));
