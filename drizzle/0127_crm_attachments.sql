-- Drizzle Migration 0127: v10.2 package 7, image and PDF attachments of sales files and their activities (N-02 §3.3)
--
-- 1. chk_file_attachments_entity_type takes two more owner kinds, 'crm_lead' (a sales file) and 'crm_activity' (an
--    activity or follow-up). The list only widens; every stored row already satisfies it, so it is added valid.
-- 2. file_attachments.light_storage_path (nullable) holds the light version of an image attachment (WEBP, long side at
--    most 1600 px), made on the server next to the original, which is kept unchanged. A PDF and every older attachment
--    have none. Runs inside the Drizzle migrator transaction.

ALTER TABLE file_attachments DROP CONSTRAINT IF EXISTS chk_file_attachments_entity_type;
--> statement-breakpoint
ALTER TABLE file_attachments ADD CONSTRAINT chk_file_attachments_entity_type CHECK (entity_type IN (
  'document', 'journal_voucher', 'cheque', 'treasury_transaction', 'production_project', 'piecework_payroll',
  'crm_lead', 'crm_activity'
));
--> statement-breakpoint
ALTER TABLE file_attachments ADD COLUMN IF NOT EXISTS light_storage_path text;
