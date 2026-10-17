-- Drizzle Migration 0123: closing sweep permission keys (v10.1.60, decision t40 items 5 and 6)
--
-- OBS-PR-13: the key audit.create («شروع دوره انبارگردانی») opened nothing: no server code ever asked it. It leaves the
-- catalog, so it is removed from every role that holds it (a stored key outside the catalog would refuse the role's next
-- save). OBS-R1-41: deleting a party gets its own key, customers.delete; so that no role loses anything on the day of
-- release, every role holding customers.manage gets it. The system admin role is skipped (its permissions are computed).
-- Every changed role gets one activity_logs row with the permissions before and after. Runs inside the Drizzle migrator
-- transaction.

CREATE TEMP TABLE tmp_closing_permission_roles ON COMMIT DROP AS
SELECT r.id, r.code, r.name, p.perms AS before,
  (CASE WHEN p.perms ? 'customers.manage' AND NOT (p.perms ? 'customers.delete')
        THEN (p.perms - 'audit.create') || '["customers.delete"]'::jsonb
        ELSE p.perms - 'audit.create' END) AS after
FROM roles r
CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END AS perms) p
WHERE r.code <> 'admin'
  AND (p.perms ? 'audit.create' OR (p.perms ? 'customers.manage' AND NOT (p.perms ? 'customers.delete')));
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.after FROM tmp_closing_permission_roles c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  format('مهاجرت پاک‌سازی مجوزها: در نقش "%s" کلید بی‌اثر «شروع دوره انبارگردانی» برداشته شد و/یا کلید تازهٔ «حذف طرف حساب» به‌جای حذف با «مدیریت کامل مشتریان» داده شد', c.name),
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code,
    'beforePermissions', c.before, 'afterPermissions', c.after,
    'addedPermissions', CASE WHEN c.after ? 'customers.delete' AND NOT (c.before ? 'customers.delete') THEN '["customers.delete"]'::jsonb ELSE '[]'::jsonb END,
    'removedPermissions', CASE WHEN c.before ? 'audit.create' THEN '["audit.create"]'::jsonb ELSE '[]'::jsonb END,
    'migration', '0123_closing_permission_keys'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_closing_permission_roles c
ORDER BY c.id;
