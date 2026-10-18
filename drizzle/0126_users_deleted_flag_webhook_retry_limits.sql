-- Drizzle Migration 0126: v10.2.0 urgent fixes (package 1 of the 10.2 start plan)
--
-- 1. users.is_deleted took NULL. Login treated such a user as live, while the profile, the health check and the
--    restore treated it as not live. The column becomes NOT NULL DEFAULT 0. A NULL row becomes 0 (live, as login
--    saw it), except a row without a role (only a deleted user may hold no role, chk_users_role_active) and a row
--    whose username key (lower(btrim(username)), uq_users_username_key) another live user or an earlier NULL row
--    already holds: those become 1 (deleted) and are restored by the administrator. Every changed user gets one
--    activity_logs row with the value before and after and the reason.
-- 2. webhook_subscriptions.retry_limit outside 1 to 10 (0, NULL, or 11 to 20 saved before v10.1.66) could not be saved
--    again from the form, and 0 was shown while 3 was used. Each such row takes the limit that delivery already used
--    (`webhookMaxAttempts`: 0 or NULL -> 3, below 1 -> 1, above 10 -> 10), with one activity_logs row each.
-- Runs inside the Drizzle migrator transaction; the updates go through erp_update_with_unvalidated_checks (0047).

CREATE TEMP TABLE tmp_users_null_deleted ON COMMIT DROP AS
SELECT u.id, u.username, u.full_name, u.role,
  CASE
    WHEN u.role IS NULL THEN 1
    WHEN EXISTS (SELECT 1 FROM users o WHERE o.is_deleted = 0 AND lower(btrim(o.username)) = lower(btrim(u.username))) THEN 1
    WHEN EXISTS (SELECT 1 FROM users o WHERE o.is_deleted IS NULL AND o.role IS NOT NULL AND o.id < u.id
                 AND lower(btrim(o.username)) = lower(btrim(u.username))) THEN 1
    ELSE 0
  END AS after,
  CASE
    WHEN u.role IS NULL THEN 'no_role'
    WHEN EXISTS (SELECT 1 FROM users o WHERE o.is_deleted = 0 AND lower(btrim(o.username)) = lower(btrim(u.username))) THEN 'username_key_taken'
    WHEN EXISTS (SELECT 1 FROM users o WHERE o.is_deleted IS NULL AND o.role IS NOT NULL AND o.id < u.id
                 AND lower(btrim(o.username)) = lower(btrim(u.username))) THEN 'username_key_taken'
    ELSE 'live'
  END AS reason
FROM users u
WHERE u.is_deleted IS NULL;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('users', $sql$
UPDATE users u SET is_deleted = t.after FROM tmp_users_null_deleted t WHERE t.id = u.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'کاربران سیستم', t.id::text,
  CASE t.after
    WHEN 0 THEN format('مهاجرت ۰۱۲۶: ستون «حذف‌شده» کاربر "%s" خالی بود و «زنده» ثبت شد، همان‌طور که ورود او را می‌دید', coalesce(nullif(t.full_name, ''), t.username))
    ELSE format('مهاجرت ۰۱۲۶: ستون «حذف‌شده» کاربر "%s" خالی بود و «حذف‌شده» ثبت شد (%s)؛ مدیر سامانه می‌تواند او را بازگرداند',
      coalesce(nullif(t.full_name, ''), t.username),
      CASE t.reason WHEN 'no_role' THEN 'نقش نداشت' ELSE 'نام کاربری‌اش از آنِ کاربر دیگری است' END)
  END,
  jsonb_build_object('userId', t.id, 'username', t.username, 'role', t.role,
    'before', jsonb_build_object('isDeleted', NULL), 'after', jsonb_build_object('isDeleted', t.after),
    'reason', t.reason, 'migration', '0126_users_deleted_flag_webhook_retry_limits'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_users_null_deleted t
ORDER BY t.id;
--> statement-breakpoint
ALTER TABLE users ALTER COLUMN is_deleted SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE users ALTER COLUMN is_deleted SET NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE tmp_webhook_retry_limits ON COMMIT DROP AS
SELECT w.id, w.name, w.retry_limit AS before,
  CASE WHEN w.retry_limit IS NULL OR w.retry_limit = 0 THEN 3 WHEN w.retry_limit < 1 THEN 1 ELSE 10 END AS after
FROM webhook_subscriptions w
WHERE w.retry_limit IS NULL OR w.retry_limit < 1 OR w.retry_limit > 10;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('webhook_subscriptions', $sql$
UPDATE webhook_subscriptions w SET retry_limit = t.after FROM tmp_webhook_retry_limits t WHERE t.id = w.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'اشتراک وب‌هوک: ' || t.name, t.id::text,
  format('مهاجرت ۰۱۲۶: تعداد تلاش اشتراک وب‌هوک "%s" از «%s» به %s رسید، همان عددی که ارسال تاکنون به کار می‌برد',
    t.name, coalesce(t.before::text, 'خالی'), t.after),
  jsonb_build_object('subscriptionId', t.id, 'before', jsonb_build_object('retryLimit', t.before),
    'after', jsonb_build_object('retryLimit', t.after), 'migration', '0126_users_deleted_flag_webhook_retry_limits'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_webhook_retry_limits t
ORDER BY t.id;
