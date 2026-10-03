-- Drizzle Migration 0033: structured shipping / fee charges on sales invoices and the «درآمد حمل و خدمات» account (v7.0.103 / TD-191)
--
-- Product-owner decision «ثبت کامل»: a WooCommerce order's shipping_lines and fee_lines are recorded on its invoice
-- (documents.service_charge_amount) and credited to a new revenue account «درآمد حمل و خدمات» (code 5004 under the
-- general account 50); the order's total_tax goes to documents.vat_amount, so the invoice total equals the amount paid.
--
-- Existing documents keep 0 (nothing is recomputed). The account is created here only when the chart already has the
-- general account 50 and no active account uses code 5004; on an empty database the standard chart seed creates it.

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "service_charge_amount" numeric(18, 4) DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "chk_documents_service_charge_amount_non_negative" CHECK ("service_charge_amount" >= 0);
--> statement-breakpoint
INSERT INTO "accounts" ("code", "name", "level", "parent_id", "account_type", "nature", "is_system", "is_active", "is_deleted")
SELECT '5004', 'درآمد حمل و خدمات', 'subsidiary', p."id", 'revenue', 'credit', 1, 1, 0
FROM "accounts" p
WHERE p."code" = '50' AND COALESCE(p."is_deleted", 0) = 0
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."code" = '5004' AND COALESCE(a."is_deleted", 0) = 0)
ORDER BY p."id"
LIMIT 1;
