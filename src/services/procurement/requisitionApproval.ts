import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { purchaseRequisitions, users, workflowDefinitions, workflowInstances, workflowStates, workflowTransitions } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { WorkflowTransitionExecutor, type WorkflowSnapshotDsl, type WorkflowStateSnapshot, type WorkflowTransitionSnapshot } from '../workflow/workflowTransitionExecutor.js';
import { isUsableSnapshot, publishedDesignOf } from '../workflow/workflowSnapshot.js';
import { OPEN_REQUISITION_STATUSES } from '../../lib/procurement/requisitionFields.js';

/** فیلدهای گام گردش‌کار که تدارکات می‌خواند (از تصویر فرایند یا جدول workflow_states) */
export type WorkflowStateRef = Pick<WorkflowStateSnapshot, 'id' | 'stateKey' | 'title'>;
/** فیلدهای انتقال گردش‌کار که تدارکات می‌خواند (از تصویر فرایند یا جدول workflow_transitions) */
export type WorkflowTransitionRef = Pick<WorkflowTransitionSnapshot, 'id' | 'fromStateId' | 'toStateId' | 'actionKey' | 'title' | 'isInitiatorExcluded'>;

/** اقدام‌های «تأیید» درخواست خرید */
export const APPROVE_ACTION_KEYS = ['direct_admin_order', 'approve_order', 'approve_request', 'direct_order'];
/** اقدام‌های «دریافت کالا»ی درخواست خرید */
export const RECEIVE_ACTION_KEYS = ['receive_items', 'mark_received', 'receive'];
/** گام درخواستِ تأییدشده (در حال خرید) و گام «دریافت‌شده» */
export const APPROVED_STEP_KEY = 'ordered';
export const RECEIVED_STEP_KEY = 'received';

/** کاربری که روی درخواست کار می‌کند؛ نقش و مجوزهایش به موتور گردش‌کار داده می‌شود */
export interface RequisitionActor {
  id?: number;
  username?: string;
  /** v10.0.72 (TD-1132): shown on the orders a conversion writes */
  fullName?: string;
  role?: string;
  permissions?: string[];
}

type InstanceRow = typeof workflowInstances.$inferSelect;

export interface RequisitionFlow {
  instance: InstanceRow;
  states: WorkflowStateRef[];
  transitions: WorkflowTransitionRef[];
  stepKey: string;
  stepTitle: string;
}

/**
 * v7.0.111 (TD-238): گام‌ها و انتقال‌های فرایند درخواست خرید — از تصویر خود فرایند فقط وقتی با شناسه‌های پایگاه‌داده
 * ساخته شده (isUsableSnapshot، AGENTS.md §14.3)، وگرنه از جدول‌های جاری تعریف؛ تصویر قدیمی بدون شناسه به کار نمی‌رود.
 */
export async function requisitionWorkflowGraph(
  wfInst: Pick<InstanceRow, 'snapshotDsl' | 'workflowDefinitionId'>,
  db: DbExecutor,
): Promise<{ states: WorkflowStateRef[]; transitions: WorkflowTransitionRef[] }> {
  const snapshot = wfInst.snapshotDsl as WorkflowSnapshotDsl | null;
  if (isUsableSnapshot(snapshot)) return { states: snapshot.states ?? [], transitions: snapshot.transitions ?? [] };
  const states = await db.select().from(workflowStates).where(eq(workflowStates.workflowDefinitionId, wfInst.workflowDefinitionId));
  const transitions = await db.select().from(workflowTransitions).where(eq(workflowTransitions.workflowDefinitionId, wfInst.workflowDefinitionId));
  return { states, transitions };
}

/** the requisition fields `requisitionFlow` reads; the requester starts a missing workflow instance */
type RequisitionFlowRow = { id: number; workflowInstanceId?: number | null; requestedById?: number | null };

/**
 * v11 phase 6.3a (reviews of #406, U10): a requisition with no workflow instance (an older one, or one whose workflow
 * failed to start at registration) gets it here, in its requester's name as at registration, under the requisition row
 * lock the caller holds. Before, whoever acted first (split, approve, receive) became its initiator, so a step that
 * leaves the initiator out refused every approver with a 403 and the rolled-back request failed the same way each time.
 * An older requisition with no requester (`requestedById` empty) starts with no initiator, so no approver is left out (and
 * a step only its initiator may take is then left to the system admin). `actorId` is the user whose action starts it:
 * the task-arrived notice skips them, since they finish the first task in the same transaction.
 */
export async function ensureRequisitionInstance(tx: DbExecutor, req: RequisitionFlowRow, actorId?: number): Promise<number> {
  if (req.workflowInstanceId) return req.workflowInstanceId;
  const [requester] = req.requestedById
    ? await tx.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, req.requestedById))
    : [];
  const started = await WorkflowTransitionExecutor.startInstance({
    entityType: 'purchase_requisition',
    entityId: String(req.id),
    userId: requester?.id,
    userName: requester?.username,
    actorUserId: actorId,
    tx,
  });
  req.workflowInstanceId = started.id;
  await tx.update(purchaseRequisitions).set({ workflowInstanceId: started.id }).where(eq(purchaseRequisitions.id, req.id));
  return started.id;
}

/**
 * نمونه گردش‌کار درخواست (زیر قفل ردیف درخواست که فراخواننده گرفته است) و گام جاری‌اش؛ درخواستی که نمونه ندارد
 * (`ensureRequisitionInstance`) در همین تراکنش نمونه می‌گیرد.
 */
export async function requisitionFlow(tx: DbExecutor, req: RequisitionFlowRow, actorId?: number): Promise<RequisitionFlow> {
  const instanceId = await ensureRequisitionInstance(tx, req, actorId);
  const [instance] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId));
  if (!instance) throw new ValidationError('نمونه فرایند گردش کار درخواست خرید یافت نشد.');
  const { states, transitions } = await requisitionWorkflowGraph(instance, tx);
  const step = states.find(s => s.id === instance.currentStateId);
  return { instance, states, transitions, stepKey: step?.stateKey ?? '', stepTitle: step?.title ?? '' };
}

/** انتقال گام جاری با یکی از اقدام‌ها، به ترتیب همان فهرست */
export function transitionFromStep(
  flow: Pick<RequisitionFlow, 'states' | 'transitions'> & { instance: Pick<InstanceRow, 'currentStateId'> },
  actionKeys: string[],
  toStepKey?: string,
): WorkflowTransitionRef | undefined {
  const toStateId = toStepKey === undefined ? undefined : flow.states.find(s => s.stateKey === toStepKey)?.id;
  const candidates = flow.transitions.filter(t => t.fromStateId === flow.instance.currentStateId
    && (toStateId === undefined || t.toStateId === toStateId));
  for (const key of actionKeys) {
    const match = candidates.find(t => t.actionKey === key);
    if (match) return match;
  }
  return toStepKey === undefined ? undefined : candidates[0];
}

interface ApprovalOptions {
  /** کاربر مجوز تأیید درخواست خرید را دارد (`procurement.approve` / `procurement.manage`، بیرون از تراکنش سنجیده شده) */
  mayApprove: boolean;
  comment: string;
  allowBackdate?: boolean;
  snapshotData?: Record<string, unknown>;
}

/**
 * v9.0.315 (TD-689، B10-02، تصمیم ت۱ الف): درخواست خرید فقط از گام «تأییدشده» سفارش و تحویل می‌شود. درخواستی که هنوز
 * تأیید نشده، برای کاربری که حق تأیید دارد نخست انتقال(های) تأیید گام جاری را به نام همان کاربر اجرا می‌کند (نقش و مجوز
 * او سنجیده و در تاریخچه ثبت می‌شود، همان قاعده TD-390)؛ برای دیگران ۴۰۹ `REQUISITION_NOT_APPROVED`. گام فقط با
 * `executeTransition` جابه‌جا می‌شود. پیش‌تر تبدیل درخواست تأییدنشده را هم می‌پذیرفت و تراکنش دومی گام را مستقیم به
 * «تأییدشده» (یا پس از سفارش بخشی، به «در انتظار»، A02-15) می‌نوشت، بی انتقال و بی ردیف تاریخچه.
 */
export async function ensureRequisitionApproved(
  tx: DbExecutor,
  req: RequisitionFlowRow & { code: string },
  user: RequisitionActor,
  opts: ApprovalOptions,
): Promise<RequisitionFlow> {
  let flow = await requisitionFlow(tx, req, user.id);
  for (let round = 0; flow.stepKey !== APPROVED_STEP_KEY && round <= flow.states.length; round += 1) {
    const approve = flow.instance.status === 'IN_PROGRESS' ? transitionFromStep(flow, APPROVE_ACTION_KEYS) : undefined;
    if (!opts.mayApprove || !approve) {
      throw new ConflictError(
        `درخواست خرید ${req.code} هنوز تأیید نشده است (گام «${flow.stepTitle || flow.stepKey || '-'}»)؛ سفارش و تحویل پس از تأیید درخواست انجام می‌شود.`,
        { step: flow.stepKey }, 'REQUISITION_NOT_APPROVED',
      );
    }
    const result = await WorkflowTransitionExecutor.executeTransition({
      instanceId: flow.instance.id,
      transitionId: approve.id,
      userId: user.id,
      userName: user.username,
      userRole: user.role,
      userPermissions: user.permissions ?? [],
      comment: opts.comment,
      snapshotData: opts.snapshotData,
      allowBackdate: opts.allowBackdate,
      tx,
    });
    if (!('toState' in result) || !result.toState) {
      throw new ConflictError(`تأیید درخواست خرید ${req.code} هنوز امضاهای دیگری می‌خواهد؛ سفارش پس از تکمیل تأیید صادر می‌شود.`, undefined, 'WF_APPROVAL_PENDING');
    }
    flow = await requisitionFlow(tx, req);
  }
  if (flow.stepKey !== APPROVED_STEP_KEY) {
    throw new ConflictError(`درخواست خرید ${req.code} به گام تأییدشده نرسید.`, { step: flow.stepKey }, 'REQUISITION_NOT_APPROVED');
  }
  return flow;
}

/**
 * v11 phase 6.3a (U10): the open requisitions of a list page whose approval this user may not sign, because the user
 * started the requisition's workflow and an approval step on the way to «تأییدشده» leaves the initiator out (the engine's
 * `initiatorExcluded`, system admin exempt). The desk disables «تفکیک و صدور فاکتور» on them with the reason; before, the
 * initiator filled the whole split form and only then got the 403 `WF_INITIATOR_EXCLUDED` of `ensureRequisitionApproved`.
 */
export async function requisitionsInitiatorCannotApprove(
  db: DbExecutor,
  rows: ReadonlyArray<{ id: number; status?: string | null; workflowInstanceId?: number | null; requestedById?: number | null }>,
  viewer: { id?: number; role?: string },
): Promise<Set<number>> {
  const blocked = new Set<number>();
  const open = rows.filter(r => OPEN_REQUISITION_STATUSES.has(String(r.status)));
  if (!viewer.id || open.length === 0) return blocked;
  const signer = { userId: viewer.id, actorId: viewer.id, role: viewer.role };
  const initiatorLeftOut = (graph: Awaited<ReturnType<typeof requisitionWorkflowGraph>>, fromStateId: number, startedBy: number | null) => {
    let currentStateId = fromStateId;
    for (let round = 0; round <= graph.states.length; round += 1) {
      const step = graph.states.find(s => s.id === currentStateId);
      const approve = step?.stateKey === APPROVED_STEP_KEY ? undefined : transitionFromStep({ ...graph, instance: { currentStateId } }, APPROVE_ACTION_KEYS);
      if (!approve) return false;
      if (WorkflowTransitionExecutor.initiatorExcluded(approve, startedBy, signer)) return true;
      currentStateId = approve.toStateId;
    }
    return false;
  };

  // review of #406: only the viewer's own running instances, with the columns the walk reads; a live graph is read once
  // per workflow definition
  const withInstance = open.filter(r => r.workflowInstanceId);
  const instances = withInstance.length === 0 ? [] : await db.select({
    id: workflowInstances.id,
    startedBy: workflowInstances.startedBy,
    currentStateId: workflowInstances.currentStateId,
    snapshotDsl: workflowInstances.snapshotDsl,
    workflowDefinitionId: workflowInstances.workflowDefinitionId,
  }).from(workflowInstances).where(and(
    inArray(workflowInstances.id, withInstance.map(r => Number(r.workflowInstanceId))),
    eq(workflowInstances.startedBy, viewer.id),
    eq(workflowInstances.status, 'IN_PROGRESS'),
  ));
  const liveGraphs = new Map<number, ReturnType<typeof requisitionWorkflowGraph>>();
  const liveGraphOf = (workflowDefinitionId: number) => {
    const known = liveGraphs.get(workflowDefinitionId);
    if (known) return known;
    const graph = requisitionWorkflowGraph({ snapshotDsl: null, workflowDefinitionId }, db);
    liveGraphs.set(workflowDefinitionId, graph);
    return graph;
  };
  for (const instance of instances) {
    const graph = isUsableSnapshot(instance.snapshotDsl as WorkflowSnapshotDsl | null)
      ? await requisitionWorkflowGraph(instance, db)
      : await liveGraphOf(instance.workflowDefinitionId);
    if (initiatorLeftOut(graph, instance.currentStateId, instance.startedBy)) {
      const req = withInstance.find(r => Number(r.workflowInstanceId) === instance.id);
      if (req) blocked.add(req.id);
    }
  }

  // review 2 of #406: a requisition with no instance gets one in its requester's name on its first action
  // (`ensureRequisitionInstance`), so for its requester the walk starts at the first step of the active definition's
  // published design, as `startInstance` does (review 3: never the step tables, which may hold an unpublished draft)
  const ownWithout = open.filter(r => !r.workflowInstanceId && r.requestedById === viewer.id);
  if (ownWithout.length > 0) {
    const [definition] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.entityType, 'purchase_requisition'), eq(workflowDefinitions.isActive, 1)))
      .orderBy(asc(workflowDefinitions.id)).limit(1);
    const design = definition ? await publishedDesignOf(db, definition.id) : null;
    const graph = isUsableSnapshot(design) ? { states: design.states ?? [], transitions: design.transitions ?? [] } : null;
    const initial = graph?.states.find(state => state.stateType === 'initial');
    if (graph && initial && initiatorLeftOut(graph, initial.id, viewer.id)) {
      for (const r of ownWithout) blocked.add(r.id);
    }
  }
  return blocked;
}
