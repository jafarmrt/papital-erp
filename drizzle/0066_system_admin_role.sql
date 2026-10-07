-- Drizzle Migration 0066: every install has the system admin role row
-- (v9.0.134 / TD-526, finding B02-11, permission model §4.3 and decision t6 revised option A)
--
-- Until v9.0.133 roles were created only by the seed, which production did not run, so a fresh production install had
-- no role at all: the roles page was empty although the setup wizard had created the first user with role code admin.
-- From v9.0.134 the seed creates no role; this migration creates the one fixed role, «مدیر سیستم» (code admin), when
-- it is missing. Its permissions are not stored: the system admin passes every check by its code (can() in
-- src/middleware/authorize.ts). Other roles are made by the admin from a template on the roles page.
-- An existing admin row (name, description, permissions) is left as it is. An inserted row gets one activity_logs
-- row (entity «نقش و دسترسی», username system). Runs inside the migrator transaction.

WITH inserted AS (
  INSERT INTO roles (name, code, description, permissions, is_system)
  VALUES ('مدیر سیستم', 'admin', 'همه مجوزها را همیشه دارد؛ مجوزهایش ویرایش نمی‌شود و حذف نمی‌شود', '[]'::jsonb, 1)
  ON CONFLICT (code) DO NOTHING
  RETURNING id, name, code
)
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'CREATE', 'نقش و دسترسی', i.id::text,
  format('مهاجرت مدل مجوز: نقش ثابت "%s" ساخته شد', i.name),
  jsonb_build_object('roleId', i.id, 'roleName', i.name, 'roleCode', i.code, 'migration', '0066_system_admin_role'),
  '', now() AT TIME ZONE 'UTC'
FROM inserted i;
