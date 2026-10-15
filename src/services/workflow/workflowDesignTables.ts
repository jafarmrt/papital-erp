import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { workflowStates, workflowTransitions } from '../../db/schema.js';
import { ValidationError } from '../../errors/customErrors.js';
import { storedTransitionRole } from './transitionRoles.js';

/** A step as the designer, the seed and a version snapshot send it. */
export interface DesignStateInput {
  id?: number | string;
  code?: string;
  key?: string;
  stateKey?: string;
  title: string;
  stateType?: string | null;
  stepOrder?: number | null;
  slaHours?: number | null;
  color?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  x?: number;
  y?: number;
  [key: string]: unknown;
}

/** An action as the designer, the seed and a version snapshot send it. */
export interface DesignTransitionInput {
  id?: number | string;
  from?: string | number;
  to?: string | number;
  fromStateId?: number | string;
  toStateId?: number | string;
  fromStateKey?: string;
  toStateKey?: string;
  actionKey: string;
  key?: string;
  title?: string | null;
  requiredRole?: string | null;
  requiredPermission?: string | null;
  ruleConditionsJson?: unknown;
  approvalRuleType?: string | null;
  parallelApprovalRule?: string;
  kValue?: number | null;
  autoActionKey?: string | null;
  /** v8.0.102 (TD-392): آغازکننده فرایند این انتقال را اجرا نمی‌کند */
  isInitiatorExcluded?: number | boolean | null;
  isInitiatorOnly?: number | boolean | null;
  [key: string]: unknown;
}

/**
 * Replaces a definition's step and action rows with a design (new ids). v10.1.17 (TD-1270): shared by the design save and
 * the revert to an earlier version, whose snapshot steps carry their old ids and its actions point to them.
 */
export async function writeDesignTables(
  tx: DbExecutor,
  definitionId: number,
  states: DesignStateInput[],
  transitions: DesignTransitionInput[] | undefined,
  knownRoles: Map<string, string>,
): Promise<void> {
  await tx.delete(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, definitionId));
  await tx.delete(workflowStates).where(eq(workflowStates.workflowDefinitionId, definitionId));

  const stateIdMap = new Map<number | string, number>();

  for (const [index, st] of states.entries()) {
    const [insertedSt] = await tx.insert(workflowStates).values({
      workflowDefinitionId: definitionId,
      stateKey: st.stateKey || st.key || 'state',
      title: st.title || 'وضعیت',
      stateType: st.stateType || 'normal',
      color: st.color || 'gray',
      // v9.0.47 (TD-454): گام بی ترتیب جای خودش در فهرست را می‌گیرد (پیش‌تر همه گام‌ها ترتیب ۱ می‌گرفتند)
      stepOrder: Number.isInteger(st.stepOrder) && Number(st.stepOrder) > 0 ? Number(st.stepOrder) : index + 1,
      slaHours: Number(st.slaHours) || 24,
      positionX: Number(st.positionX) || Number(st.x) || 100,
      positionY: Number(st.positionY) || Number(st.y) || 100
    }).returning();

    if (st.id !== undefined) {
      stateIdMap.set(st.id, insertedSt.id);
      stateIdMap.set(Number(st.id), insertedSt.id);
      stateIdMap.set(String(st.id), insertedSt.id);
    }
    if (st.stateKey) stateIdMap.set(st.stateKey, insertedSt.id);
    if (st.key) stateIdMap.set(st.key, insertedSt.id);
  }

  for (const tr of transitions ?? []) {
    const fromKey = tr.fromStateId ?? tr.fromStateKey ?? tr.from;
    const toKey = tr.toStateId ?? tr.toStateKey ?? tr.to;

    const fromId = fromKey !== undefined ? stateIdMap.get(fromKey) : undefined;
    const toId = toKey !== undefined ? stateIdMap.get(toKey) : undefined;

    // v9.0.45 (TD-452): اقدامی که مبدأ یا مقصدش پیدا نشود رد می‌شود، نه بی‌صدا حذف
    if (!fromId || !toId) {
      throw new ValidationError(`طرح گردش کار ذخیره نشد: گام مبدأ یا مقصد اقدام «${tr.title || tr.actionKey}» پیدا نشد.`);
    }
    await tx.insert(workflowTransitions).values({
      workflowDefinitionId: definitionId,
      fromStateId: fromId,
      toStateId: toId,
      actionKey: tr.actionKey || tr.key || 'action',
      title: tr.title || 'اقدام',
      requiredRole: storedTransitionRole(tr.requiredRole ?? undefined, knownRoles),
      requiredPermission: (tr.requiredPermission || '').trim(),
      approvalRuleType: tr.approvalRuleType || tr.parallelApprovalRule || 'SINGLE',
      kValue: Number(tr.kValue) || 1,
      ruleConditionsJson: tr.ruleConditionsJson || [],
      autoActionKey: tr.autoActionKey || '',
      isInitiatorExcluded: tr.isInitiatorExcluded === true || Number(tr.isInitiatorExcluded) === 1 ? 1 : 0,
      isInitiatorOnly: tr.isInitiatorOnly === true || Number(tr.isInitiatorOnly) === 1 ? 1 : 0
    });
  }
}
