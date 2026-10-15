import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowTransitions } from '../../db/schema.js';

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
  /** source step key > target step key > action key: the same action in the draft and the published version */
  stableKey: string;
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
             WHERE (s ->> 'id') = (t ->> 'toStateId') LIMIT 1), '') AS "toStateKey",
           coalesce((SELECT s ->> 'stateKey' FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(v.dsl_json -> 'states') = 'array' THEN v.dsl_json -> 'states' ELSE '[]'::jsonb END) s
             WHERE (s ->> 'id') = (t ->> 'fromStateId') LIMIT 1), '') AS "fromStateKey",
           coalesce(t ->> 'actionKey', '') AS "actionKey"
    FROM workflow_definitions d
    JOIN workflow_definition_versions v ON v.definition_id = d.id AND v.status = 'published'
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(v.dsl_json -> 'transitions') = 'array' THEN v.dsl_json -> 'transitions' ELSE '[]'::jsonb END) t
    WHERE d.entity_type = ${entityType} AND d.is_active = 1
    ORDER BY d.id, 4`);
  const rows = (result.rows ?? []) as unknown as Array<Omit<PublishedWorkflowAction, 'stableKey'> & { fromStateKey: string; actionKey: string }>;
  return rows.map(({ fromStateKey, actionKey, ...r }) => ({
    ...r, definitionId: Number(r.definitionId), transitionId: Number(r.transitionId), title: r.title ?? '',
    stableKey: `${fromStateKey}>${r.toStateKey}>${actionKey}`,
  }));
}

const isBlank = (v: string) => v.trim() === '';

/** An action with neither role nor permission. */
export const isUnguardedAction = (a: Pick<PublishedWorkflowAction, 'requiredRole' | 'requiredPermission'>) => isBlank(a.requiredRole) && isBlank(a.requiredPermission);

/**
 * The same stable key for an action of the step tables, read in SQL: a draft saves the steps and actions with new ids, so
 * the key names its source step, target step and action key, never an id.
 */
export const liveActionStableKey = sql<string>`concat_ws('>',
  coalesce((SELECT ws.state_key FROM workflow_states ws WHERE ws.id = ${workflowTransitions.fromStateId}), ''),
  coalesce((SELECT ws.state_key FROM workflow_states ws WHERE ws.id = ${workflowTransitions.toStateId}), ''),
  coalesce(${workflowTransitions.actionKey}, ''))`;

/**
 * Rows of the step tables and of the published versions, each action of a definition once: an action unchanged between
 * the draft in the step tables and the published version has another id in each, so rows are matched by `stableKey`.
 */
export function mergeWorkflowActionRows<T extends { definitionId: number; transitionId: number; stableKey: string }>(
  live: T[], published: T[],
): Array<Omit<T, 'stableKey'>> {
  const keyOf = (r: T) => `${r.definitionId}:${r.stableKey}`;
  const seen = new Set(live.map(keyOf));
  return [...live, ...published.filter(r => !seen.has(keyOf(r)))]
    .sort((a, b) => a.definitionId - b.definitionId || a.transitionId - b.transitionId)
    .map(({ stableKey: _key, ...row }) => row);
}
