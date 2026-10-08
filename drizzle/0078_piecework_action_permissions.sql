-- Drizzle Migration 0078: every payroll action asks its own permission key (v9.0.320 / TD-805, B12P-02,
-- product-owner decision t2 «الف», migration rule of the permission model §4.4)
--
-- Until v9.0.319 personnel.manage («مدیریت کامل پرسنل») alone wrote every piecework record: task titles and categories,
-- base and custom rates, work log edits and deletes, payroll issue, status, voucher, payment, payment void and delete;
-- categories were also written by settings.manage. The piecework keys did not do what their titles say. From v9.0.320:
--   piecework.manage_tasks  titles, categories, Excel import, base and custom rates, a manual work log rate
--   piecework.log           create, edit and delete a work log that no live payroll holds
--   piecework.payroll       issue, status, voucher sync and delete of a payroll
--   piecework.pay           register and void a payroll payment (new key)
-- and personnel.manage covers the personnel dossier only. So that no role loses anything on the day of release:
--
-- 1) A role holding personnel.manage gets piecework.view, manage_tasks, log, payroll and pay.
-- 2) A role holding settings.manage gets piecework.view and manage_tasks (it wrote task categories).
--
-- Only missing keys are added (in this order), nothing is removed, the system admin role is skipped (its permissions are
-- computed). Every changed role gets one activity_logs row (entity «نقش و دسترسی», username system) with the permissions
-- before and after. Runs inside the migrator transaction.

CREATE TEMP TABLE tmp_piecework_action_roles ON COMMIT DROP AS
SELECT r.id, r.code, r.name, p.perms AS before,
  concat_ws('+',
    CASE WHEN p.perms ? 'personnel.manage' THEN 'personnel_manage_payroll_actions' END,
    CASE WHEN p.perms ? 'settings.manage' THEN 'settings_manage_task_categories' END) AS reason,
  ARRAY(SELECT k FROM unnest(
          CASE WHEN p.perms ? 'personnel.manage'
            THEN ARRAY['piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll', 'piecework.pay']::text[]
            ELSE ARRAY['piecework.view', 'piecework.manage_tasks']::text[] END) WITH ORDINALITY AS u(k, ord)
        WHERE NOT (p.perms ? k) ORDER BY ord) AS added
FROM roles r
CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END AS perms) p
WHERE r.code <> 'admin'
  AND p.perms ?| ARRAY['personnel.manage', 'settings.manage'];
--> statement-breakpoint
DELETE FROM tmp_piecework_action_roles WHERE cardinality(added) = 0;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.before || to_jsonb(c.added) FROM tmp_piecework_action_roles c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  format('مهاجرت مجوزهای حقوق و دستمزد: نقش "%s" کلیدهای کارمزدی کارهایی را که پیش‌تر با «مدیریت کامل پرسنل» یا «مدیریت تنظیمات» می‌کرد به‌صورت تیک گرفت', c.name),
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code, 'reason', c.reason,
    'beforePermissions', c.before, 'afterPermissions', c.before || to_jsonb(c.added),
    'addedPermissions', to_jsonb(c.added), 'migration', '0078_piecework_action_permissions'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_piecework_action_roles c
ORDER BY c.id;
