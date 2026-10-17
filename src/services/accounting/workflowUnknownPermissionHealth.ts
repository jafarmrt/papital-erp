import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions, workflowTransitions } from '../../db/schema.js';
import { isCatalogPermission } from '../../lib/permissions/permissionCatalog.js';
import { WORKFLOW_ENTITY_TYPES } from '../../lib/workflow/workflowEntityLabels.js';
import type { HealthCheckTestResult } from '../../types.js';
import { liveActionStableKey, mergeWorkflowActionRows, publishedWorkflowActions } from './publishedWorkflowActions.js';

/**
 * v10.1.66 (#304 review): an action of an active workflow whose permission is no longer a catalog key — migration 0123
 * removed `audit.create` — is signed by no one but the system admin. A design is saved only with catalog keys, so such an
 * action is older than the key's removal; it is only listed here, never rewritten, for the admin to pick another key.
 * Reads only workflow tables, like the other workflow health checks.
 */
export interface UnknownPermissionActionRow {
  definitionId: number;
  code: string;
  title: string;
  transitionId: number;
  transitionTitle: string;
  requiredPermission: string;
}

const isUnknownPermission = (permission: string) => permission.trim() !== '' && !isCatalogPermission(permission.trim());

export async function findUnknownPermissionActions(db: DbExecutor): Promise<UnknownPermissionActionRow[]> {
  const live = await db.select({
    definitionId: workflowDefinitions.id,
    code: workflowDefinitions.code,
    title: workflowDefinitions.title,
    transitionId: workflowTransitions.id,
    transitionTitle: workflowTransitions.title,
    requiredPermission: workflowTransitions.requiredPermission,
    stableKey: liveActionStableKey,
  })
    .from(workflowTransitions)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowTransitions.workflowDefinitionId))
    .where(and(eq(workflowDefinitions.isActive, 1), sql`btrim(coalesce(${workflowTransitions.requiredPermission}, '')) <> ''`))
    .orderBy(asc(workflowDefinitions.id), asc(workflowTransitions.id));
  const liveRows = live
    .map(r => ({ ...r, code: r.code ?? '', title: r.title ?? '', transitionTitle: r.transitionTitle ?? '', requiredPermission: (r.requiredPermission ?? '').trim() }))
    .filter(r => isUnknownPermission(r.requiredPermission));
  // one query at a time: `db` may be a transaction, which runs a single query at once (TD-1279)
  const publishedByType = [];
  for (const t of WORKFLOW_ENTITY_TYPES) publishedByType.push(await publishedWorkflowActions(db, t.id));
  const published = publishedByType.flat()
    .filter(a => isUnknownPermission(a.requiredPermission))
    .map(a => ({ definitionId: a.definitionId, code: a.code, title: a.title, transitionId: a.transitionId, transitionTitle: a.transitionTitle, requiredPermission: a.requiredPermission.trim(), stableKey: a.stableKey }));
  return mergeWorkflowActionRows(liveRows, published);
}

export function buildUnknownPermissionActionHealthTest(rows: UnknownPermissionActionRow[]): HealthCheckTestResult {
  const definitionCount = new Set(rows.map(r => r.definitionId)).size;
  return {
    id: 'workflow_unknown_permission_action',
    category: 'system',
    title: 'اقدام گردش کار با مجوز حذف‌شده',
    description: 'مجوز هر اقدام گردش کار فعال باید در فهرست مجوزهای سامانه باشد؛ اقدامی که مجوزش حذف شده جز مدیر سامانه امضاکننده‌ای ندارد و فقط این‌جا فهرست می‌شود',
    status: rows.length > 0 ? 'warning' : 'healthy',
    scoreImpact: -Math.min(5, rows.length),
    count: rows.length,
    message: rows.length > 0
      ? `${rows.length} اقدام در ${definitionCount} گردش کار مجوزی دارد که دیگر در سامانه نیست؛ در طراح گردش کار برای این اقدام‌ها مجوز دیگری بگذارید.`
      : 'مجوز همه اقدام‌های گردش کار در فهرست مجوزهای سامانه است.',
    items: rows.map(r => ({
      id: r.transitionId,
      code: r.code,
      title: r.title,
      subtitle: `اقدام: ${r.transitionTitle}`,
      details: `مجوز «${r.requiredPermission}» در فهرست مجوزهای سامانه نیست؛ مجوز دیگری تعیین کنید.`,
    })),
    metrics: { unknownPermissionTransitions: rows.length, definitions: definitionCount },
  };
}
