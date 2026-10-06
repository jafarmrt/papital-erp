-- Drizzle Migration 0064: unmasked personnel and payslip bank details by permission only
-- (v9.0.109 / TD-882, the approved permission model §4.2 and §4.4)
--
-- Until v9.0.108 canAccessSensitivePersonnelData showed card, Sheba, account number and Nobitex username unmasked to the
-- system admin, the record owner, holders of personnel.manage and of two keys outside the permission catalog
-- (personnel.view_sensitive, payroll.view_sensitive, which no role could be given), to a role holding the legacy «*»
-- and to the role coded manager whatever its permissions. From v9.0.109 the two keys are catalog keys: the personnel
-- dossier asks personnel.view_sensitive or personnel.manage, the payslip payroll.view_sensitive or personnel.manage;
-- no role code and no «*» opens them. So that no role gains or loses anything on the day of release:
--
-- 1) The seed role manager (is_system = 1) gets both keys it had through its code. Custom roles are not touched.
-- 2) A role holding one of the two legacy keys (both used to open personnel and payslips alike) gets the other.
--
-- Roles that 0062 expanded from «*» hold personnel.manage and keep their access. Every changed role gets one
-- activity_logs row (entity «نقش و دسترسی», username system) with the permissions before and after. Nothing is removed.
-- Runs inside the migrator transaction.

CREATE TEMP TABLE tmp_sensitive_roles ON COMMIT DROP AS
SELECT r.id, r.code, r.name, p.perms AS before,
  CASE WHEN r.is_system = 1 AND r.code = 'manager' THEN 'seed_role' ELSE 'legacy_key_split' END AS reason,
  ARRAY(SELECT k FROM unnest(ARRAY['personnel.view_sensitive', 'payroll.view_sensitive']::text[]) WITH ORDINALITY AS u(k, ord)
        WHERE NOT (p.perms ? k) ORDER BY ord) AS added
FROM roles r
CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END AS perms) p
WHERE r.code <> 'admin'
  AND NOT (p.perms ?& ARRAY['personnel.view_sensitive', 'payroll.view_sensitive'])
  AND ((r.is_system = 1 AND r.code = 'manager') OR p.perms ?| ARRAY['personnel.view_sensitive', 'payroll.view_sensitive']);
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.before || to_jsonb(c.added) FROM tmp_sensitive_roles c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  format('مهاجرت مدل مجوز: نقش "%s" مجوز دیدن اطلاعات بانکی پرسنل و فیش را که پیش‌تر داشت به‌صورت تیک گرفت', c.name),
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code, 'reason', c.reason,
    'beforePermissions', c.before, 'afterPermissions', c.before || to_jsonb(c.added),
    'addedPermissions', to_jsonb(c.added), 'migration', '0064_sensitive_personnel_permissions'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_sensitive_roles c
ORDER BY c.id;
