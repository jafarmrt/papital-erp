import { asc, eq, inArray, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { workflowDefinitions, workflowTransitions } from '../../db/schema.js';
import { publishedVersionOf, recordDefinitionVersion } from './workflowSnapshot.js';
import { logActivity } from '../../lib/auditLogger.js';

/**
 * v10.2.0 (package 1 of the 10.2 start plan): migration 0123 removed the key `audit.create` («شروع دوره انبارگردانی»,
 * «ثبت شمارش واقعی فیزیکی کالاها») from the catalog and from every role, but a workflow action that asked it was left
 * as it was, so only the system admin could sign it (listed by `workflow_unknown_permission_action`). Recording a stock
 * count is asked by `audit.apply` today, so such an action asks that key.
 *
 * Runs at boot with the default workflows, each definition in its own transaction under its row lock: the actions are
 * rewritten on the same rows (ids unchanged), a new published version is recorded and one «طرح گردش کار» audit row is
 * written with `tx`. A definition holding an unpublished draft is left alone (publishing would publish the draft) and
 * stays listed by the health check. Running instances keep their own snapshot. A second run finds nothing to do.
 */
import { REMOVED_STOCK_COUNT_START_KEY, REPLACED_PERMISSION_KEYS } from '../../lib/permissions/replacedPermissionKeys.js';

export { REMOVED_STOCK_COUNT_START_KEY, REPLACED_PERMISSION_KEYS };

/**
 * The key a workflow action's stored permission means today: a key removed from the catalog is read as the key that
 * replaced it (a running instance keeps its snapshot, so it may still ask the removed key), any other key as it is.
 * An own-property lookup, so a stored text such as `constructor` is never read off the object prototype.
 */
export function effectivePermissionKey(stored: string | null | undefined): string {
  const key = (stored || '').trim();
  return Object.hasOwn(REPLACED_PERMISSION_KEYS, key) ? REPLACED_PERMISSION_KEYS[key] : key;
}

const removedKeys = Object.keys(REPLACED_PERMISSION_KEYS);
const trimmedPermission = sql<string>`btrim(coalesce(${workflowTransitions.requiredPermission}, ''))`;

/** Replaces removed permission keys in workflow actions; answers the ids of the definitions it changed */
export async function replaceRemovedWorkflowPermissions(): Promise<number[]> {
  const candidates = await orm.selectDistinct({ id: workflowTransitions.workflowDefinitionId })
    .from(workflowTransitions)
    .where(inArray(trimmedPermission, removedKeys))
    .orderBy(asc(workflowTransitions.workflowDefinitionId));
  const changed: number[] = [];
  for (const { id } of candidates) {
    if (await replaceInDefinition(id)) changed.push(id);
  }
  return changed;
}

async function replaceInDefinition(definitionId: number): Promise<boolean> {
  return orm.transaction(async (tx) => {
    const [def] = await tx.select().from(workflowDefinitions)
      .where(eq(workflowDefinitions.id, definitionId)).for('update');
    if (!def) return false;
    if (Number(def.version) !== publishedVersionOf(def)) return false;
    const actions = await tx.select({ id: workflowTransitions.id, title: workflowTransitions.title, permission: trimmedPermission })
      .from(workflowTransitions)
      .where(sql`${workflowTransitions.workflowDefinitionId} = ${definitionId} AND ${inArray(trimmedPermission, removedKeys)}`)
      .orderBy(asc(workflowTransitions.id));
    if (actions.length === 0) return false;
    for (const action of actions) {
      await tx.update(workflowTransitions)
        .set({ requiredPermission: REPLACED_PERMISSION_KEYS[action.permission] })
        .where(eq(workflowTransitions.id, action.id));
    }
    const description = 'مجوز حذف‌شده «شروع دوره انبارگردانی» در اقدام‌ها با «اعمال و تسویه مغایرت» جایگزین شد';
    const version = await recordDefinitionVersion(tx, def.id, { title: def.title, description, status: 'published' });
    await logActivity({
      tx, action: 'UPDATE', entity: 'طرح گردش کار', entityId: def.id,
      description: `گردش کار «${def.title}»: ${description}`,
      details: {
        code: def.code, version,
        changes: actions.map(a => ({
          transitionId: a.id, title: a.title,
          before: { requiredPermission: a.permission },
          after: { requiredPermission: REPLACED_PERMISSION_KEYS[a.permission] },
        })),
      },
    });
    return true;
  });
}
