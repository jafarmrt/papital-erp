-- Drizzle Migration 0101: approving a payslip is its own permission (v10.0.193 / TD-1083, OBS-R2-48,
-- payroll duties plan decision t1 «الف», segregation of duties D-02 / D-14)
--
-- Until v10.0.181 a payslip was approved the moment it was issued, and piecework.payroll alone issued it and changed its
-- status. From v10.0.193 a payslip is issued as a draft and the new key piecework.payroll_approve approves it (and puts an
-- unpaid approved payslip back to draft). So that no role loses anything on the day of release, every role holding
-- piecework.payroll gets piecework.payroll_approve; the system admin separates them in role management. The system admin
-- role is skipped (its permissions are computed). Every changed role gets one activity_logs row with the permissions
-- before and after. Existing payslips keep their status. Runs inside the Drizzle migrator transaction.

CREATE TEMP TABLE tmp_payroll_approve_roles ON COMMIT DROP AS
SELECT r.id, r.code, r.name, p.perms AS before
FROM roles r
CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END AS perms) p
WHERE r.code <> 'admin'
  AND p.perms ? 'piecework.payroll'
  AND NOT (p.perms ? 'piecework.payroll_approve');
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.before || '["piecework.payroll_approve"]'::jsonb FROM tmp_payroll_approve_roles c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  format('مهاجرت تفکیک وظایف: نقش "%s" که فیش حقوق را صادر و تأیید می‌کرد، کلید «تأیید فیش حقوق» را به‌صورت تیک گرفت', c.name),
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code,
    'beforePermissions', c.before, 'afterPermissions', c.before || '["piecework.payroll_approve"]'::jsonb,
    'addedPermissions', '["piecework.payroll_approve"]'::jsonb, 'migration', '0101_payroll_approve_permission'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_payroll_approve_roles c
ORDER BY c.id;
