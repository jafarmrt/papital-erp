-- v11 phase 8.4b (docs/roadmap/V11_STOREFRONT_8_4B_SMS_LOGIN_START_PLAN.md): when a buyer account's phone was proven by
-- an SMS code (a sign-up or a wholesale form with a phone proof, or an SMS sign-in). Null = not proven (the accounts of
-- 8.2b part 1, made before SMS). Package 18; no existing row changes.
ALTER TABLE storefront_buyer_accounts ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
