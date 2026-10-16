import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import type { HealthCheckTestResult } from '../../types.js';

/**
 * OBS-R2-78: running document workflow instances whose own snapshot still holds an approval action (target step
 * `approved` or automatic action `POST_INVOICE`) with neither role nor permission. A running instance executes against its
 * snapshot (rule of v7.0.87), so the definition check `workflow_unguarded_document_approval` does not see a roleless
 * snapshot taken before TD-444 / TD-445; such an instance is only listed here, never rewritten. Reads only workflow tables,
 * like the sibling checks (decision ت۳ الف of phase 2). An unfinished instance is `IN_PROGRESS` or `REJECTED` (a rejected
 * one still continues through its reopen action), the statuses of `OPEN_WORKFLOW_INSTANCE_STATUSES` in
 * `src/services/workflow/transitionRoles.ts`, written out here so this check reads no workflow package.
 */
export interface UnguardedDocumentInstanceRow {
  instanceId: number;
  entityId: string;
  definitionId: number;
  code: string;
  title: string;
  transitionId: number;
  transitionTitle: string;
}

export const UNGUARDED_DOCUMENT_INSTANCE_CHECK_ID = 'workflow_unguarded_document_instance';

export async function findUnguardedDocumentInstances(db: DbExecutor): Promise<UnguardedDocumentInstanceRow[]> {
  const result = await db.execute(sql`
    SELECT i.id AS "instanceId", i.entity_id AS "entityId", d.id AS "definitionId",
           coalesce(d.code, '') AS code, coalesce(d.title, '') AS title,
           CASE WHEN (t ->> 'id') ~ '^[0-9]+$' THEN (t ->> 'id')::int ELSE 0 END AS "transitionId",
           coalesce(t ->> 'title', '') AS "transitionTitle"
    FROM workflow_instances i
    JOIN workflow_definitions d ON d.id = i.workflow_definition_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(i.snapshot_dsl -> 'transitions') = 'array' THEN i.snapshot_dsl -> 'transitions' ELSE '[]'::jsonb END) t
    WHERE i.status IN ('IN_PROGRESS', 'REJECTED')
      AND i.entity_type = 'document'
      AND btrim(coalesce(t ->> 'requiredRole', '')) = ''
      AND btrim(coalesce(t ->> 'requiredPermission', '')) = ''
      AND (
        coalesce(t ->> 'autoActionKey', '') = 'POST_INVOICE'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(i.snapshot_dsl -> 'states') = 'array' THEN i.snapshot_dsl -> 'states' ELSE '[]'::jsonb END) s
          WHERE (s ->> 'id') = (t ->> 'toStateId') AND (s ->> 'stateKey') = 'approved')
      )
    ORDER BY i.id, 6`);
  const rows = (result.rows ?? []) as unknown as UnguardedDocumentInstanceRow[];
  return rows.map(r => ({
    ...r, instanceId: Number(r.instanceId), definitionId: Number(r.definitionId), transitionId: Number(r.transitionId),
    entityId: String(r.entityId ?? ''),
  }));
}

export function buildUnguardedDocumentInstanceHealthTest(rows: UnguardedDocumentInstanceRow[]): HealthCheckTestResult {
  const instanceCount = new Set(rows.map(r => r.instanceId)).size;
  return {
    id: UNGUARDED_DOCUMENT_INSTANCE_CHECK_ID,
    category: 'system',
    title: 'فرایند در جریان سند با گام تأیید بی‌مجوز',
    description: 'فرایند در جریان با تصویر نسخه خودش پیش می‌رود؛ فرایندی که تصویرش اقدام قطعی‌سازی بی نقش و بی مجوز دارد این‌جا فهرست می‌شود و تغییری در آن داده نمی‌شود',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, instanceCount),
    count: instanceCount,
    message: instanceCount > 0
      ? `${instanceCount} فرایند در جریان سند با اقدام قطعی‌سازی بی نقش و بی مجوز پیش می‌رود؛ آن را با «بستن فرایند» ببندید یا گام را با کاربر دارای مجوز به پایان برسانید.`
      : 'هیچ فرایند در جریان سندی اقدام قطعی‌سازی بی نقش و بی مجوز ندارد.',
    items: rows.map(r => ({
      id: r.instanceId,
      code: r.code,
      title: r.title,
      subtitle: `سند ${r.entityId}، اقدام: ${r.transitionTitle}`,
      details: 'تصویر این فرایند اقدامی دارد که نه نقش دارد نه مجوز؛ فرایند بازنویسی نمی‌شود.',
    })),
    metrics: { instances: instanceCount, unguardedTransitions: rows.length },
  };
}
