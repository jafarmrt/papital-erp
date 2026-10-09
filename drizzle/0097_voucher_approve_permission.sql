-- Drizzle Migration 0097: approving an accounting voucher is its own permission (v10.0.22 / TD-965, OBS-R1-44,
-- payroll duties plan decisions t9 and t10 «الف», segregation of duties D-14)
--
-- Until v10.0.21 accounting.vouchers alone recorded, edited, approved, put back to draft and finalized a voucher, so one
-- person did both sides of the check. From v10.0.22 the new key accounting.vouchers_approve approves, puts back to draft
-- and finalizes, and accounting.vouchers keeps recording and editing drafts, reversals and corrections. So that no role
-- loses anything on the day of release, every role holding accounting.vouchers gets accounting.vouchers_approve; the
-- system admin separates them in role management. The system admin role is skipped (its permissions are computed). Every
-- changed role gets one activity_logs row with the permissions before and after.
--
-- The maker of a manual voucher may not approve it: journal_vouchers.updated_by_id records who last edited a voucher
-- (created_by_id already records who recorded it). The column is new, so its foreign key is validated at once and
-- registered for the health check like every user key of TD-902. Runs inside the Drizzle migrator transaction.

CREATE TEMP TABLE tmp_voucher_approve_roles ON COMMIT DROP AS
SELECT r.id, r.code, r.name, p.perms AS before
FROM roles r
CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END AS perms) p
WHERE r.code <> 'admin'
  AND p.perms ? 'accounting.vouchers'
  AND NOT (p.perms ? 'accounting.vouchers_approve');
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.before || '["accounting.vouchers_approve"]'::jsonb FROM tmp_voucher_approve_roles c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  format('مهاجرت تفکیک وظایف: نقش "%s" که سند حسابداری را ثبت و تأیید می‌کرد، کلید «تأیید و قطعی کردن سند حسابداری» را به‌صورت تیک گرفت', c.name),
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code,
    'beforePermissions', c.before, 'afterPermissions', c.before || '["accounting.vouchers_approve"]'::jsonb,
    'addedPermissions', '["accounting.vouchers_approve"]'::jsonb, 'migration', '0097_voucher_approve_permission'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_voucher_approve_roles c
ORDER BY c.id;
--> statement-breakpoint
ALTER TABLE journal_vouchers ADD COLUMN IF NOT EXISTS updated_by_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_journal_vouchers_updated_by_id' AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE journal_vouchers ADD CONSTRAINT fk_journal_vouchers_updated_by_id
      FOREIGN KEY (updated_by_id) REFERENCES users (id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM journal_vouchers v
    WHERE v.updated_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.updated_by_id)
  ) THEN
    ALTER TABLE journal_vouchers VALIDATE CONSTRAINT fk_journal_vouchers_updated_by_id;
  ELSE
    RAISE WARNING 'fk_journal_vouchers_updated_by_id left NOT VALID: rows point to a missing user';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_journal_vouchers_updated_by_id
  ON journal_vouchers (updated_by_id) WHERE updated_by_id IS NOT NULL;
