-- Drizzle Migration 0062: role codes leave the route guards; access a seed role had only through its code becomes ticks
-- (v9.0.97 / TD-516, finding B02-01, product-owner decision ت۱ «الف» and the approved permission model §4.4)
--
-- Until v9.0.87 a guard such as authorize('admin', 'manager', 'customers.manage') let a user through by role code
-- before any permission: 49 routes named a role code other than admin, so «مدیر عمومی» saved settings without
-- settings.manage and «انباردار» edited documents without documents.edit, and taking a tick off a role on the roles
-- page did not take the access away. From v9.0.97 every guard asks permission keys only (or is one of the system
-- maintenance routes that only the system admin runs). So that no role gains or loses anything on the day of release:
--
-- 1) Seed roles (is_system = 1) get, for every guard that named their code and none of whose keys they hold, the
--    guard's first key (the activity log guards now ask audit_logs.view, the pending-material delete asks the new
--    pending_materials.delete). The guard list below is the v9.0.87 route guard table (buildRouteGuardTable).
--    Custom roles are not touched, even when their code equals a seed role code.
-- 2) A role other than admin whose permissions hold the legacy «*» (all permissions) gets every catalog key of
--    v9.0.97 explicitly and loses «*», which no check reads any more. Other keys are kept as they are.
--
-- Every changed role gets one activity_logs row (entity «نقش و دسترسی», username system) with the permissions before
-- and after, the added keys and the routes. Nothing is removed except «*». Runs inside the migrator transaction.

CREATE TEMP TABLE tmp_role_code_guards (role_code text NOT NULL, guard_keys text[] NOT NULL, grant_key text NOT NULL, route text NOT NULL) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO tmp_role_code_guards (role_code, guard_keys, grant_key, route) VALUES
  ('accountant', ARRAY['documents.create', 'warehouse.in', 'warehouse.out'], 'documents.create', 'POST /api/documents'),
  ('accountant', ARRAY['documents.edit'], 'documents.edit', 'PUT /api/documents/:id'),
  ('accountant', ARRAY['documents.edit', 'warehouse.in', 'warehouse.out'], 'documents.edit', 'PUT /api/documents/:id/finalize'),
  ('manager', ARRAY['customers.manage'], 'customers.manage', 'DELETE /api/customers/:id'),
  ('manager', ARRAY['pending_materials.delete'], 'pending_materials.delete', 'DELETE /api/pending-materials/:id'),
  ('manager', ARRAY['personnel.manage'], 'personnel.manage', 'DELETE /api/personnel/:id'),
  ('manager', ARRAY['procurement.manage'], 'procurement.manage', 'DELETE /api/procurement/requisitions/:id'),
  ('manager', ARRAY['products.delete'], 'products.delete', 'DELETE /api/transfers/:code'),
  ('manager', ARRAY['audit_logs.view'], 'audit_logs.view', 'GET /api/activity-logs'),
  ('manager', ARRAY['audit_logs.view'], 'audit_logs.view', 'GET /api/activity-logs/filters'),
  ('manager', ARRAY['audit_logs.view'], 'audit_logs.view', 'GET /api/activity-logs/integrity'),
  ('manager', ARRAY['products.view'], 'products.view', 'GET /api/items/unified-export'),
  ('manager', ARRAY['personnel.manage'], 'personnel.manage', 'GET /api/personnel/export'),
  ('manager', ARRAY['procurement.view'], 'procurement.view', 'GET /api/procurement/inbox/summary'),
  ('manager', ARRAY['procurement.view', 'projects.view'], 'procurement.view', 'GET /api/procurement/orders'),
  ('manager', ARRAY['procurement.view', 'projects.view'], 'procurement.view', 'GET /api/procurement/requisitions'),
  ('manager', ARRAY['procurement.view', 'projects.view'], 'procurement.view', 'GET /api/procurement/requisitions/:id'),
  ('manager', ARRAY['woocommerce.view'], 'woocommerce.view', 'GET /api/woocommerce/order-logs'),
  ('manager', ARRAY['woocommerce.view'], 'woocommerce.view', 'GET /api/woocommerce/synced-orders'),
  ('manager', ARRAY['products.create', 'products.edit'], 'products.create', 'POST /api/categories'),
  ('manager', ARRAY['customers.manage'], 'customers.manage', 'POST /api/customers'),
  ('manager', ARRAY['customers.manage'], 'customers.manage', 'POST /api/customers/bulk-import'),
  ('manager', ARRAY['documents.create', 'warehouse.in', 'warehouse.out'], 'documents.create', 'POST /api/documents'),
  ('manager', ARRAY['products.create'], 'products.create', 'POST /api/items'),
  ('manager', ARRAY['products.edit_price'], 'products.edit_price', 'POST /api/items/:id/prices'),
  ('manager', ARRAY['products.create', 'products.edit'], 'products.create', 'POST /api/items/next-code'),
  ('manager', ARRAY['products.edit_price'], 'products.edit_price', 'POST /api/items/prices/batch-update'),
  ('manager', ARRAY['products.create', 'products.edit'], 'products.create', 'POST /api/items/unified-import'),
  ('manager', ARRAY['personnel.manage'], 'personnel.manage', 'POST /api/personnel'),
  ('manager', ARRAY['personnel.manage'], 'personnel.manage', 'POST /api/personnel/bulk-import'),
  ('manager', ARRAY['procurement.manage'], 'procurement.manage', 'POST /api/procurement/consolidate'),
  ('manager', ARRAY['procurement.order', 'procurement.manage'], 'procurement.order', 'POST /api/procurement/orders/:id/deliver'),
  ('manager', ARRAY['procurement.create', 'projects.edit'], 'procurement.create', 'POST /api/procurement/requisitions'),
  ('manager', ARRAY['procurement.order'], 'procurement.order', 'POST /api/procurement/requisitions/:id/convert-to-orders'),
  ('manager', ARRAY['procurement.approve', 'procurement.manage'], 'procurement.approve', 'POST /api/procurement/requisitions/:id/workflow-action'),
  ('manager', ARRAY['settings.manage'], 'settings.manage', 'POST /api/settings'),
  ('manager', ARRAY['products.create', 'products.edit'], 'products.create', 'POST /api/transfers'),
  ('manager', ARRAY['products.create', 'products.edit'], 'products.create', 'POST /api/transfers/:code'),
  ('manager', ARRAY['woocommerce.manage'], 'woocommerce.manage', 'POST /api/woocommerce/sync-all-stocks'),
  ('manager', ARRAY['woocommerce.manage'], 'woocommerce.manage', 'POST /api/woocommerce/sync-item'),
  ('manager', ARRAY['woocommerce.manage'], 'woocommerce.manage', 'POST /api/woocommerce/sync-order-by-id'),
  ('manager', ARRAY['woocommerce.manage'], 'woocommerce.manage', 'POST /api/woocommerce/test-connection'),
  ('manager', ARRAY['products.edit'], 'products.edit', 'PUT /api/categories/:id'),
  ('manager', ARRAY['customers.manage'], 'customers.manage', 'PUT /api/customers/:id'),
  ('manager', ARRAY['documents.edit'], 'documents.edit', 'PUT /api/documents/:id'),
  ('manager', ARRAY['documents.edit', 'warehouse.in', 'warehouse.out'], 'documents.edit', 'PUT /api/documents/:id/finalize'),
  ('manager', ARRAY['documents.edit'], 'documents.edit', 'PUT /api/documents/:id/notes'),
  ('manager', ARRAY['products.edit'], 'products.edit', 'PUT /api/items/:id'),
  ('manager', ARRAY['personnel.manage'], 'personnel.manage', 'PUT /api/personnel/:id'),
  ('manager', ARRAY['procurement.manage'], 'procurement.manage', 'PUT /api/procurement/requisitions/:id'),
  ('manager', ARRAY['products.create', 'products.edit'], 'products.create', 'PUT /api/transfers'),
  ('manager', ARRAY['products.create', 'products.edit'], 'products.create', 'PUT /api/transfers/:code'),
  ('procurement_officer', ARRAY['procurement.manage'], 'procurement.manage', 'DELETE /api/procurement/requisitions/:id'),
  ('procurement_officer', ARRAY['procurement.view'], 'procurement.view', 'GET /api/procurement/inbox/summary'),
  ('procurement_officer', ARRAY['procurement.view', 'projects.view'], 'procurement.view', 'GET /api/procurement/orders'),
  ('procurement_officer', ARRAY['procurement.view', 'projects.view'], 'procurement.view', 'GET /api/procurement/requisitions'),
  ('procurement_officer', ARRAY['procurement.view', 'projects.view'], 'procurement.view', 'GET /api/procurement/requisitions/:id'),
  ('procurement_officer', ARRAY['procurement.manage'], 'procurement.manage', 'POST /api/procurement/consolidate'),
  ('procurement_officer', ARRAY['procurement.order', 'procurement.manage'], 'procurement.order', 'POST /api/procurement/orders/:id/deliver'),
  ('procurement_officer', ARRAY['procurement.create', 'projects.edit'], 'procurement.create', 'POST /api/procurement/requisitions'),
  ('procurement_officer', ARRAY['procurement.order'], 'procurement.order', 'POST /api/procurement/requisitions/:id/convert-to-orders'),
  ('procurement_officer', ARRAY['procurement.approve', 'procurement.manage'], 'procurement.approve', 'POST /api/procurement/requisitions/:id/workflow-action'),
  ('procurement_officer', ARRAY['procurement.manage'], 'procurement.manage', 'PUT /api/procurement/requisitions/:id'),
  ('sales_manager', ARRAY['customers.manage'], 'customers.manage', 'DELETE /api/customers/:id'),
  ('sales_manager', ARRAY['customers.manage'], 'customers.manage', 'POST /api/customers'),
  ('sales_manager', ARRAY['customers.manage'], 'customers.manage', 'POST /api/customers/bulk-import'),
  ('sales_manager', ARRAY['documents.create', 'warehouse.in', 'warehouse.out'], 'documents.create', 'POST /api/documents'),
  ('sales_manager', ARRAY['customers.manage'], 'customers.manage', 'PUT /api/customers/:id'),
  ('sales_manager', ARRAY['documents.edit'], 'documents.edit', 'PUT /api/documents/:id'),
  ('warehouse_keeper', ARRAY['documents.create', 'warehouse.in', 'warehouse.out'], 'documents.create', 'POST /api/documents'),
  ('warehouse_keeper', ARRAY['products.create', 'products.edit'], 'products.create', 'POST /api/transfers'),
  ('warehouse_keeper', ARRAY['products.create', 'products.edit'], 'products.create', 'POST /api/transfers/:code'),
  ('warehouse_keeper', ARRAY['documents.edit'], 'documents.edit', 'PUT /api/documents/:id'),
  ('warehouse_keeper', ARRAY['documents.edit', 'warehouse.in', 'warehouse.out'], 'documents.edit', 'PUT /api/documents/:id/finalize'),
  ('warehouse_keeper', ARRAY['products.create', 'products.edit'], 'products.create', 'PUT /api/transfers'),
  ('warehouse_keeper', ARRAY['products.create', 'products.edit'], 'products.create', 'PUT /api/transfers/:code');
--> statement-breakpoint
CREATE TEMP TABLE tmp_catalog_keys ON COMMIT DROP AS
SELECT c.key, c.ord FROM unnest(ARRAY[
  'products.view', 'products.create', 'products.edit', 'products.edit_price', 'products.delete', 'warehouse.view', 'warehouse.manage', 'warehouse.in',
  'warehouse.out', 'warehouse.transfer', 'warehouse.backdate', 'inventory.reconcile', 'documents.view', 'documents.create', 'documents.edit', 'documents.delete',
  'audit.view', 'audit.create', 'audit.apply', 'customers.view', 'customers.manage', 'projects.view', 'projects.create', 'projects.edit',
  'projects.delete', 'workflow.view', 'workflow.execute', 'workflow.approve', 'workflow.manage', 'workflow.admin', 'events.view', 'events.manage',
  'daily_logs.view', 'daily_logs.create', 'daily_logs.manage_all', 'crm.view', 'crm.manage', 'crm.delete', 'personnel.view', 'personnel.manage',
  'piecework.view', 'piecework.manage_tasks', 'piecework.log', 'piecework.payroll', 'pending_materials.view', 'pending_materials.approve', 'pending_materials.delete', 'procurement.view',
  'procurement.create', 'procurement.manage', 'procurement.order', 'procurement.approve', 'accounting.view', 'accounting.vouchers', 'accounting.coa', 'accounting.treasury',
  'accounting.cheques', 'accounting.treasury_no_voucher', 'accounting.reports', 'accounting.fiscal_close', 'woocommerce.view', 'woocommerce.manage', 'reports.view', 'audit_logs.view',
  'users.manage', 'roles.manage', 'settings.manage'
]::text[]) WITH ORDINALITY AS c(key, ord);
--> statement-breakpoint
CREATE TEMP TABLE tmp_role_permissions ON COMMIT DROP AS
SELECT id, code, name, CASE WHEN jsonb_typeof(permissions) = 'array' THEN permissions ELSE '[]'::jsonb END AS p, is_system
FROM roles
WHERE code <> 'admin';
--> statement-breakpoint
CREATE TEMP TABLE tmp_role_code_grants ON COMMIT DROP AS
SELECT r.id AS role_id, g.grant_key, g.route
FROM tmp_role_permissions r
JOIN tmp_role_code_guards g ON g.role_code = r.code
WHERE r.is_system = 1 AND NOT (r.p ? '*') AND NOT (r.p ?| g.guard_keys);
--> statement-breakpoint
CREATE TEMP TABLE tmp_role_changes ON COMMIT DROP AS
SELECT r.id, r.code, r.name, r.p AS before,
  CASE WHEN r.p ? '*' THEN 'wildcard' ELSE 'role_code_guard' END AS reason,
  CASE WHEN r.p ? '*'
    THEN ARRAY(SELECT c.key FROM tmp_catalog_keys c WHERE NOT (r.p ? c.key) ORDER BY c.ord)
    ELSE ARRAY(SELECT c.key FROM tmp_catalog_keys c
               WHERE c.key IN (SELECT g.grant_key FROM tmp_role_code_grants g WHERE g.role_id = r.id) AND NOT (r.p ? c.key)
               ORDER BY c.ord)
  END AS added,
  ARRAY(SELECT g.route FROM tmp_role_code_grants g WHERE g.role_id = r.id ORDER BY g.route) AS routes
FROM tmp_role_permissions r
WHERE r.p ? '*' OR EXISTS (SELECT 1 FROM tmp_role_code_grants g WHERE g.role_id = r.id);
--> statement-breakpoint
ALTER TABLE tmp_role_changes ADD COLUMN after jsonb;
--> statement-breakpoint
UPDATE tmp_role_changes c
SET after = COALESCE((SELECT jsonb_agg(e.value ORDER BY e.ord) FROM jsonb_array_elements(c.before) WITH ORDINALITY AS e(value, ord)
                      WHERE e.value <> to_jsonb('*'::text)), '[]'::jsonb) || to_jsonb(c.added);
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('roles', $sql$
UPDATE roles r SET permissions = c.after FROM tmp_role_changes c WHERE c.id = r.id
$sql$);
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', c.id::text,
  CASE c.reason
    WHEN 'wildcard' THEN format('مهاجرت مدل مجوز: «همه مجوزها» (*) نقش "%s" با مجوزهای صریح فهرست جایگزین شد', c.name)
    ELSE format('مهاجرت مدل مجوز: دسترسی‌ای که نقش "%s" فقط با کد نقش داشت به تیک مجوز تبدیل شد', c.name)
  END,
  jsonb_build_object('roleId', c.id, 'roleName', c.name, 'roleCode', c.code, 'reason', c.reason,
    'beforePermissions', c.before, 'afterPermissions', c.after, 'addedPermissions', to_jsonb(c.added),
    'routes', to_jsonb(c.routes), 'migration', '0062_role_code_guards_to_permissions'),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_role_changes c
ORDER BY c.id;
