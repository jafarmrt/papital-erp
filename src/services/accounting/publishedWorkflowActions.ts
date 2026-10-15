import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';

/**
 * v10.1.20 (TD-1270, D-06 part D): the actions of the published version of each active definition of a record type, read
 * from its stored snapshot. While a definition has an unpublished draft the step tables hold the draft, and new records
 * run the published version, so the workflow health checks read both. Reads only workflow tables, like those checks.
 */
export interface PublishedWorkflowAction {
  definitionId: number;
  code: string;
  title: string;
  transitionId: number;
  transitionTitle: string;
  requiredRole: string;
  requiredPermission: string;
  autoActionKey: string;
  toStateKey: string;
}

export async function publishedWorkflowActions(db: DbExecutor, entityType: string): Promise<PublishedWorkflowAction[]> {
  const result = await db.execute(sql`
    SELECT d.id AS "definitionId", d.code, d.title,
           CASE WHEN (t ->> 'id') ~ '^[0-9]+$' THEN (t ->> 'id')::int ELSE 0 END AS "transitionId",
           coalesce(t ->> 'title', '') AS "transitionTitle",
           coalesce(t ->> 'requiredRole', '') AS "requiredRole",
           coalesce(t ->> 'requiredPermission', '') AS "requiredPermission",
           coalesce(t ->> 'autoActionKey', '') AS "autoActionKey",
           coalesce((SELECT s ->> 'stateKey' FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(v.dsl_json -> 'states') = 'array' THEN v.dsl_json -> 'states' ELSE '[]'::jsonb END) s
             WHERE (s ->> 'id') = (t ->> 'toStateId') LIMIT 1), '') AS "toStateKey"
    FROM workflow_definitions d
    JOIN workflow_definition_versions v ON v.definition_id = d.id AND v.status = 'published'
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(v.dsl_json -> 'transitions') = 'array' THEN v.dsl_json -> 'transitions' ELSE '[]'::jsonb END) t
    WHERE d.entity_type = ${entityType} AND d.is_active = 1
    ORDER BY d.id, 4`);
  const rows = (result.rows ?? []) as unknown as PublishedWorkflowAction[];
  return rows.map(r => ({ ...r, definitionId: Number(r.definitionId), transitionId: Number(r.transitionId), title: r.title ?? '' }));
}

const isBlank = (v: string) => v.trim() === '';

/** An action with neither role nor permission. */
export const isUnguardedAction = (a: Pick<PublishedWorkflowAction, 'requiredRole' | 'requiredPermission'>) => isBlank(a.requiredRole) && isBlank(a.requiredPermission);

/** Rows of the step tables and of the published versions, each (definition, action id) once. */
export function mergeWorkflowActionRows<T extends { definitionId: number; transitionId: number }>(live: T[], published: T[]): T[] {
  const seen = new Set(live.map(r => `${r.definitionId}:${r.transitionId}`));
  return [...live, ...published.filter(r => !seen.has(`${r.definitionId}:${r.transitionId}`))]
    .sort((a, b) => a.definitionId - b.definitionId || a.transitionId - b.transitionId);
}
