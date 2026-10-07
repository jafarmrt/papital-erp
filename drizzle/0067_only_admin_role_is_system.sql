-- Drizzle Migration 0067: only the system admin role stays a system role
-- (v9.0.118 / TD-885, permission model rule 4 and decision t9 option A)
--
-- Until v9.0.117 the seed created twelve roles with is_system = 1, and DELETE /roles refused every one of them, so an
-- install had to keep «مدیر عمومی», «انباردار» and the others whether it used them or not. From v9.0.118 the system
-- admin (code admin) is the only fixed role: every other role, a former seed role included, is an ordinary role that
-- the admin renames, edits and deletes (when no user, workflow step or running workflow needs it).
--
-- The roles keep their users, names and permissions; only the flag changes: is_system becomes 1 for the admin row and
-- 0 for every other row (NULL counts as 0). Every changed row gets one activity_logs row (entity «نقش و دسترسی»,
-- username system) with the flag before and after. Runs inside the migrator transaction.

CREATE TEMP TABLE tmp_role_system_flag ON COMMIT DROP AS
SELECT r.id, r.code, r.name, r.is_system AS before, CASE WHEN r.code = 'admin' THEN 1 ELSE 0 END AS after
FROM roles r
WHERE r.is_system IS DISTINCT FROM CASE WHEN r.code = 'admin' THEN 1 ELSE 0 END;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET is_system = c.after FROM tmp_role_system_flag c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  CASE WHEN c.after = 0
    THEN format('مهاجرت مدل مجوز: نقش "%s" نقش عادی شد و مثل هر نقش دیگری ویرایش و حذف می‌شود', c.name)
    ELSE format('مهاجرت مدل مجوز: نقش "%s" نقش ثابت مدیر سیستم شد', c.name)
  END,
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code,
    'beforeIsSystem', c.before, 'afterIsSystem', c.after, 'migration', '0067_only_admin_role_is_system'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_role_system_flag c
ORDER BY c.id;
