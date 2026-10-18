-- Drizzle Migration 0126: v10.2.0 urgent fixes (package 1 of the 10.2 start plan)
--
-- 1. users.is_deleted took NULL. Login treated such a user as live, while the profile, the health check and the
--    restore treated it as not live. The column becomes NOT NULL DEFAULT 0. A NULL row becomes 0 (live, as login
--    saw it), except a row without a role (only a deleted user may hold no role, chk_users_role_active) and, only
--    where uq_users_username_key exists (migration 0124 builds it on clean data), a row whose username key
--    (lower(btrim(username))) another live user or an earlier NULL row already holds: setting it live would break that
--    index. Those become 1 (deleted); a row of a taken key is restored only after the other account of that username is
--    deleted. Without the index no key is taken and such a row stays live. Every changed user gets one activity_logs
--    row with the value before and after and the reason, and a WARNING counts the users marked deleted.
-- 2. webhook_subscriptions.retry_limit outside 1 to 10 (0, NULL, or 11 to 20 saved before v10.1.66) could not be saved
--    again from the form, and 0 was shown while 3 was used. Each such row takes the limit that delivery already used
--    (`webhookMaxAttempts`: 0 or NULL -> 3, below 1 -> 1, above 10 -> 10), with one activity_logs row each.
-- Runs inside the Drizzle migrator transaction; the updates go through erp_update_with_unvalidated_checks (0047).

CREATE TEMP TABLE tmp_users_null_deleted ON COMMIT DROP AS
WITH key_rule AS (
  SELECT to_regclass(format('%I.%I', current_schema(), 'uq_users_username_key')) IS NOT NULL AS index_present
), classified AS (
  SELECT u.id, u.username, u.full_name, u.role,
    CASE
      WHEN u.role IS NULL THEN 'no_role'
      WHEN (SELECT index_present FROM key_rule) AND (
        EXISTS (SELECT 1 FROM users o WHERE o.is_deleted = 0 AND lower(btrim(o.username)) = lower(btrim(u.username)))
        OR EXISTS (SELECT 1 FROM users o WHERE o.is_deleted IS NULL AND o.role IS NOT NULL AND o.id < u.id
                   AND lower(btrim(o.username)) = lower(btrim(u.username)))
      ) THEN 'username_key_taken'
      ELSE 'live'
    END AS reason
  FROM users u
  WHERE u.is_deleted IS NULL
)
SELECT c.id, c.username, c.full_name, c.role, CASE c.reason WHEN 'live' THEN 0 ELSE 1 END AS after, c.reason
FROM classified c;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('users', $sql$
UPDATE users u SET is_deleted = t.after FROM tmp_users_null_deleted t WHERE t.id = u.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'کاربران سیستم', t.id::text,
  CASE t.after
    WHEN 0 THEN format('مهاجرت ۰۱۲۶: ستون «حذف‌شده» کاربر "%s" خالی بود و «زنده» ثبت شد، همان‌طور که ورود او را می‌دید', coalesce(nullif(t.full_name, ''), t.username))
    ELSE format('مهاجرت ۰۱۲۶: ستون «حذف‌شده» کاربر "%s" خالی بود و «حذف‌شده» ثبت شد (%s)',
      coalesce(nullif(t.full_name, ''), t.username),
      CASE t.reason WHEN 'no_role' THEN 'نقش نداشت'
        ELSE 'نام کاربری‌اش در دست کاربر دیگری است؛ بازگرداندن او تنها پس از حذف آن حساب ممکن است' END)
  END,
  jsonb_build_object('userId', t.id, 'username', t.username, 'role', t.role,
    'before', jsonb_build_object('isDeleted', NULL), 'after', jsonb_build_object('isDeleted', t.after),
    'reason', t.reason, 'migration', '0126_users_deleted_flag_webhook_retry_limits'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_users_null_deleted t
ORDER BY t.id;
--> statement-breakpoint
DO $$
DECLARE
  no_role_count integer;
  key_taken_count integer;
BEGIN
  SELECT count(*) FILTER (WHERE reason = 'no_role'), count(*) FILTER (WHERE reason = 'username_key_taken')
    INTO no_role_count, key_taken_count
  FROM tmp_users_null_deleted;
  IF no_role_count + key_taken_count > 0 THEN
    RAISE WARNING 'users with an empty deleted flag were marked deleted: % without a role, % whose username another live account holds (restore after deleting that account); see the activity log', no_role_count, key_taken_count;
  END IF;
END $$;
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
