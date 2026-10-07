import { orm, type DbExecutor } from '../../db/drizzle.js';
import { 
  workflowInstances, 
  workflowTasks, 
  workflowDefinitions,
  workflowHistoryLogs
} from '../../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { logActivity } from '../../lib/auditLogger.js';
import { WorkflowTransitionExecutor } from './workflowTransitionExecutor.js';
import { lockWorkflowEntity } from './workflowTransitionActions.js';
import { WorkflowDelegationService, type ActingDelegation } from './workflowDelegationService.js';
import { snapshotTransitionsOf } from './workflowSnapshot.js';
import { completedByUserCondition, completedTasksOf, inboxEntityFields } from './workflowInboxRows.js';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../../errors/customErrors.js';

/** v9.0.34 (TD-444): کاربر کارتابل و مجوزهایی که موتور برای او و تفویض‌کنندگانش می‌خواند */
interface TaskSigner {
  userId: number;
  role: string;
  permissions: string[];
  delegations: ActingDelegation[];
  delegatorPermissions: Map<number, string[]>;
}

/** v9.0.41 (TD-448، ت۶ الف): زبانه‌های کارتابل */
export const MY_TASK_FILTERS = ['pending', 'overdue', 'delegated', 'completed'] as const;
export type MyTaskFilter = typeof MY_TASK_FILTERS[number];

interface PendingTaskMatch {
  task: typeof workflowTasks.$inferSelect;
  instance: typeof workflowInstances.$inferSelect;
  delegationInfo: { delegatedFromUserId?: number; delegationScope?: string | null } | null;
  isOverdue: boolean;
}

export class WorkflowTaskService {
  // v7.0.101 (TD-085، تصمیم مالک محصول «بازگشایی با گزارش»): markExpiredTasks حذف شد؛ کار تاییدی با گذشتن مهلت
  // منقضی نمی‌شود و در کارتابل می‌ماند، و مسئولش یک بار یادآوری می‌گیرد (WorkflowSlaReminderService).

  /**
   * Get User's Active Tasks Inbox with Delegation Evaluation
   *
   * v9.0.41 (TD-448، یافته B14-06، تصمیم مالک محصول ت۶ الف): زبانه‌ها معنای خود را دارند: «در انتظار» کارهای در انتظار
   * کاربر (خود او یا از راه تفویض)، «دارای تأخیر» همان‌ها با موعد گذشته (`due_at < now()` در پایگاه‌داده)، «دریافتی از
   * تفویض» کارهای در انتظاری که فقط از راه تفویض به او رسیده و «تکمیل‌شده» اقدام‌هایی که خود کاربر انجام داده (از تاریخچه،
   * صفحه‌بندی در پایگاه‌داده). پیش‌تر فیلتر برابری `status` کار بود و سه زبانه همیشه خالی می‌ماندند.
   */
  static async getMyTasks(params: {
    userId: number;
    userRole?: string;
    userPermissions?: string[];
    status?: MyTaskFilter;
    page?: number;
    limit?: number;
  }) {
    const userId = params.userId;
    const userRole = (params.userRole || '').trim().toLowerCase();
    const filter = params.status || 'pending';
    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;
    if (filter === 'completed') return completedTasksOf(userId, page, limit);

    const matched = (await WorkflowTaskService.pendingTasksOf(userId, userRole, params.userPermissions))
      .filter(m => filter === 'overdue' ? m.isOverdue : filter === 'delegated' ? !!m.delegationInfo : true);
    const total = matched.length;
    const pagedSlice = matched.slice(offset, offset + limit);

    // V4 Phase 5.3 (A-2): بارگذاری موازی کانتکست موجودیت فقط برای ردیف‌های صفحه فعلی
    const filteredTasks = await Promise.all(
      pagedSlice.map(async ({ task, instance, delegationInfo, isOverdue }) => {
        return {
          ...task,
          isOverdue,
          ...(await inboxEntityFields(instance)),
          delegationInfo,
          rejectTransitions: await WorkflowTaskService.rejectTransitionsOf(instance),
        };
      })
    );

    return {
      data: filteredTasks,
      total,
      page,
      limit
    };
  }

  /**
   * TD-463 (یافته B14-21): اقدام‌های «رد» گام جاری از تصویر فرایند، تا کارتابل وقتی گام بیش از یکی دارد انتخاب را بخواهد و
   * `transitionId` بفرستد؛ پیش‌تر کارتابل هرگز انتخاب نمی‌کرد و رد چنین گامی همیشه با WF_TASK_REJECT_AMBIGUOUS رد می‌شد.
   */
  private static async rejectTransitionsOf(instance: typeof workflowInstances.$inferSelect): Promise<Array<{ id: number; title: string }>> {
    const transitions = await WorkflowTransitionExecutor.transitionsFromState(instance, instance.currentStateId);
    return transitions
      .filter(t => WorkflowTransitionExecutor.isNegativeTransition(t.actionKey, t.title))
      .map(t => ({ id: t.id, title: t.title }));
  }

  /**
   * Get Task Stats
   * v9.0.41 (TD-448): شمار هر زبانه با همان قاعده خود زبانه؛ تأخیر با زمان پایگاه‌داده. پیش‌تر رشته موعد پایگاه‌داده
   * («YYYY-MM-DD HH:MM:SS») با ISO مقایسه می‌شد و هر کاری که موعدش امروز بود از همان لحظه «دارای تأخیر» بود، و شمار
   * تکمیل و تفویض اصلاً برنمی‌گشت.
   */
  static async getTaskStats(params: { userId: number; userRole?: string; userPermissions?: string[] }) {
    const userId = Number(params.userId);
    const userRole = (params.userRole || '').trim().toLowerCase();
    const pending = await WorkflowTaskService.pendingTasksOf(userId, userRole, params.userPermissions);
    const [done] = await orm.select({ n: sql<number>`count(*)::int` }).from(workflowHistoryLogs)
      .where(completedByUserCondition(userId));
    return {
      pendingCount: pending.length,
      overdueCount: pending.filter(m => m.isOverdue).length,
      delegatedCount: pending.filter(m => !!m.delegationInfo).length,
      completedCount: Number(done?.n ?? 0),
    };
  }

  /**
   * v9.0.41 (TD-448): کارهای در انتظاری که کاربر می‌تواند اجرا کند، یک کارت برای هر فرایند (کار پیش‌رو پیش از کار رد)،
   * با تفویضی که کار را به او رسانده (اگر خودش مسئول نیست) و تأخیر از پایگاه‌داده
   */
  private static async pendingTasksOf(userId: number, userRole: string, userPermissions?: string[]): Promise<PendingTaskMatch[]> {
    const isAdmin = userRole === 'admin';
    const signer = await WorkflowTaskService.signerContext(orm, userId, userRole, userPermissions);
    const allTasks = await orm.select({
      task: workflowTasks,
      instance: workflowInstances,
      definitionCode: workflowDefinitions.code,
      isOverdue: sql<boolean>`(${workflowTasks.dueAt} IS NOT NULL AND ${workflowTasks.dueAt} < now())`,
    })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.workflowDefinitionId, workflowDefinitions.id))
    .where(eq(workflowTasks.status, 'pending'))
    .orderBy(desc(workflowTasks.createdAt));

    // Consolidate per instance: Ensure at most ONE task card is returned per workflow instance.
    // If an instance has multiple tasks (e.g. positive approval and rejection), keep only the positive review task.
    const sortedTasks = [...allTasks].sort((a, b) => {
      const aNeg = WorkflowTransitionExecutor.isNegativeTransition(undefined, a.task.title);
      const bNeg = WorkflowTransitionExecutor.isNegativeTransition(undefined, b.task.title);
      if (aNeg && !bNeg) return 1;
      if (!aNeg && bNeg) return -1;
      return 0;
    });

    const seenInstances = new Set<number>();
    const matched: PendingTaskMatch[] = [];
    for (const { task, instance, definitionCode, isOverdue } of sortedTasks) {
      if (seenInstances.has(task.instanceId)) continue;

      let isAssigned = false;
      let delegationInfo: PendingTaskMatch['delegationInfo'] = null;
      if (isAdmin || WorkflowTaskService.assignedDirectly(task, instance, signer)) {
        isAssigned = true;
      } else {
        const del = WorkflowTaskService.delegationForTask(task, instance, WorkflowTaskService.workflowCodeOf(instance, definitionCode), signer);
        if (del) {
          isAssigned = true;
          delegationInfo = { delegatedFromUserId: del.fromUserId, delegationScope: del.scope };
        }
      }
      if (isAssigned && !isAdmin && WorkflowTaskService.excludedAsInitiator(task, instance, { userId: delegationInfo?.delegatedFromUserId ?? userId, actorId: userId, role: userRole })) {
        isAssigned = false;
      }
      if (isAssigned) {
        seenInstances.add(task.instanceId);
        matched.push({ task, instance, delegationInfo, isOverdue: isOverdue === true });
      }
    }
    return matched;
  }

  /**
   * Get Tasks for a specific Workflow Instance
   */
  static async getTasksForInstance(instanceId: number) {
    return await orm.select().from(workflowTasks).where(eq(workflowTasks.instanceId, instanceId)).orderBy(desc(workflowTasks.createdAt));
  }

  /**
   * Execute task directly by ID with strict ownership & delegation authorization
   */
  static async executeTaskById(params: {
    taskId: number;
    userId: number;
    userName: string;
    userRole: string;
    userPermissions?: string[];
    action: 'approve' | 'reject';
    /** v8.0.90 (TD-370): انتقال «رد» انتخابی وقتی گام چند انتقال رد دارد */
    transitionId?: number;
    comment?: string;
    snapshotData?: Record<string, unknown>;
  }) {
    return await orm.transaction(async (tx) => {
      // v8.0.95 (TD-375): ترتیب قفل همان مسیر انتقال مستقیم است: نخست ردیف فرایند، سپس ردیف کار. پیش‌تر کار پیش از
      // فرایند قفل می‌شد و اجرای هم‌زمان همان گام از ویجت سند (فرایند، سپس لغو کارهای گام) به بن‌بست می‌رسید.
      const [taskRef] = await tx.select({ instanceId: workflowTasks.instanceId }).from(workflowTasks).where(eq(workflowTasks.id, params.taskId));
      if (!taskRef) {
        throw new NotFoundError('وظیفه مورد نظر یافت نشد');
      }
      // v9.0.2 (TD-415): ردیف موجودیتی که اقدام پس از انتقال می‌نویسد پیش از ردیف فرایند، همان ترتیب انتقال مستقیم
      await lockWorkflowEntity(tx, taskRef.instanceId);
      await tx.select({ id: workflowInstances.id }).from(workflowInstances).where(eq(workflowInstances.id, taskRef.instanceId)).for('update');
      const [task] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, params.taskId)).for('update');
      if (!task) {
        throw new NotFoundError('وظیفه مورد نظر یافت نشد');
      }

      if (task.status !== 'pending') {
        return {
          idempotent: true,
          code: 'WF_TASK_ALREADY_COMPLETED',
          message: 'این کار پیش‌تر انجام شده است؛ کارتابل را تازه کنید.',
          task: {
            id: task.id,
            status: task.status,
            completedAt: task.completedAt
          }
        };
      }

      if (!task.transitionId) {
        throw new ValidationError('این کار اقدام معتبری ندارد؛ کارتابل را تازه کنید.');
      }

      const [instance] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId));
      if (!instance) {
        throw new NotFoundError('نمونه فرآیند کاری متناظر با این وظیفه یافت نشد');
      }

      const userRole = (params.userRole || '').trim().toLowerCase();
      // v9.0.34 (TD-444، ت۱ الف): فقط مدیر سیستم هر کاری را اجرا می‌کند؛ مجوزهای نقش از پایگاه‌داده، همان قاعده موتور
      const isAdmin = userRole === 'admin';
      const signer = await WorkflowTaskService.signerContext(tx, params.userId, userRole, params.userPermissions);

      // v8.0.97 (TD-377، تصمیم مالک محصول «کارهای نقش او»): جانشین در بازه و حوزه تفویض کار کاربر تعیین‌شده یا نامزد
      // و کار نقش تفویض‌کننده را انجام می‌دهد؛ پیش‌تر فقط کار کاربر تعیین‌شده یا نامزد را، و کار نقشی هرگز
      let delegationLogDetails: Record<string, unknown> | null = null;
      let isAuthorized = isAdmin || WorkflowTaskService.assignedDirectly(task, instance, signer);
      if (!isAuthorized) {
        const [definition] = await tx.select({ code: workflowDefinitions.code }).from(workflowDefinitions)
          .where(eq(workflowDefinitions.id, instance.workflowDefinitionId));
        const validDelegation = WorkflowTaskService.delegationForTask(task, instance, WorkflowTaskService.workflowCodeOf(instance, definition?.code), signer);
        if (validDelegation) {
          isAuthorized = true;
          delegationLogDetails = {
            delegationId: validDelegation.id,
            delegatedFromUserId: validDelegation.fromUserId,
            delegationScope: validDelegation.scope
          };
        }
      }

      if (!isAuthorized) {
        throw new ForbiddenError('شما مجاز به اجرای این وظیفه نیستید (فاقد تخصیص مستقیم، نقش متناظر یا تفویض اختیار معتبر).', undefined, 'WF_TASK_UNAUTHORIZED');
      }

      // v8.0.90 (TD-370): تأیید همان انتقال خود کار را اجرا می‌کند و «رد» فقط انتقال رد گام جاری را (از تصویر نسخه
      // فرایند). پیش‌تر اولین انتقال مثبت یا منفی جدول برداشته می‌شد و «رد» در گام بی‌انتقال رد همان تأیید را اجرا می‌کرد.
      const effectiveTransitionId = await WorkflowTaskService.resolveTaskTransition(tx, task, instance, { ...params, userPermissions: signer.permissions });
      const transitionResult = await WorkflowTransitionExecutor.executeTransition({
        instanceId: task.instanceId,
        transitionId: effectiveTransitionId,
        userId: params.userId,
        userName: params.userName,
        userRole: params.userRole,
        userPermissions: params.userPermissions,
        comment: params.comment,
        snapshotData: params.snapshotData,
        tx
      });

      // v8.0.91 (TD-371): کار فقط وقتی انتقال واقعاً انجام شد بسته می‌شود؛ امضایی که حدنصاب را کامل نکرده (یا تکراری
      // است) کار را برای امضاکنندگان دیگر در کارتابل باز می‌گذارد. پیش‌تر امضای اول K_OF_N کار را «تأییدشده» می‌بست.
      const advanced = 'toState' in transitionResult;
      const taskNewStatus = advanced ? (params.action === 'reject' ? 'rejected' : 'approved') : 'pending';
      if (advanced) {
        await tx.update(workflowTasks)
          .set({
            status: taskNewStatus,
            completedAt: new Date().toISOString(),
            delegatedToUserId: delegationLogDetails ? params.userId : null
          })
          .where(eq(workflowTasks.id, task.id));
      }

      const outcomeText = advanced
        ? `با اقدام «${params.action === 'reject' ? 'رد' : 'تأیید'}» انجام شد`
        : `امضای ${params.action === 'reject' ? 'رد' : 'تأیید'} ثبت شد و تا تکمیل حدنصاب باز است`;
      await logActivity({
        userId: params.userId,
        username: params.userName,
        action: 'UPDATE',
        entity: 'وظیفه فرآیند کاری',
        entityId: task.id,
        description: `وظیفه شماره #${task.id} («${task.title}») ${outcomeText}.${delegationLogDetails ? ` (به‌واسطه تفویض اختیار از کاربر #${delegationLogDetails.delegatedFromUserId})` : ''}`,
        details: {
          taskId: task.id,
          instanceId: task.instanceId,
          action: params.action,
          advanced,
          delegation: delegationLogDetails
        },
        tx
      });

      return {
        ...transitionResult,
        task: {
          id: task.id,
          status: taskNewStatus,
          delegation: delegationLogDetails
        }
      };
    });
  }

  private static taskRolesOf(task: Pick<typeof workflowTasks.$inferSelect, 'candidateRoles' | 'assignedRole'>): string[] {
    const candidateRoles = Array.isArray(task.candidateRoles) ? task.candidateRoles.map(r => String(r).trim().toLowerCase()) : [];
    return (candidateRoles.length > 0 ? candidateRoles : [(task.assignedRole || '').trim().toLowerCase()]).filter(Boolean);
  }

  /**
   * v9.0.34 (TD-444): کاربر کارتابل با مجوزهای نقشش (از پایگاه‌داده، همان signerPermissions موتور) و تفویض‌های فعالی که
   * به او رسیده، هر کدام با مجوزهای نقش تفویض‌کننده.
   */
  private static async signerContext(
    tx: DbExecutor,
    userId: number,
    userRole: string,
    given?: string[]
  ): Promise<TaskSigner> {
    const permissions = await WorkflowTransitionExecutor.signerPermissions(userRole, given, tx);
    const delegations = await WorkflowDelegationService.activeDelegations(tx, { toUserId: userId });
    const delegatorPermissions = new Map<number, string[]>();
    for (const d of delegations) {
      delegatorPermissions.set(d.id, await WorkflowTransitionExecutor.signerPermissions(d.fromRole, [], tx));
    }
    return { userId, role: userRole, permissions, delegations, delegatorPermissions };
  }

  /**
   * v9.0.34 (TD-444): همان قاعده موتور برای یک امضاکننده: نقش کار با checkUserRoleMatch (نقش، نقش هم‌ارز همان بخش، یا
   * مجوز ثبت همان بخش) و مجوز لازم انتقال (TD-391) از تصویر نسخه فرایند. پیش‌تر کارتابل فقط کد نقش برابر را می‌شناخت.
   */
  private static roleAllows(
    task: Pick<typeof workflowTasks.$inferSelect, 'candidateRoles' | 'assignedRole' | 'transitionId'>,
    instance: { snapshotDsl: unknown },
    role: string | undefined,
    permissions: string[]
  ): boolean {
    const transition = snapshotTransitionsOf(instance.snapshotDsl)?.find(t => t.id === task.transitionId);
    const required = (transition?.requiredPermission || '').trim();
    if (required && (role || '').trim().toLowerCase() !== 'admin' && !permissions.includes(required) && !permissions.includes('*')) return false;
    const roles = WorkflowTaskService.taskRolesOf(task);
    return roles.length === 0 || roles.some(r => WorkflowTransitionExecutor.checkUserRoleMatch(role, r === 'all' ? 'ALL' : r, permissions));
  }

  /** کار به خود کاربر داده شده: کاربر تعیین‌شده یا نامزد، یا نقش کار (یا «همه») با قاعده موتور */
  private static assignedDirectly(
    task: Pick<typeof workflowTasks.$inferSelect, 'assignedUserId' | 'candidateUsers' | 'candidateRoles' | 'assignedRole' | 'transitionId'>,
    instance: { snapshotDsl: unknown },
    signer: TaskSigner
  ): boolean {
    const candidateUserIds = Array.isArray(task.candidateUsers) ? task.candidateUsers.map(Number) : [];
    if (task.assignedUserId === signer.userId || candidateUserIds.includes(signer.userId)) return true;
    return WorkflowTaskService.roleAllows(task, instance, signer.role, signer.permissions);
  }

  /**
   * v8.0.102 (TD-392): کار گامی که آغازکننده را کنار می‌گذارد در کارتابل آغازکننده (و جانشینش) نمی‌آید؛ تیک انتقال از
   * تصویر نسخه فرایند خوانده می‌شود.
   */
  private static excludedAsInitiator(
    task: { transitionId: number | null },
    instance: { snapshotDsl: unknown; startedBy: number | null },
    signer: { userId?: number; actorId?: number; role?: string }
  ): boolean {
    const transition = snapshotTransitionsOf(instance.snapshotDsl)?.find(t => t.id === task.transitionId);
    return !!transition && WorkflowTransitionExecutor.initiatorExcluded(transition, instance.startedBy, signer);
  }

  /** کد گردش‌کار فرایند برای حوزه تفویض: از تصویر نسخه، وگرنه از تعریف */
  private static workflowCodeOf(instance: { snapshotDsl: unknown }, definitionCode?: string | null): string {
    const snapshot = instance.snapshotDsl as { code?: string } | null;
    return snapshot?.code || definitionCode || '';
  }

  /**
   * v8.0.97 (TD-377، تصمیم مالک محصول «کارهای نقش او»): تفویض فعالی که کار را به جانشین می‌دهد: حوزه‌اش گردش‌کار را
   * می‌پوشاند و تفویض‌کننده کاربر تعیین‌شده یا نامزد کار است یا نقش کار را دارد (همان قاعده نقش اجرای انتقال).
   */
  private static delegationForTask(
    task: Pick<typeof workflowTasks.$inferSelect, 'assignedUserId' | 'candidateUsers' | 'candidateRoles' | 'assignedRole' | 'transitionId'>,
    instance: { snapshotDsl: unknown },
    workflowCode: string,
    signer: TaskSigner
  ): ActingDelegation | undefined {
    const candidateUserIds = Array.isArray(task.candidateUsers) ? task.candidateUsers.map(Number) : [];
    return signer.delegations.find(d => WorkflowDelegationService.delegationCovers(d.scope, workflowCode) && (
      d.fromUserId === task.assignedUserId
      || candidateUserIds.includes(d.fromUserId)
      || WorkflowTaskService.roleAllows(task, instance, d.fromRole, signer.delegatorPermissions.get(d.id) ?? [])
    ));
  }

  /**
   * v8.0.90 (TD-370): انتقالی که اجرای کار انجام می‌دهد. تأیید: انتقال خود کار، اگر از گام جاری باشد. رد: انتقال رد
   * انتخاب‌شده (transitionId)، یا انتقال خود کار اگر رد است، یا تنها انتقال رد گامی که کاربر اجازه‌اش را دارد.
   */
  private static async resolveTaskTransition(
    tx: Parameters<Parameters<typeof orm.transaction>[0]>[0],
    task: typeof workflowTasks.$inferSelect,
    instance: typeof workflowInstances.$inferSelect,
    params: { action: 'approve' | 'reject'; transitionId?: number; userRole: string; userPermissions?: string[] }
  ): Promise<number> {
    const stateTransitions = await WorkflowTransitionExecutor.transitionsFromState(instance, instance.currentStateId, tx);
    const own = stateTransitions.find(t => t.id === task.transitionId);
    if (!own) {
      throw new ConflictError('این وظیفه به گام جاری فرآیند تعلق ندارد؛ کارتابل را تازه کنید', undefined, 'WF_TASK_STALE');
    }
    if (params.action === 'approve') return own.id;

    const rejects = stateTransitions.filter(t => WorkflowTransitionExecutor.isNegativeTransition(t.actionKey, t.title));
    if (params.transitionId) {
      const chosen = rejects.find(t => t.id === params.transitionId);
      if (!chosen) throw new ValidationError('اقدام «رد» انتخاب‌شده از گام جاری این کار نیست؛ کارتابل را تازه کنید.', undefined, 'WF_TASK_INVALID_REJECT');
      return chosen.id;
    }
    if (rejects.some(t => t.id === own.id)) return own.id;
    if (rejects.length === 0) {
      throw new ValidationError('این گام اقدام «رد» ندارد؛ فقط تأیید ممکن است.', undefined, 'WF_TASK_NO_REJECT_TRANSITION');
    }
    const allowed = rejects.filter(t => WorkflowTransitionExecutor.checkUserRoleMatch(params.userRole, t.requiredRole || undefined, params.userPermissions || []));
    if (allowed.length === 1) return allowed[0].id;
    if (rejects.length === 1) return rejects[0].id;
    throw new ValidationError(`این گام چند اقدام «رد» دارد (${rejects.map(t => t.title).join('، ')})؛ یکی را انتخاب کنید.`, undefined, 'WF_TASK_REJECT_AMBIGUOUS');
  }

  /**
   * Delegate a task explicitly to a target user
   */
  static async delegateTask(params: {
    taskId: number;
    fromUserId: number;
    toUserId: number;
    reason?: string;
  }) {
    return await orm.transaction(async (tx) => {
      const [task] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, params.taskId)).for('update');
      if (!task) {
        throw new NotFoundError('وظیفه مورد نظر یافت نشد');
      }
      if (task.status !== 'pending') {
        throw new ConflictError('فقط وظایف در انتظار امکان تفویض دارند');
      }

      await tx.update(workflowTasks)
        .set({
          status: 'delegated',
          delegatedToUserId: params.toUserId
        })
        .where(eq(workflowTasks.id, task.id));

      await logActivity({
        userId: params.fromUserId,
        action: 'UPDATE',
        entity: 'وظیفه فرآیند کاری',
        entityId: task.id,
        description: `وظیفه شماره #${task.id} به کاربر #${params.toUserId} تفویض شد. دلیل: ${params.reason || 'نامشخص'}`,
        details: { taskId: task.id, fromUserId: params.fromUserId, toUserId: params.toUserId, reason: params.reason }
      });

      return {
        success: true,
        taskId: task.id,
        delegatedToUserId: params.toUserId,
        status: 'delegated'
      };
    });
  }
}
