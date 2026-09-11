import { orm, DbExecutor } from '../../db/drizzle.js';
import { 
  workflowInstances, 
  workflowPendingApprovals, 
  workflowTasks, 
  workflowDelegations,
  workflowTransitions
} from '../../db/schema.js';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { logActivity } from '../../lib/auditLogger.js';
import { getEntityContext } from './workflowDslParser.js';
import { WorkflowTransitionExecutor } from './workflowTransitionExecutor.js';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../../errors/customErrors.js';

export class WorkflowTaskService {
  /**
   * Automatically mark overdue tasks as expired
   */
  static async markExpiredTasks(txExecutor: DbExecutor = orm) {
    const nowIso = new Date().toISOString();
    const expiredTasks = await txExecutor.select()
      .from(workflowTasks)
      .where(and(
        eq(workflowTasks.status, 'pending'),
        sql`${workflowTasks.dueAt} IS NOT NULL`,
        sql`${workflowTasks.dueAt} <= ${nowIso}`
      ));

    if (expiredTasks.length > 0) {
      await txExecutor.update(workflowTasks)
        .set({ status: 'expired' })
        .where(inArray(workflowTasks.id, expiredTasks.map(t => t.id)));
    }
    return expiredTasks.length;
  }

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
    await this.markExpiredTasks();
    const userId = params.userId;
    const userRole = (params.userRole || '').trim().toLowerCase();
    const isAdmin = userRole === 'admin';

    const nowIso = new Date().toISOString();
    const activeDelegations = await orm.select()
      .from(workflowDelegations)
      .where(and(
        eq(workflowDelegations.toUserId, userId),
        eq(workflowDelegations.isActive, 1),
        sql`${workflowDelegations.startDate} <= ${nowIso}`,
        sql`${workflowDelegations.endDate} >= ${nowIso}`
      ));

    const delegatedFromUserIds = activeDelegations.map(d => d.fromUserId);

    const targetStatus = params.status || 'pending';
    const allTasks = await orm.select({
      task: workflowTasks,
      instance: workflowInstances
    })
    .from(workflowTasks)
    .innerJoin(workflowInstances, eq(workflowTasks.instanceId, workflowInstances.id))
    .where(eq(workflowTasks.status, targetStatus))
    .orderBy(desc(workflowTasks.createdAt));

    // Consolidate per instance: Ensure at most ONE task card is returned per workflow instance.
    // If an instance has multiple tasks (e.g. positive approval and rejection), keep only the positive review task.
    const seenInstances = new Set<number>();
    const filteredTasks = [];
    
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

      const candidateUserIds: number[] = Array.isArray(task.candidateUsers) ? task.candidateUsers.map(Number) : [];
      const candidateRolesList: string[] = Array.isArray(task.candidateRoles) ? task.candidateRoles.map(r => String(r).toLowerCase()) : [];

      if (isAdmin) {
        isAssigned = true;
      } else if (task.assignedUserId === userId || candidateUserIds.includes(userId)) {
        isAssigned = true;
      } else if (
        (task.assignedUserId && delegatedFromUserIds.includes(task.assignedUserId)) ||
        candidateUserIds.some(cId => delegatedFromUserIds.includes(cId))
      ) {
        isAssigned = true;
        const matchingDelegatorId = (task.assignedUserId && delegatedFromUserIds.includes(task.assignedUserId))
          ? task.assignedUserId
          : candidateUserIds.find(cId => delegatedFromUserIds.includes(cId));
        const del = activeDelegations.find(d => d.fromUserId === matchingDelegatorId);
        delegationInfo = { delegatedFromUserId: del?.fromUserId, delegationScope: del?.scope };
      } else {
        const taskRoles = candidateRolesList.length > 0 ? candidateRolesList : [(task.assignedRole || '').toLowerCase()];
        if (taskRoles.some(r => r === '*' || r === 'all' || (r && r === userRole))) {
          isAssigned = true;
        }
      }

      if (isAssigned) {
        seenInstances.add(task.instanceId);
        const context = await getEntityContext(instance.entityType, instance.entityId);
        filteredTasks.push({
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
        });
      }
    }

    return {
      data: filteredTasks,
      total: filteredTasks.length,
      page: params.page || 1,
      limit: params.limit || 50
    };
  }

  /**
   * Get Task Stats
   */
  static async getTaskStats(params: { userId: number; userRole?: string }) {
    const tasksRes = await this.getMyTasks({ userId: params.userId, userRole: params.userRole, status: 'pending' });
    const tasks = tasksRes.data || [];
    const nowIso = new Date().toISOString();

    const overdueCount = tasks.filter(t => t.dueAt && t.dueAt < nowIso).length;
    return {
      pendingCount: tasks.length,
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
    comment?: string;
    snapshotData?: Record<string, unknown>;
  }) {
    return await orm.transaction(async (tx) => {
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

      let isAuthorized = false;
      let delegationLogDetails: Record<string, unknown> | null = null;

      const candidateUserIds: number[] = Array.isArray(task.candidateUsers) ? task.candidateUsers.map(Number) : [];
      const candidateRolesList: string[] = Array.isArray(task.candidateRoles) ? task.candidateRoles.map(r => String(r).toLowerCase()) : [];

      if (isAdmin) {
        isAuthorized = true;
      } else if (task.assignedUserId === params.userId || candidateUserIds.includes(params.userId)) {
        isAuthorized = true;
      } else {
        const taskRoles = candidateRolesList.length > 0 ? candidateRolesList : [(task.assignedRole || '').toLowerCase()];
        if (taskRoles.some(r => r === '*' || r === 'all' || (r && r === userRole))) {
          isAuthorized = true;
        } else {
          const nowIso = new Date().toISOString();
          const delegatorsToCheck: number[] = [];
          if (task.assignedUserId) delegatorsToCheck.push(task.assignedUserId);
          candidateUserIds.forEach(cId => {
            if (!delegatorsToCheck.includes(cId)) delegatorsToCheck.push(cId);
          });

          if (delegatorsToCheck.length > 0) {
            const activeDelegations = await tx.select()
              .from(workflowDelegations)
              .where(and(
                eq(workflowDelegations.toUserId, params.userId),
                inArray(workflowDelegations.fromUserId, delegatorsToCheck),
                eq(workflowDelegations.isActive, 1),
                sql`${workflowDelegations.startDate} <= ${nowIso}`,
                sql`${workflowDelegations.endDate} >= ${nowIso}`
              ));

            const snapshot = instance.snapshotDsl as { code?: string } | null;
            const workflowCode = snapshot?.code || '';
            const validDelegation = activeDelegations.find(del => {
              const scope = (del.scope || 'ALL').trim();
              return scope === 'ALL' || scope === '*' || (workflowCode && scope.toLowerCase() === workflowCode.toLowerCase());
            });

            if (validDelegation) {
              isAuthorized = true;
              delegationLogDetails = {
                delegationId: validDelegation.id,
                delegatedFromUserId: validDelegation.fromUserId,
                delegationScope: validDelegation.scope
              };
            }
          }
        }
      }

      if (!isAuthorized) {
        throw new ForbiddenError('شما مجاز به اجرای این وظیفه نیستید (فاقد تخصیص مستقیم، نقش متناظر یا تفویض اختیار معتبر) (WF_TASK_UNAUTHORIZED).');
      }

      // Dynamically resolve target transition matching user's action ('approve' vs 'reject')
      let effectiveTransitionId = task.transitionId;
      const stateTransitions = await tx.select()
        .from(workflowTransitions)
        .where(and(
          eq(workflowTransitions.workflowDefinitionId, instance.workflowDefinitionId),
          eq(workflowTransitions.fromStateId, instance.currentStateId)
        ));

      if (params.action === 'reject') {
        const rejectTr = stateTransitions.find(t => WorkflowTransitionExecutor.isNegativeTransition(t.actionKey, t.title));
        if (rejectTr) {
          effectiveTransitionId = rejectTr.id;
        }
      } else {
        const approveTr = stateTransitions.find(t => !WorkflowTransitionExecutor.isNegativeTransition(t.actionKey, t.title));
        if (approveTr) {
          effectiveTransitionId = approveTr.id;
        }
      }

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

      const taskNewStatus = params.action === 'reject' ? 'rejected' : 'approved';
      await tx.update(workflowTasks)
        .set({
          status: taskNewStatus,
          completedAt: new Date().toISOString(),
          delegatedToUserId: delegationLogDetails ? params.userId : null
        })
        .where(eq(workflowTasks.id, task.id));

      await logActivity({
        userId: params.userId,
        username: params.userName,
        action: 'UPDATE',
        entity: 'وظیفه فرآیند کاری',
        entityId: task.id,
        description: `وظیفه شماره #${task.id} («${task.title}») با اقدام «${params.action === 'reject' ? 'رد' : 'تایید'}» اجرا گردید.${delegationLogDetails ? ` (به‌واسطه تفویض اختیار از کاربر #${delegationLogDetails.delegatedFromUserId})` : ''}`,
        details: {
          taskId: task.id,
          instanceId: task.instanceId,
          action: params.action,
          delegation: delegationLogDetails
        }
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

    const matched = [];
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
