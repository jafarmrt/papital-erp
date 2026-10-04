-- Drizzle Migration 0045: the «کسری و اضافات انبار» account for stock-count and Excel stock adjustments (v8.0.3 / TD-255)
--
-- Product-owner decision (12 Mehr 1405): stock-count shortages and surpluses are posted against one new account
-- «کسری و اضافات انبار» (code 7012 under the general account 70, nature both), configurable through the account
-- mapping key inventoryCountDifferenceAccountCode. Earlier stock counts get no voucher (nothing is recomputed).
--
-- The account is created here only when the chart already has the general account 70 and no active account uses
-- code 7012; on an empty database the standard chart seed creates it.

INSERT INTO "accounts" ("code", "name", "level", "parent_id", "account_type", "nature", "is_system", "is_active", "is_deleted")
SELECT '7012', 'کسری و اضافات انبار', 'subsidiary', p."id", 'expense', 'both', 1, 1, 0
FROM "accounts" p
WHERE p."code" = '70' AND COALESCE(p."is_deleted", 0) = 0
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."code" = '7012' AND COALESCE(a."is_deleted", 0) = 0)
ORDER BY p."id"
LIMIT 1;
