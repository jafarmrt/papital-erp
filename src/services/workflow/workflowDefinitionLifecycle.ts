import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { orm, type DbExecutor } from '../../db/drizzle.js';
import { workflowDefinitions, workflowInstances, workflowStates, workflowTransitions } from '../../db/schema.js';
import { logActivity } from '../../lib/auditLogger.js';
import { ROW_ADVISORY_LOCK_NAMESPACES } from '../../lib/advisoryLock.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { workflowDesignErrors } from '../../lib/workflow/workflowDesignRules.js';
import { workflowEntityTypeLabel } from '../../lib/workflow/workflowEntityLabels.js';
import { workflowDeactivationRefusal } from '../../lib/workflow/workflowLifecycle.js';

/**
 * v10.1.6 (TD-1229, D-06 part A, OBS-R2-65): a workflow definition is turned on, off, archived and restored here, each
 * in one transaction under the record type lock and the definition row lock, with its audit row written with the same
 * `tx`. At most one definition of a record type is active (partial unique index uq_workflow_definitions_active_entity_type,
 * migration 0110); running records keep their own version snapshot whatever happens to the definition (decision ت۱).
 */

export const WORKFLOW_DEFINITION_AUDIT_ENTITY = 'طرح گردش کار';

type DefinitionRow = typeof workflowDefinitions.$inferSelect;

/** Locks the given record types' definitions (transaction advisory lock, sorted, so two callers never deadlock). */
export async function lockWorkflowEntityTypes(tx: DbExecutor, entityTypes: string[]): Promise<void> {
  for (const type of [...new Set(entityTypes)].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROW_ADVISORY_LOCK_NAMESPACES.WORKFLOW_DEFINITION_TYPE}::int, hashtext(${type}::text))`);
  }
}

export async function activeDefinitionsOfType(tx: DbExecutor, entityType: string, exceptId?: number): Promise<Array<{ id: number; title: string; code: string }>> {
  return tx.select({ id: workflowDefinitions.id, title: workflowDefinitions.title, code: workflowDefinitions.code })
    .from(workflowDefinitions)
    .where(and(
      eq(workflowDefinitions.entityType, entityType),
      eq(workflowDefinitions.isActive, 1),
      exceptId ? ne(workflowDefinitions.id, exceptId) : undefined,
    ))
    .orderBy(asc(workflowDefinitions.id));
}

/** Records of any status ever started with this definition. */
export async function startedInstanceCount(db: DbExecutor, definitionId: number): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(workflowInstances)
    .where(eq(workflowInstances.workflowDefinitionId, definitionId));
  return Number(row?.n ?? 0);
}

const lifecycleState = (d: Pick<DefinitionRow, 'isActive' | 'isArchived'>) => ({ isActive: Number(d.isActive ?? 0), isArchived: Number(d.isArchived ?? 0) });

async function lockDefinition(tx: DbExecutor, id: number): Promise<DefinitionRow> {
  const [peek] = await tx.select({ entityType: workflowDefinitions.entityType }).from(workflowDefinitions).where(eq(workflowDefinitions.id, id));
  if (!peek) throw new NotFoundError('گردش کار یافت نشد.', undefined, 'WF_DEF_NOT_FOUND');
  await lockWorkflowEntityTypes(tx, [peek.entityType]);
  const [def] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, id)).for('update');
  if (!def) throw new NotFoundError('گردش کار یافت نشد.', undefined, 'WF_DEF_NOT_FOUND');
  return def;
}

async function writeState(tx: DbExecutor, def: DefinitionRow, next: { isActive: number; isArchived: number }, description: string, req?: Request): Promise<void> {
  await tx.update(workflowDefinitions).set(next).where(eq(workflowDefinitions.id, def.id));
  await logActivity({
    tx, req, action: 'UPDATE', entity: WORKFLOW_DEFINITION_AUDIT_ENTITY, entityId: def.id, description,
    details: { code: def.code, entityType: def.entityType, before: lifecycleState(def), after: next },
  });
}

/** Design errors of a stored definition (the save rule), so only a valid design is turned on. */
async function storedDesignErrors(tx: DbExecutor, definitionId: number): Promise<string[]> {
  const states = await tx.select({ id: workflowStates.id, stateKey: workflowStates.stateKey, title: workflowStates.title, stateType: workflowStates.stateType })
    .from(workflowStates).where(eq(workflowStates.workflowDefinitionId, definitionId));
  const transitions = await tx.select({
    fromStateId: workflowTransitions.fromStateId, toStateId: workflowTransitions.toStateId, actionKey: workflowTransitions.actionKey,
    title: workflowTransitions.title, approvalRuleType: workflowTransitions.approvalRuleType, kValue: workflowTransitions.kValue,
    requiredPermission: workflowTransitions.requiredPermission, requiredRole: workflowTransitions.requiredRole,
    isInitiatorOnly: workflowTransitions.isInitiatorOnly, isInitiatorExcluded: workflowTransitions.isInitiatorExcluded,
  }).from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, definitionId));
  return workflowDesignErrors(states.map(s => ({ ...s, stateType: s.stateType ?? undefined })), transitions);
}

export interface WorkflowActiveResult {
  changed: boolean;
  definition: DefinitionRow;
  /** the definition of the same record type turned off by this activation */
  replaced?: { id: number; title: string };
}

/**
 * Turns a definition on or off. Turning on refuses an archived definition or an invalid design and, when another
 * definition of the record type is active, asks for `replaceActive` (409 WF_ACTIVE_DEFINITION_EXISTS naming it) and then
 * turns that one off in the same transaction (decision ت۲). Turning off the purchase requisition workflow is refused:
 * it is replaced only by activating another one.
 */
export async function setWorkflowDefinitionActive(params: { id: number; active: boolean; replaceActive?: boolean; req?: Request }): Promise<WorkflowActiveResult> {
  return orm.transaction(async (tx) => {
    const def = await lockDefinition(tx, params.id);
    const isActive = Number(def.isActive ?? 0) === 1;
    if (!params.active) {
      if (!isActive) return { changed: false, definition: def };
      const refusal = workflowDeactivationRefusal(def.entityType);
      if (refusal) throw new ConflictError(refusal, undefined, 'WF_REQUIRED_WORKFLOW');
      await writeState(tx, def, { isActive: 0, isArchived: 0 }, `غیرفعال کردن گردش کار «${def.title}»`, params.req);
      return { changed: true, definition: { ...def, isActive: 0 } };
    }

    if (Number(def.isArchived ?? 0) === 1) {
      throw new ConflictError(`گردش کار «${def.title}» بایگانی شده است؛ نخست آن را از بایگانی بازگردانید.`, undefined, 'WF_DEFINITION_ARCHIVED');
    }
    if (isActive) return { changed: false, definition: def };
    const errors = await storedDesignErrors(tx, def.id);
    if (errors.length > 0) {
      throw new ValidationError(`گردش کار «${def.title}» فعال نشد: ${errors.join(' ')}`, { errors }, 'WF_DEFINITION_DESIGN_INVALID');
    }
    const others = await activeDefinitionsOfType(tx, def.entityType, def.id);
    if (others.length > 0 && !params.replaceActive) {
      const current = others[0];
      throw new ConflictError(
        `گردش کار «${current.title}» برای «${workflowEntityTypeLabel(def.entityType)}» فعال است؛ با فعال کردن این گردش کار، آن یکی غیرفعال می‌شود.`,
        { activeDefinitionId: current.id, activeTitle: current.title },
        'WF_ACTIVE_DEFINITION_EXISTS',
      );
    }
    for (const other of others) {
      const [row] = await tx.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, other.id)).for('update');
      await writeState(tx, row, { isActive: 0, isArchived: 0 }, `غیرفعال کردن گردش کار «${row.title}» با فعال شدن «${def.title}»`, params.req);
    }
    await writeState(tx, def, { isActive: 1, isArchived: 0 }, `فعال کردن گردش کار «${def.title}»`, params.req);
    return { changed: true, definition: { ...def, isActive: 1 }, replaced: others[0] ? { id: others[0].id, title: others[0].title } : undefined };
  });
}

/**
 * Archives an inactive definition or restores an archived one (decision ت۳: restorable). A definition is never deleted:
 * past records and their history point to it. A restored definition comes back inactive.
 */
export async function setWorkflowDefinitionArchived(params: { id: number; archived: boolean; req?: Request }): Promise<{ changed: boolean; definition: DefinitionRow }> {
  return orm.transaction(async (tx) => {
    const def = await lockDefinition(tx, params.id);
    const isArchived = Number(def.isArchived ?? 0) === 1;
    if (params.archived === isArchived) return { changed: false, definition: def };
    if (params.archived && Number(def.isActive ?? 0) === 1) {
      throw new ConflictError(`گردش کار «${def.title}» فعال است؛ نخست آن را غیرفعال کنید، سپس بایگانی کنید.`, undefined, 'WF_DEFINITION_ACTIVE');
    }
    const next = { isActive: 0, isArchived: params.archived ? 1 : 0 };
    await writeState(tx, def, next, params.archived ? `بایگانی گردش کار «${def.title}»` : `بازگرداندن گردش کار «${def.title}» از بایگانی`, params.req);
    return { changed: true, definition: { ...def, ...next } };
  });
}
