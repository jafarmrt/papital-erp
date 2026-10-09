import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/drizzle.js';
import { purchaseRequisitions, workflowInstances, workflowStates, workflowTransitions } from '../../db/schema.js';
import { ConflictError, ValidationError } from '../../errors/customErrors.js';
import { WorkflowTransitionExecutor, type WorkflowSnapshotDsl, type WorkflowStateSnapshot, type WorkflowTransitionSnapshot } from '../workflow/workflowTransitionExecutor.js';
import { isUsableSnapshot } from '../workflow/workflowSnapshot.js';

/** فیلدهای گام گردش‌کار که تدارکات می‌خواند (از تصویر فرایند یا جدول workflow_states) */
export type WorkflowStateRef = Pick<WorkflowStateSnapshot, 'id' | 'stateKey' | 'title'>;
/** فیلدهای انتقال گردش‌کار که تدارکات می‌خواند (از تصویر فرایند یا جدول workflow_transitions) */
export type WorkflowTransitionRef = Pick<WorkflowTransitionSnapshot, 'id' | 'fromStateId' | 'toStateId' | 'actionKey' | 'title'>;

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
  /** v10.0.39 (TD-1132): shown on the orders a conversion writes */
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

/**
 * نمونه گردش‌کار درخواست (زیر قفل ردیف درخواست که فراخواننده گرفته است) و گام جاری‌اش؛ درخواستی که نمونه ندارد (شروع
 * گردش‌کار هنگام ثبت شکست خورده یا درخواست قدیمی است) در همین تراکنش نمونه می‌گیرد.
 */
export async function requisitionFlow(
  tx: DbExecutor,
  req: { id: number; workflowInstanceId?: number | null },
  user: RequisitionActor,
): Promise<RequisitionFlow> {
  let instanceId = req.workflowInstanceId;
  if (!instanceId) {
    const started = await WorkflowTransitionExecutor.startInstance({
      workflowCode: 'PURCHASE_REQUISITION_WORKFLOW',
      entityType: 'purchase_requisition',
      entityId: String(req.id),
      userId: user.id,
      userName: user.username,
      tx,
    });
    instanceId = started.id;
    req.workflowInstanceId = instanceId;
    await tx.update(purchaseRequisitions).set({ workflowInstanceId: instanceId }).where(eq(purchaseRequisitions.id, req.id));
  }
  const [instance] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, instanceId));
  if (!instance) throw new ValidationError('نمونه فرایند گردش کار درخواست خرید یافت نشد.');
  const { states, transitions } = await requisitionWorkflowGraph(instance, tx);
  const step = states.find(s => s.id === instance.currentStateId);
  return { instance, states, transitions, stepKey: step?.stateKey ?? '', stepTitle: step?.title ?? '' };
}

/** انتقال گام جاری با یکی از اقدام‌ها، به ترتیب همان فهرست */
export function transitionFromStep(flow: RequisitionFlow, actionKeys: string[], toStepKey?: string): WorkflowTransitionRef | undefined {
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
  req: { id: number; code: string; workflowInstanceId?: number | null },
  user: RequisitionActor,
  opts: ApprovalOptions,
): Promise<RequisitionFlow> {
  let flow = await requisitionFlow(tx, req, user);
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
    flow = await requisitionFlow(tx, req, user);
  }
  if (flow.stepKey !== APPROVED_STEP_KEY) {
    throw new ConflictError(`درخواست خرید ${req.code} به گام تأییدشده نرسید.`, { step: flow.stepKey }, 'REQUISITION_NOT_APPROVED');
  }
  return flow;
}
