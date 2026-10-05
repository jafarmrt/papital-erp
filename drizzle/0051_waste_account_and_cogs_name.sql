-- Drizzle Migration 0051: the «ضایعات و افت کیفی» account and the names of 6001 / 6003 (v8.0.114 / TD-413)
--
-- Product-owner decision (13 Mehr 1405, option a): account 6001 receives the cost of goods sold, so its name becomes
-- «بهای تمام‌شده کالای فروش‌رفته» (it was «هزینه مواد اولیه مصرفی در تولید»); waste gets its own account
-- «ضایعات و افت کیفی» (code 6004 under the general account 60, nature debit), configurable through the account
-- mapping key wasteExpenseAccountCode, and 6003 keeps only the workshop overhead.
--
-- Vouchers already posted to 6003 for waste are not moved. The account is created only when the chart already has the
-- general account 60 and no active account uses code 6004; on an empty database the standard chart seed creates it.
-- A name is changed only while it is still the old standard name, so an account the user renamed keeps its name. The
-- UPDATE runs through erp_update_with_unvalidated_checks (0047) because accounts can hold NOT VALID CHECK constraints.

INSERT INTO "accounts" ("code", "name", "level", "parent_id", "account_type", "nature", "is_system", "is_active", "is_deleted")
SELECT '6004', 'ضایعات و افت کیفی', 'subsidiary', p."id", 'cost_of_sales', 'debit', 1, 1, 0
FROM "accounts" p
WHERE p."code" = '60' AND COALESCE(p."is_deleted", 0) = 0
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."code" = '6004' AND COALESCE(a."is_deleted", 0) = 0)
ORDER BY p."id"
LIMIT 1;
--> statement-breakpoint

SELECT erp_update_with_unvalidated_checks('accounts', $sql$
UPDATE accounts SET name = 'بهای تمام‌شده کالای فروش‌رفته'
WHERE code = '6001' AND name = 'هزینه مواد اولیه مصرفی در تولید'
$sql$);
--> statement-breakpoint

SELECT erp_update_with_unvalidated_checks('accounts', $sql$
UPDATE accounts SET name = 'سربار ساخت و هزینه‌های کارگاه (پخت، برق)'
WHERE code = '6003' AND name = 'سربار ساخت و هزینه‌های کارگاه (پخت، برق، ضایعات)'
$sql$);
