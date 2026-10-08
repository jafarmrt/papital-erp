-- Drizzle Migration 0085: the raw material request queue (v9.0.378 / TD-825, finding B07-09, product-owner decision t5 «الف»)
--
-- 1) pending_materials.item_id: the item an approval made. From v9.0.378 an approval creates the item through the item
--    service and writes its id here in the same transaction; requests approved earlier keep a null link (they are never
--    matched to an item by code, which was not unique).
-- 2) Sending a request needs the new key pending_materials.create (requires pending_materials.view); until v9.0.377 any
--    signed-in user could send one. The project's «custom material», which becomes a request in v9.0.379, created the item
--    with products.create, so a role holding products.create gets pending_materials.create and pending_materials.view.
--    Only missing keys are added (in this order), nothing is removed, the system admin role is skipped (its permissions are
--    computed). Every changed role gets one activity_logs row (entity «نقش و دسترسی», username system) with the permissions
--    before and after. Runs inside the migrator transaction.

ALTER TABLE pending_materials ADD COLUMN IF NOT EXISTS item_id integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pending_materials_item_id') THEN
    ALTER TABLE pending_materials
      ADD CONSTRAINT fk_pending_materials_item_id FOREIGN KEY (item_id) REFERENCES items(id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pmat_item ON pending_materials (item_id);
--> statement-breakpoint
CREATE TEMP TABLE tmp_pending_material_create_roles ON COMMIT DROP AS
SELECT r.id, r.code, r.name, p.perms AS before,
  ARRAY(SELECT k FROM unnest(ARRAY['pending_materials.view', 'pending_materials.create']::text[]) WITH ORDINALITY AS u(k, ord)
        WHERE NOT (p.perms ? k) ORDER BY ord) AS added
FROM roles r
CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END AS perms) p
WHERE r.code <> 'admin'
  AND p.perms ? 'products.create';
--> statement-breakpoint
DELETE FROM tmp_pending_material_create_roles WHERE cardinality(added) = 0;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.before || to_jsonb(c.added) FROM tmp_pending_material_create_roles c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  format('مهاجرت مجوز درخواست ماده اولیه: نقش "%s" که با «تعریف کالا» ماده سفارشی پروژه را می‌ساخت، مجوز «ثبت درخواست ماده اولیه» را گرفت', c.name),
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code, 'reason', 'products_create_custom_material',
    'beforePermissions', c.before, 'afterPermissions', c.before || to_jsonb(c.added),
    'addedPermissions', to_jsonb(c.added), 'migration', '0085_pending_material_queue'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_pending_material_create_roles c
ORDER BY c.id;
