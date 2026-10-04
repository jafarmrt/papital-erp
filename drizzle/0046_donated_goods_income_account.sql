-- Drizzle Migration 0046: the «درآمد کالای اهدایی» account for free goods in receipts and purchases (v8.0.17 / TD-268)
--
-- Product-owner decision (option b): a receipt or purchase line with no net price (free goods) enters stock at the
-- item's current weighted average cost, and its voucher debits inventory and credits one new revenue account
-- «درآمد کالای اهدایی» (code 5204 under the general account 52), configurable through the account mapping key
-- donatedGoodsIncomeAccountCode. Earlier receipts are not reposted.
--
-- The account is created here only when the chart already has the general account 52 and no active account uses
-- code 5204; on an empty database the standard chart seed creates it.

INSERT INTO "accounts" ("code", "name", "level", "parent_id", "account_type", "nature", "is_system", "is_active", "is_deleted")
SELECT '5204', 'درآمد کالای اهدایی', 'subsidiary', p."id", 'revenue', 'credit', 1, 1, 0
FROM "accounts" p
WHERE p."code" = '52' AND COALESCE(p."is_deleted", 0) = 0
  AND NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."code" = '5204' AND COALESCE(a."is_deleted", 0) = 0)
ORDER BY p."id"
LIMIT 1;
