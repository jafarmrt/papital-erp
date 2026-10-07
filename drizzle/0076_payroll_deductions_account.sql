-- Drizzle Migration 0076: the «کسورات حقوق پرداختنی» account for payslip deductions (v9.0.270 / TD-554)
--
-- Product-owner decision t6 (option a, package 3): the employee share of insurance and income tax withheld on a payslip
-- is owed to the social security organisation and the tax office, so it gets its own standard subsidiary account
-- «کسورات حقوق پرداختنی (بیمه و مالیات سهم کارکنان)» (code 3205 under the general account 32, liability, credit) and
-- the default of the account mapping key employeeDeductionsPayableAccountCode moves to it from 3202, whose standard
-- name is «پیش‌دریافت‌ها از مشتریان». Vouchers already posted to 3202 are not moved; the financial health check lists
-- them (payroll_deductions_in_customer_prepayments) so the accountant moves them with a correction voucher.
--
-- The account is created only when the chart already has the general account 32 and no active account uses code 3205;
-- on an empty database the standard chart seed creates it. Every save of the mapping form stored all keys, defaults
-- included, and before v9.0.199 the form had no row for this key, so a stored mapping that still holds the old default
-- 3202 is moved to 3205 when 3205 is an active liability subsidiary under 32; the change is written to activity_logs.
-- A stored value that is not JSON is left as it is.

INSERT INTO "accounts" ("code", "name", "level", "parent_id", "account_type", "nature", "is_system", "is_active", "is_deleted")
SELECT '3205', 'کسورات حقوق پرداختنی (بیمه و مالیات سهم کارکنان)', 'subsidiary', p."id", 'liability', 'credit', 1, 1, 0
FROM "accounts" p
WHERE p."code" = '32' AND COALESCE(p."is_deleted", 0) = 0
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."code" = '3205' AND COALESCE(a."is_deleted", 0) = 0)
ORDER BY p."id"
LIMIT 1;
--> statement-breakpoint

DO $$
DECLARE
  stored jsonb;
BEGIN
  BEGIN
    SELECT value::jsonb INTO stored FROM app_settings WHERE key = 'accounting_account_mappings';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'migration 0076: the stored account mapping is not JSON and was left unchanged';
    RETURN;
  END;
  IF stored IS NULL OR jsonb_typeof(stored) <> 'object' OR stored->>'employeeDeductionsPayableAccountCode' IS DISTINCT FROM '3202' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM accounts a JOIN accounts p ON p.id = a.parent_id
     WHERE a.code = '3205' AND COALESCE(a.is_deleted, 0) = 0 AND COALESCE(a.is_active, 1) = 1
       AND a.level = 'subsidiary' AND a.account_type = 'liability' AND p.code = '32' AND COALESCE(p.is_deleted, 0) = 0
  ) THEN
    RETURN;
  END IF;
  UPDATE app_settings
     SET value = jsonb_set(stored, '{employeeDeductionsPayableAccountCode}', '"3205"')::text
   WHERE key = 'accounting_account_mappings';
  INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
  VALUES ('system', 'سیستم', 'UPDATE', 'حسابداری:نگاشت_مفهومی_سرفصل‌ها', 'employeeDeductionsPayableAccountCode',
    'مهاجرت کسورات حقوق: نگاشت «کسورات حقوق پرداختنی» از پیش‌فرض پیشین ۳۲۰۲ (پیش‌دریافت‌ها از مشتریان) به ۳۲۰۵ رفت؛ سندهای گذشته جابه‌جا نشد',
    jsonb_build_object('key', 'employeeDeductionsPayableAccountCode', 'before', '3202', 'after', '3205',
      'migration', '0076_payroll_deductions_account'),
    '', now() AT TIME ZONE 'UTC');
END $$;
