import { orm } from '../../db/drizzle.js';
import { 
  workflowInstances, 
  workflowPendingApprovals, 
  workflowTasks, 
  workflowDefinitions,
  workflowTransitions
} from '../../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { logActivity } from '../../lib/auditLogger.js';
import { getEntityContext } from './workflowDslParser.js';
import { WorkflowTransitionExecutor } from './workflowTransitionExecutor.js';
import { WorkflowDelegationService, type ActingDelegation } from './workflowDelegationService.js';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../../errors/customErrors.js';

export class WorkflowTaskService {
  // v7.0.101 (TD-085، تصمیم مالک محصول «بازگشایی با گزارش»): markExpiredTasks حذف شد؛ کار تاییدی با گذشتن مهلت
  // منقضی نمی‌شود و در کارتابل می‌ماند، و مسئولش یک بار یادآوری می‌گیرد (WorkflowSlaReminderService).

  /**
   * Get User's Active Tasks Inbox with Delegation Evaluation
   */
  static async getMyTasks(params: {
    userId: number;
    userRole?: string;
    userPermissions?: string[];
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const userId = params.userId;
    const userRole = (params.userRole || '').trim().toLowerCase();
    const isAdmin = userRole === 'admin';

    const activeDelegations = await WorkflowDelegationService.activeDelegations(orm, { toUserId: userId });

    const targetStatus = params.status || 'pending';
    const allTasks = await orm.select({
      task: workflowTasks,
      instance: workflowInstances,
      definitionCode: workflowDefinitions.code
    })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.workflowDefinitionId, workflowDefinitions.id))
    .where(eq(workflowTasks.status, targetStatus))
    .orderBy(desc(workflowTasks.createdAt));

    // Consolidate per instance: Ensure at most ONE task card is returned per workflow instance.
    // If an instance has multiple tasks (e.g. positive approval and rejection), keep only the positive review task.
    const seenInstances = new Set<number>();
    const matchedItems: Array<{
      task: typeof workflowTasks.$inferSelect;
      instance: typeof workflowInstances.$inferSelect;
      delegationInfo: { delegatedFromUserId?: number; delegationScope?: string | null } | null;
    }> = [];
    
    // Sort so forward tasks are processed before negative tasks
    const sortedTasks = [...allTasks].sort((a, b) => {
      const aNeg = WorkflowTransitionExecutor.isNegativeTransition(undefined, a.task.title);
      const bNeg = WorkflowTransitionExecutor.isNegativeTransition(undefined, b.task.title);
      if (aNeg && !bNeg) return 1;
      if (!aNeg && bNeg) return -1;
      return 0;
    });

    for (const item of sortedTasks) {
      const task = item.task;
      const instance = item.instance;

      if (seenInstances.has(task.instanceId)) {
        // Skip duplicate card for the same workflow instance
        continue;
      }

      let isAssigned = false;
      let delegationInfo: { delegatedFromUserId?: number; delegationScope?: string | null } | null = null;

      if (isAdmin || this.assignedDirectly(task, userId, userRole)) {
        isAssigned = true;
      } else {
        const del = this.delegationForTask(task, this.workflowCodeOf(instance, item.definitionCode), activeDelegations);
        if (del) {
          isAssigned = true;
          delegationInfo = { delegatedFromUserId: del.fromUserId, delegationScope: del.scope };
        }
      }

      if (isAssigned) {
        seenInstances.add(task.instanceId);
        matchedItems.push({ task, instance, delegationInfo });
      }
    }

    const page = params.page || 1;
    const limit = params.limit || 50;
    const offset = (page - 1) * limit;
    const total = matchedItems.length;
    const pagedSlice = matchedItems.slice(offset, offset + limit);

    // V4 Phase 5.3 (A-2): بارگذاری موازی کانتکست موجودیت فقط برای ردیف‌های صفحه فعلی
    const filteredTasks = await Promise.all(
      pagedSlice.map(async ({ task, instance, delegationInfo }) => {
        const context = await getEntityContext(instance.entityType, instance.entityId);
        return {
          ...task,
          entityType: instance.entityType,
          entityId: instance.entityId,
          instance: {
            id: instance.id,
            workflowDefinitionId: instance.workflowDefinitionId,
            entityType: instance.entityType,
            entityId: instance.entityId,
            currentStateId: instance.currentStateId,
            status: instance.status,
            createdAt: instance.createdAt,
            updatedAt: instance.updatedAt
          },
          refNumber: context.refNumber || context.code || instance.entityId,
          buyerName: context.buyerName || '',
          amount: context.amount || context.totalAmount || 0,
          delegationInfo
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
   * Get Task Stats
   * V4 Phase 5.3 (A-2): کوئری مستقیم سبک شمارش تسک‌های منتظر و منقضی بدون فراخوانی getMyTasks و بارگذاری N+1 کانتکست موجودیت‌ها
   */
  static async getTaskStats(params: { userId: number; userRole?: string }) {
    const userId = Number(params.userId);
    const userRole = (params.userRole || '').trim().toLowerCase();
    const isAdmin = userRole === 'admin';
    const nowIso = new Date().toISOString();
    const activeDelegations = await WorkflowDelegationService.activeDelegations(orm, { toUserId: userId });

    const pendingTasks = await orm.select({
      id: workflowTasks.id,
      instanceId: workflowTasks.instanceId,
      assignedUserId: workflowTasks.assignedUserId,
      assignedRole: workflowTasks.assignedRole,
      candidateUsers: workflowTasks.candidateUsers,
      candidateRoles: workflowTasks.candidateRoles,
      dueAt: workflowTasks.dueAt,
      title: workflowTasks.title,
      snapshotDsl: workflowInstances.snapshotDsl,
      definitionCode: workflowDefinitions.code,
    })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .leftJoin(workflowDefinitions, eq(workflowInstances.workflowDefinitionId, workflowDefinitions.id))
    .where(eq(workflowTasks.status, 'pending'))
    .orderBy(desc(workflowTasks.createdAt));

    const seenInstances = new Set<number>();
    let pendingCount = 0;
    let overdueCount = 0;

    for (const task of pendingTasks) {
      if (seenInstances.has(task.instanceId)) {
        continue;
      }

      const isAssigned = isAdmin || this.assignedDirectly(task, userId, userRole)
        || !!this.delegationForTask(task, this.workflowCodeOf(task, task.definitionCode), activeDelegations);

      if (isAssigned) {
        seenInstances.add(task.instanceId);
        pendingCount++;
        if (task.dueAt && task.dueAt < nowIso) {
          overdueCount++;
        }
      }
    }

    return {
      pendingCount,
      overdueCount,
      completedTodayCount: 0
    };
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
    /** v8.0.81 (TD-370): انتقال «رد» انتخابی وقتی گام چند انتقال رد دارد */
    transitionId?: number;
    comment?: string;
    snapshotData?: Record<string, unknown>;
  }) {
    return await orm.transaction(async (tx) => {
      // v8.0.86 (TD-375): ترتیب قفل همان مسیر انتقال مستقیم است: نخست ردیف فرایند، سپس ردیف کار. پیش‌تر کار پیش از
      // فرایند قفل می‌شد و اجرای هم‌زمان همان گام از ویجت سند (فرایند، سپس لغو کارهای گام) به بن‌بست می‌رسید.
      const [taskRef] = await tx.select({ instanceId: workflowTasks.instanceId }).from(workflowTasks).where(eq(workflowTasks.id, params.taskId));
      if (!taskRef) {
        throw new NotFoundError('وظیفه مورد نظر یافت نشد');
      }
      await tx.select({ id: workflowInstances.id }).from(workflowInstances).where(eq(workflowInstances.id, taskRef.instanceId)).for('update');
      const [task] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, params.taskId)).for('update');
      if (!task) {
        throw new NotFoundError('وظیفه مورد نظر یافت نشد');
      }

      if (task.status !== 'pending') {
        return {
          idempotent: true,
          message: 'این وظیفه قبلاً تعیین تکلیف شده است (WF_TASK_ALREADY_COMPLETED)',
          task: {
            id: task.id,
            status: task.status,
            completedAt: task.completedAt
          }
        };
      }

      if (!task.transitionId) {
        throw new ValidationError('انتقال معتبری به این وظیفه متصل نیست');
      }

      const [instance] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId));
      if (!instance) {
        throw new NotFoundError('نمونه فرآیند کاری متناظر با این وظیفه یافت نشد');
      }

      const userRole = (params.userRole || '').trim().toLowerCase();
      const userPerms = params.userPermissions || [];
      const isAdmin = userRole === 'admin' || userPerms.includes('workflow.admin') || userPerms.includes('admin');

      // v8.0.88 (TD-377، تصمیم مالک محصول «کارهای نقش او»): جانشین در بازه و حوزه تفویض کار کاربر تعیین‌شده یا نامزد
      // و کار نقش تفویض‌کننده را انجام می‌دهد؛ پیش‌تر فقط کار کاربر تعیین‌شده یا نامزد را، و کار نقشی هرگز
      let delegationLogDetails: Record<string, unknown> | null = null;
      let isAuthorized = isAdmin || this.assignedDirectly(task, params.userId, userRole);
      if (!isAuthorized) {
        const [definition] = await tx.select({ code: workflowDefinitions.code }).from(workflowDefinitions)
          .where(eq(workflowDefinitions.id, instance.workflowDefinitionId));
        const delegations = await WorkflowDelegationService.activeDelegations(tx, { toUserId: params.userId });
        const validDelegation = this.delegationForTask(task, this.workflowCodeOf(instance, definition?.code), delegations);
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
        throw new ForbiddenError('شما مجاز به اجرای این وظیفه نیستید (فاقد تخصیص مستقیم، نقش متناظر یا تفویض اختیار معتبر) (WF_TASK_UNAUTHORIZED).');
      }

      // v8.0.81 (TD-370): تأیید همان انتقال خود کار را اجرا می‌کند و «رد» فقط انتقال رد گام جاری را (از تصویر نسخه
      // فرایند). پیش‌تر اولین انتقال مثبت یا منفی جدول برداشته می‌شد و «رد» در گام بی‌انتقال رد همان تأیید را اجرا می‌کرد.
      const effectiveTransitionId = await this.resolveTaskTransition(tx, task, instance, params);
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

      // v8.0.82 (TD-371): کار فقط وقتی انتقال واقعاً انجام شد بسته می‌شود؛ امضایی که حدنصاب را کامل نکرده (یا تکراری
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
        ? `با اقدام «${params.action === 'reject' ? 'رد' : 'تایید'}» اجرا گردید`
        : `امضای ${params.action === 'reject' ? 'رد' : 'تایید'} ثبت شد و تا تکمیل حدنصاب باز است`;
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

  /** کار به خود کاربر داده شده: کاربر تعیین‌شده یا نامزد، یا نقش کار (یا «همه») */
  private static assignedDirectly(
    task: Pick<typeof workflowTasks.$inferSelect, 'assignedUserId' | 'candidateUsers' | 'candidateRoles' | 'assignedRole'>,
    userId: number,
    userRole: string
  ): boolean {
    const candidateUserIds = Array.isArray(task.candidateUsers) ? task.candidateUsers.map(Number) : [];
    if (task.assignedUserId === userId || candidateUserIds.includes(userId)) return true;
    return this.taskRolesOf(task).some(r => r === '*' || r === 'all' || r === userRole);
  }

  /** کد گردش‌کار فرایند برای حوزه تفویض: از تصویر نسخه، وگرنه از تعریف */
  private static workflowCodeOf(instance: { snapshotDsl: unknown }, definitionCode?: string | null): string {
    const snapshot = instance.snapshotDsl as { code?: string } | null;
    return snapshot?.code || definitionCode || '';
  }

  /**
   * v8.0.88 (TD-377، تصمیم مالک محصول «کارهای نقش او»): تفویض فعالی که کار را به جانشین می‌دهد: حوزه‌اش گردش‌کار را
   * می‌پوشاند و تفویض‌کننده کاربر تعیین‌شده یا نامزد کار است یا نقش کار را دارد (همان قاعده نقش اجرای انتقال).
   */
  private static delegationForTask(
    task: Pick<typeof workflowTasks.$inferSelect, 'assignedUserId' | 'candidateUsers' | 'candidateRoles' | 'assignedRole'>,
    workflowCode: string,
    delegations: ActingDelegation[]
  ): ActingDelegation | undefined {
    const candidateUserIds = Array.isArray(task.candidateUsers) ? task.candidateUsers.map(Number) : [];
    const taskRoles = this.taskRolesOf(task);
    return delegations.find(d => WorkflowDelegationService.delegationCovers(d.scope, workflowCode) && (
      d.fromUserId === task.assignedUserId
      || candidateUserIds.includes(d.fromUserId)
      || taskRoles.some(r => WorkflowTransitionExecutor.checkUserRoleMatch(d.fromRole, r, []))
    ));
  }

  /**
   * v8.0.81 (TD-370): انتقالی که اجرای کار انجام می‌دهد. تأیید: انتقال خود کار، اگر از گام جاری باشد. رد: انتقال رد
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
      throw new ConflictError('این وظیفه به گام جاری فرآیند تعلق ندارد؛ کارتابل را تازه کنید (WF_TASK_STALE)');
    }
    if (params.action === 'approve') return own.id;

    const rejects = stateTransitions.filter(t => WorkflowTransitionExecutor.isNegativeTransition(t.actionKey, t.title));
    if (params.transitionId) {
      const chosen = rejects.find(t => t.id === params.transitionId);
      if (!chosen) throw new ValidationError('انتقال «رد» انتخاب‌شده از گام جاری این وظیفه نیست (WF_TASK_INVALID_REJECT)');
      return chosen.id;
    }
    if (rejects.some(t => t.id === own.id)) return own.id;
    if (rejects.length === 0) {
      throw new ValidationError('این گام فرآیند انتقال «رد» ندارد؛ فقط تأیید ممکن است (WF_TASK_NO_REJECT_TRANSITION)');
    }
    const allowed = rejects.filter(t => WorkflowTransitionExecutor.checkUserRoleMatch(params.userRole, t.requiredRole || undefined, params.userPermissions || []));
    if (allowed.length === 1) return allowed[0].id;
    if (rejects.length === 1) return rejects[0].id;
    throw new ValidationError(`این گام چند انتقال «رد» دارد (${rejects.map(t => t.title).join('، ')})؛ یکی را انتخاب کنید (WF_TASK_REJECT_AMBIGUOUS)`);
  }

  /**
   * Get pending approvals list for a user / role
   */
  static async getPendingApprovalsForUser(userId: number, roleNames: string[]) {
    const userRoles = roleNames.map(r => r.toLowerCase());
    const isAdmin = userRoles.includes('admin');

    const rawPendingList = await orm.select({
      approval: workflowPendingApprovals,
      instance: workflowInstances,
      transition: workflowTransitions
    })
    .from(workflowPendingApprovals)
    .innerJoin(workflowInstances, eq(workflowPendingApprovals.instanceId, workflowInstances.id))
    .leftJoin(workflowTransitions, eq(workflowPendingApprovals.transitionId, workflowTransitions.id));

    // Consolidate per workflow instance: Ensure only ONE approval card is shown per instance in the inbox.
    // If an instance has both forward approval and negative rejection actions, prioritize the forward action.
    const instanceMap = new Map<number, typeof rawPendingList[0]>();
    for (const item of rawPendingList) {
      const instId = item.instance.id;
      const isNeg = WorkflowTransitionExecutor.isNegativeTransition(item.transition?.actionKey, item.transition?.title);
      const existing = instanceMap.get(instId);
      if (!existing) {
        instanceMap.set(instId, item);
      } else {
        const existingIsNeg = WorkflowTransitionExecutor.isNegativeTransition(existing.transition?.actionKey, existing.transition?.title);
        if (existingIsNeg && !isNeg) {
          instanceMap.set(instId, item);
        }
      }
    }

    const consolidatedPendingList = Array.from(instanceMap.values());

    const matched: any[] = [];
    for (const item of consolidatedPendingList) {
      const app = item.approval;
      const inst = item.instance;

      if (isAdmin || app.assignedUserId === userId || userRoles.includes((app.assignedRole || '').toLowerCase())) {
        const context = await getEntityContext(inst.entityType, inst.entityId);
        matched.push({
          ...app,
          entityType: inst.entityType,
          entityId: inst.entityId,
          status: inst.status,
          instance: {
            id: inst.id,
            workflowDefinitionId: inst.workflowDefinitionId,
            entityType: inst.entityType,
            entityId: inst.entityId,
            currentStateId: inst.currentStateId,
            status: inst.status,
            createdAt: inst.createdAt,
            updatedAt: inst.updatedAt
          },
          refNumber: context.refNumber || context.code || inst.entityId,
          buyerName: context.buyerName || '',
          amount: context.amount || context.totalAmount || 0
        });
      }
    }

    return matched;
  }

  /**
   * Get Approval Inbox (delegated to getPendingApprovalsForUser)
   */
  static async getApprovalInbox(params: {
    role?: string;
    userId?: number;
    page?: number;
    limit?: number;
  }) {
    const userId = params.userId || 0;
    const role = params.role || '';
    const pending = await this.getPendingApprovalsForUser(userId, [role]);
    return {
      data: pending,
      total: pending.length,
      page: params.page || 1,
      limit: params.limit || 50
    };
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
