-- Drizzle Migration 0063: the new permission documents.finalize goes to the roles that finalized sales documents before
-- (v9.0.125 / TD-541 and TD-771, findings B02-26 and B08-02, product-owner decision ت۱ «الف» of package 8 and the approved
-- permission model §4.4)
--
-- Until v9.0.107 POST /documents treated every role except four fixed role codes (admin, manager, warehouse_keeper,
-- accountant) as a "sales user": it refused a final document and turned a draft into a proforma, while
-- PUT /documents/:id/finalize let any holder of documents.edit, warehouse.in or warehouse.out finalize any document.
-- From v9.0.125 one table decides by document type and status: a sales document (invoice, proforma, sales return) is
-- recorded as draft or proforma with documents.create and recorded final or finalized with the new documents.finalize;
-- a warehouse document needs warehouse.in or warehouse.out by its stock direction; a stock count needs audit.apply.
--
-- So that the default roles keep finalizing sales documents on the day of release:
-- 1) Seed roles (is_system = 1) coded manager, warehouse_keeper, accountant (who passed by their code) and cfo_accountant
--    (decision ت۱) get documents.finalize. Custom roles are not touched, even when their code equals a seed role code.
-- 2) A role whose legacy «*» migration 0062 expanded into explicit keys (it finalized every document through the old
--    /finalize guard) gets documents.finalize while it still holds documents.edit, warehouse.in or warehouse.out.
--
-- Every changed role gets one activity_logs row (entity «نقش و دسترسی», username system) with the permissions before
-- and after. Nothing is removed. Runs inside the migrator transaction.

CREATE TEMP TABLE tmp_finalize_roles ON COMMIT DROP AS
SELECT r.id, r.code, r.name,
  CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END AS before,
  CASE WHEN r.is_system = 1 AND r.code IN ('manager', 'warehouse_keeper', 'accountant', 'cfo_accountant') THEN 'seed_role' ELSE 'wildcard' END AS reason
FROM roles r
WHERE r.code <> 'admin'
  AND NOT (CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END ? 'documents.finalize')
  AND (
    (r.is_system = 1 AND r.code IN ('manager', 'warehouse_keeper', 'accountant', 'cfo_accountant'))
    OR (
      EXISTS (SELECT 1 FROM activity_logs l
              WHERE l.details->>'migration' = '0062_role_code_guards_to_permissions'
                AND l.details->>'reason' = 'wildcard' AND l.entity_id = r.id::text)
      AND CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END
          ?| ARRAY['documents.edit', 'warehouse.in', 'warehouse.out']
    )
  );
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.before || '["documents.finalize"]'::jsonb FROM tmp_finalize_roles c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  format('مهاجرت مدل مجوز: نقش "%s" مجوز تازه «قطعی کردن سند فروش» را گرفت که پیش‌تر بی این مجوز سند فروش را قطعی می‌کرد', c.name),
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code, 'reason', c.reason,
    'beforePermissions', c.before, 'afterPermissions', c.before || '["documents.finalize"]'::jsonb,
    'addedPermissions', '["documents.finalize"]'::jsonb, 'migration', '0063_documents_finalize_permission'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_finalize_roles c
ORDER BY c.id;
