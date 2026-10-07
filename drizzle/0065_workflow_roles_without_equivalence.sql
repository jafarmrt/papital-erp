-- Drizzle Migration 0065: workflow steps by permission and exact role, without the role equivalence table
-- (v9.0.111 / TD-542, finding B02-27, the approved permission model §4.2 and §4.4 item 3)
--
-- Until v9.0.110 a transition's role was matched through a fixed equivalence table of role codes (warehouse =
-- warehouse_keeper; accounting = accountant = cfo_accountant; sales = sales_manager; production = production_manager),
-- a department's posting permission (warehouse.in / warehouse.out, accounting.vouchers, documents.create / crm.manage,
-- projects.edit / projects.create) and the legacy «*». From v9.0.111 the system admin signs every step and anyone else
-- only a step whose role is exactly their own role; who may sign is the transition's required permission.
--
-- Conversions that keep exactly the same signers, applied to the live transitions (with a new definition version, so
-- new instances take them) and to the snapshot, pending tasks and pending approvals of every unfinished instance:
--   A) a department role with one of that department's posting permissions, on a transition that is not AND_ALL:
--      the role is dropped. Every holder of that permission passed the role check through the department branch and
--      every signer had to hold the permission anyway.
--   B) a «role» that is a permission key (it has a dot) with no other permission: it becomes the required permission.
-- Every other role stays and is now matched exactly. A transition (live or in an unfinished instance) whose role does
-- not exist, or that another role could sign only through the removed rules, gets one activity_logs row
-- (entity «نقش و دسترسی», details.source td542_workflow_role_review, the roles that lost the step) so the
-- administrator decides; the financial health check lists them while they still apply. Each converted definition and
-- instance gets one activity_logs row (details.source td542_workflow_role_conversion). Nothing is removed.
-- Runs inside the migrator transaction.

CREATE TEMP TABLE tmp_wf_role_groups (role_code text PRIMARY KEY, grp text NOT NULL) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO tmp_wf_role_groups (role_code, grp) VALUES
  ('warehouse', 'warehouse'), ('warehouse_keeper', 'warehouse'),
  ('accounting', 'accounting'), ('accountant', 'accounting'), ('cfo_accountant', 'accounting'),
  ('sales', 'sales'), ('sales_manager', 'sales'),
  ('production', 'production'), ('production_manager', 'production');
--> statement-breakpoint
CREATE TEMP TABLE tmp_wf_group_permissions (grp text NOT NULL, permission text NOT NULL) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO tmp_wf_group_permissions (grp, permission) VALUES
  ('warehouse', 'warehouse.in'), ('warehouse', 'warehouse.out'),
  ('accounting', 'accounting.vouchers'),
  ('sales', 'documents.create'), ('sales', 'crm.manage'),
  ('production', 'projects.edit'), ('production', 'projects.create');
--> statement-breakpoint

-- The new role and permission of a transition, or NULL when it stays as it is.
CREATE FUNCTION pg_temp.wf_guard_conversion(p_role text, p_permission text, p_rule text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN btrim(coalesce(p_role, '')) LIKE '%.%'
         AND (btrim(coalesce(p_permission, '')) = '' OR btrim(p_permission) = btrim(p_role))
      THEN jsonb_build_object('role', '', 'permission', btrim(p_role), 'kind', 'role_was_permission')
    WHEN upper(btrim(coalesce(p_rule, 'SINGLE'))) NOT IN ('ALL', 'AND_ALL')
         AND EXISTS (SELECT 1 FROM tmp_wf_role_groups g JOIN tmp_wf_group_permissions gp ON gp.grp = g.grp
                     WHERE g.role_code = lower(btrim(coalesce(p_role, '')))
                       AND gp.permission = btrim(coalesce(p_permission, '')))
      THEN jsonb_build_object('role', '', 'permission', btrim(p_permission), 'kind', 'permission_implies_role')
    ELSE NULL
  END
$fn$;
--> statement-breakpoint

-- The same test as isUsableSnapshot (src/services/workflow/workflowSnapshot.ts): the engine reads the live tables
-- for an instance whose snapshot has no database ids.
CREATE FUNCTION pg_temp.wf_snapshot_usable(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(p -> 'states') = 'array' AND jsonb_typeof(p -> 'transitions') = 'array' THEN
      jsonb_array_length(p -> 'states') > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p -> 'states') s
        WHERE CASE WHEN jsonb_typeof(s -> 'id') = 'number'
                   THEN (s ->> 'id')::numeric <= 0 OR (s ->> 'id')::numeric <> trunc((s ->> 'id')::numeric)
                   ELSE true END)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p -> 'transitions') t
        WHERE CASE WHEN jsonb_typeof(t -> 'id') = 'number' AND jsonb_typeof(t -> 'fromStateId') = 'number'
                        AND jsonb_typeof(t -> 'toStateId') = 'number'
                   THEN (t ->> 'id')::numeric <= 0 OR (t ->> 'fromStateId')::numeric <= 0 OR (t ->> 'toStateId')::numeric <= 0
                        OR (t ->> 'id')::numeric <> trunc((t ->> 'id')::numeric)
                   ELSE true END)
    ELSE false
  END
$fn$;
--> statement-breakpoint

-- A snapshot's transitions array with every convertible transition converted.
CREATE FUNCTION pg_temp.wf_converted_transitions(p_transitions jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(jsonb_agg(
    CASE WHEN c.conv IS NULL THEN e.value
         ELSE e.value || jsonb_build_object('requiredRole', c.conv ->> 'role', 'requiredPermission', c.conv ->> 'permission')
    END ORDER BY e.ord), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_transitions) = 'array' THEN p_transitions ELSE '[]'::jsonb END)
       WITH ORDINALITY AS e(value, ord)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(e.value) = 'object'
                THEN pg_temp.wf_guard_conversion(e.value ->> 'requiredRole', e.value ->> 'requiredPermission', e.value ->> 'approvalRuleType')
           END AS conv) c
$fn$;
--> statement-breakpoint

-- 1) Live transitions of every definition
CREATE TEMP TABLE tmp_wf_live_conversions ON COMMIT DROP AS
SELECT t.id AS transition_id, t.workflow_definition_id AS definition_id, coalesce(t.title, '') AS title,
  coalesce(t.required_role, '') AS before_role, coalesce(t.required_permission, '') AS before_permission, c.conv
FROM workflow_transitions t
CROSS JOIN LATERAL (SELECT pg_temp.wf_guard_conversion(t.required_role, t.required_permission, t.approval_rule_type) AS conv) c
WHERE c.conv IS NOT NULL;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('workflow_transitions', $sql$
UPDATE workflow_transitions t
SET required_role = c.conv ->> 'role', required_permission = c.conv ->> 'permission'
FROM tmp_wf_live_conversions c
WHERE c.transition_id = t.id
$sql$);
--> statement-breakpoint

-- 2) A new definition version from the current one, so that new instances take the converted transitions
CREATE TEMP TABLE tmp_wf_new_versions ON COMMIT DROP AS
SELECT d.id AS definition_id, coalesce(d.title, '') AS definition_title,
  (SELECT max(v2.version) FROM workflow_definition_versions v2 WHERE v2.definition_id = d.id) + 1 AS new_version,
  v.dsl_json AS base_dsl
FROM workflow_definitions d
JOIN workflow_definition_versions v ON v.definition_id = d.id AND v.version = d.version
WHERE d.id IN (SELECT DISTINCT definition_id FROM tmp_wf_live_conversions)
  AND jsonb_typeof(v.dsl_json) = 'object'
  AND jsonb_typeof(v.dsl_json -> 'transitions') = 'array';
--> statement-breakpoint
INSERT INTO workflow_definition_versions (definition_id, version, title, description, dsl_json, created_by, created_at)
SELECT n.definition_id, n.new_version, n.definition_title,
  'مهاجرت مدل مجوز: گام‌هایی که مجوز همان بخش را می‌خواستند فقط با مجوز سنجیده می‌شوند',
  n.base_dsl || jsonb_build_object(
    'version', n.new_version,
    'transitions', pg_temp.wf_converted_transitions(n.base_dsl -> 'transitions'),
    'publishedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  NULL, now() AT TIME ZONE 'UTC'
FROM tmp_wf_new_versions n
ORDER BY n.definition_id;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('workflow_definitions', $sql$
UPDATE workflow_definitions d SET version = n.new_version
FROM tmp_wf_new_versions n
WHERE n.definition_id = d.id
$sql$);
--> statement-breakpoint

-- 3) Unfinished instances: their own snapshot, or the live tables when the snapshot has no database ids
CREATE TEMP TABLE tmp_wf_open_instances ON COMMIT DROP AS
SELECT i.id AS instance_id, i.workflow_definition_id AS definition_id, pg_temp.wf_snapshot_usable(i.snapshot_dsl) AS usable
FROM workflow_instances i
WHERE i.status IN ('IN_PROGRESS', 'REJECTED');
--> statement-breakpoint
CREATE TEMP TABLE tmp_wf_instance_conversions ON COMMIT DROP AS
SELECT o.instance_id, o.definition_id, (e.value ->> 'id')::int AS transition_id, coalesce(e.value ->> 'title', '') AS title,
  coalesce(e.value ->> 'requiredRole', '') AS before_role, coalesce(e.value ->> 'requiredPermission', '') AS before_permission, c.conv
FROM tmp_wf_open_instances o
JOIN workflow_instances i ON i.id = o.instance_id
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN o.usable THEN i.snapshot_dsl -> 'transitions' ELSE '[]'::jsonb END) e(value)
CROSS JOIN LATERAL (SELECT pg_temp.wf_guard_conversion(e.value ->> 'requiredRole', e.value ->> 'requiredPermission', e.value ->> 'approvalRuleType') AS conv) c
WHERE c.conv IS NOT NULL;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('workflow_instances', $sql$
UPDATE workflow_instances i
SET snapshot_dsl = i.snapshot_dsl || jsonb_build_object('transitions', pg_temp.wf_converted_transitions(i.snapshot_dsl -> 'transitions'))
WHERE i.id IN (SELECT DISTINCT instance_id FROM tmp_wf_instance_conversions)
$sql$);
--> statement-breakpoint
CREATE TEMP TABLE tmp_wf_task_conversions ON COMMIT DROP AS
SELECT instance_id, transition_id, before_role FROM tmp_wf_instance_conversions
UNION ALL
SELECT o.instance_id, lc.transition_id, lc.before_role
FROM tmp_wf_open_instances o
JOIN tmp_wf_live_conversions lc ON lc.definition_id = o.definition_id
WHERE NOT o.usable;
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('workflow_tasks', $sql$
UPDATE workflow_tasks wt SET assigned_role = '', candidate_roles = '["ALL"]'::jsonb
FROM tmp_wf_task_conversions c
WHERE wt.instance_id = c.instance_id AND wt.transition_id = c.transition_id AND wt.status = 'pending'
  AND lower(btrim(coalesce(wt.assigned_role, ''))) = lower(btrim(c.before_role))
$sql$);
--> statement-breakpoint
SELECT erp_update_with_unvalidated_checks('workflow_pending_approvals', $sql$
UPDATE workflow_pending_approvals pa SET assigned_role = ''
FROM tmp_wf_task_conversions c
WHERE pa.instance_id = c.instance_id AND pa.transition_id = c.transition_id
  AND lower(btrim(coalesce(pa.assigned_role, ''))) = lower(btrim(c.before_role))
$sql$);
--> statement-breakpoint

-- 4) One activity_logs row per converted definition and per converted instance
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'طرح گردش کار', d.id::text,
  format('مهاجرت مدل مجوز: اقدام‌های گردش کار «%s» که مجوز همان بخش را می‌خواستند فقط با همان مجوز سنجیده می‌شوند', coalesce(d.title, d.code)),
  jsonb_build_object('source', 'td542_workflow_role_conversion', 'scope', 'definition', 'definitionId', d.id,
    'definitionCode', d.code, 'newVersion', n.new_version,
    'transitions', jsonb_agg(jsonb_build_object('transitionId', lc.transition_id, 'title', lc.title,
      'beforeRole', lc.before_role, 'beforePermission', lc.before_permission,
      'afterRole', lc.conv ->> 'role', 'afterPermission', lc.conv ->> 'permission', 'kind', lc.conv ->> 'kind') ORDER BY lc.transition_id)),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_wf_live_conversions lc
JOIN workflow_definitions d ON d.id = lc.definition_id
LEFT JOIN tmp_wf_new_versions n ON n.definition_id = d.id
GROUP BY d.id, d.title, d.code, n.new_version
ORDER BY d.id;
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'طرح گردش کار', d.id::text,
  format('مهاجرت مدل مجوز: در فرایند در جریان گردش کار «%s» اقدام‌هایی که مجوز همان بخش را می‌خواستند فقط با همان مجوز سنجیده می‌شوند', coalesce(d.title, d.code)),
  jsonb_build_object('source', 'td542_workflow_role_conversion', 'scope', 'instance', 'definitionId', d.id,
    'definitionCode', d.code, 'instanceId', ic.instance_id,
    'transitions', jsonb_agg(jsonb_build_object('transitionId', ic.transition_id, 'title', ic.title,
      'beforeRole', ic.before_role, 'beforePermission', ic.before_permission,
      'afterRole', ic.conv ->> 'role', 'afterPermission', ic.conv ->> 'permission', 'kind', ic.conv ->> 'kind') ORDER BY ic.transition_id)),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_wf_instance_conversions ic
JOIN workflow_definitions d ON d.id = ic.definition_id
GROUP BY d.id, d.title, d.code, ic.instance_id
ORDER BY d.id, ic.instance_id;
--> statement-breakpoint

-- 5) Transitions that keep a role: listed when the role does not exist or another role signed them only through the
--    removed rules (equivalent role, the department's posting permission, the role code held as a permission, «*»)
CREATE TEMP TABLE tmp_wf_role_review_candidates ON COMMIT DROP AS
SELECT 'definition'::text AS scope, t.workflow_definition_id AS definition_id, NULL::int AS instance_id, t.id AS transition_id,
  coalesce(t.title, '') AS title, btrim(coalesce(t.required_role, '')) AS required_role,
  btrim(coalesce(t.required_permission, '')) AS required_permission
FROM workflow_transitions t
WHERE btrim(coalesce(t.required_role, '')) NOT IN ('', '*', 'ALL')
UNION ALL
SELECT 'instance', o.definition_id, o.instance_id, (e.value ->> 'id')::int, coalesce(e.value ->> 'title', ''),
  btrim(coalesce(e.value ->> 'requiredRole', '')), btrim(coalesce(e.value ->> 'requiredPermission', ''))
FROM tmp_wf_open_instances o
JOIN workflow_instances i ON i.id = o.instance_id
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN o.usable THEN i.snapshot_dsl -> 'transitions' ELSE '[]'::jsonb END) e(value)
WHERE btrim(coalesce(e.value ->> 'requiredRole', '')) NOT IN ('', '*', 'ALL');
--> statement-breakpoint
CREATE TEMP TABLE tmp_wf_role_reviews ON COMMIT DROP AS
SELECT c.*,
  (SELECT r.id FROM roles r WHERE lower(r.code) = lower(c.required_role) ORDER BY r.id LIMIT 1) AS role_id,
  (SELECT r.name FROM roles r WHERE lower(r.code) = lower(c.required_role) ORDER BY r.id LIMIT 1) AS role_name,
  coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'name', x.name) ORDER BY x.id)
    FROM roles x
    CROSS JOIN LATERAL (SELECT CASE WHEN jsonb_typeof(x.permissions) = 'array' THEN x.permissions ELSE '[]'::jsonb END AS p) xp
    WHERE x.code <> 'admin'
      AND lower(x.code) <> lower(c.required_role)
      AND (c.required_permission = '' OR xp.p ? c.required_permission OR xp.p ? '*')
      AND (xp.p ? '*' OR xp.p ? c.required_role OR xp.p ? lower(c.required_role)
           OR EXISTS (SELECT 1 FROM tmp_wf_role_groups gu JOIN tmp_wf_role_groups gr ON gr.grp = gu.grp
                      WHERE gu.role_code = lower(x.code) AND gr.role_code = lower(c.required_role))
           OR EXISTS (SELECT 1 FROM tmp_wf_role_groups gr JOIN tmp_wf_group_permissions gp ON gp.grp = gr.grp
                      WHERE gr.role_code = lower(c.required_role) AND xp.p ? gp.permission))
  ), '[]'::jsonb) AS lost_roles
FROM tmp_wf_role_review_candidates c;
--> statement-breakpoint
INSERT INTO activity_logs (username, user_full_name, action, entity, entity_id, description, details, ip_address, timestamp)
SELECT 'system', 'سیستم', 'UPDATE', 'نقش و دسترسی', coalesce(r.role_id::text, ''),
  CASE WHEN r.role_id IS NULL
    THEN format('بازبینی گردش کار «%s»: نقش «%s» اقدام «%s» تعریف نشده است و از این پس فقط مدیر سیستم این گام را امضا می‌کند؛ در طراح گردش کار نقش یا مجوز گام را تعیین کنید',
                coalesce(d.title, d.code), r.required_role, r.title)
    ELSE format('بازبینی گردش کار «%s»: اقدام «%s» از این پس فقط برای نقش «%s» است و نقش‌هایی که پیش‌تر با هم‌ارزی نقش یا مجوز بخش آن را امضا می‌کردند دیگر نمی‌کنند؛ اگر باید بکنند، در طراح گردش کار گام را با مجوز ببندید',
                coalesce(d.title, d.code), r.title, coalesce(r.role_name, r.required_role))
  END,
  jsonb_build_object('source', 'td542_workflow_role_review', 'scope', r.scope, 'definitionId', r.definition_id,
    'definitionCode', d.code, 'definitionTitle', d.title, 'instanceId', r.instance_id, 'transitionId', r.transition_id,
    'transitionTitle', r.title, 'requiredRole', r.required_role, 'requiredPermission', r.required_permission,
    'roleExists', r.role_id IS NOT NULL, 'lostRoles', r.lost_roles),
  '', now() AT TIME ZONE 'UTC'
FROM tmp_wf_role_reviews r
JOIN workflow_definitions d ON d.id = r.definition_id
WHERE r.role_id IS NULL OR jsonb_array_length(r.lost_roles) > 0
ORDER BY r.definition_id, r.instance_id NULLS FIRST, r.transition_id;
--> statement-breakpoint
DROP FUNCTION pg_temp.wf_converted_transitions(jsonb);
--> statement-breakpoint
DROP FUNCTION pg_temp.wf_snapshot_usable(jsonb);
--> statement-breakpoint
DROP FUNCTION pg_temp.wf_guard_conversion(text, text, text);
