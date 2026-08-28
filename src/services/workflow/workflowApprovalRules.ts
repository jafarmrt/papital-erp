import { orm } from '../../db/drizzle';
import { 
  workflowInstances, 
  workflowPendingApprovals, 
  workflowTasks, 
  workflowDelegations, 
  users, 
  roles,
  workflowTransitions,
  workflowStates,
  workflowHistoryLogs,
  workflowDefinitions
} from '../../db/schema';
import { eq, and, or, inArray, desc, sql, count } from 'drizzle-orm';
import { logActivity } from '../../lib/auditLogger';
import { logger } from '../../middleware/logger';
import { getEntityContext } from './workflowDslParser';
import { WorkflowTransitionExecutor } from './workflowTransitionExecutor';

export class WorkflowApprovalRules {
  /**
   * Process Multi-Signature / Parallel Approvals
   */
  static async processMultiSignApproval(params: {
    instanceId: number;
    transitionId: number;
    userId?: number;
    userName?: string;
    userRole?: string;
    comment?: string;
    snapshotData?: Record<string, any>;
  }) {
    return await WorkflowTransitionExecutor.executeTransition(params);
  }

  /**
   * Get Approval Inbox
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
   * Get User's Active Tasks Inbox
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

    const filteredTasks = [];
    for (const item of allTasks) {
      const task = item.task;
      const instance = item.instance;

      let isAssigned = false;
      let delegationInfo: any = null;

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
   * Get Tasks for a Workflow Instance
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
    snapshotData?: Record<string, any>;
  }) {
    return await orm.transaction(async (tx) => {
      const [task] = await tx.select().from(workflowTasks).where(eq(workflowTasks.id, params.taskId)).for('update');
      if (!task) {
        throw new Error('وظیفه مورد نظر یافت نشد');
      }

      if (task.status !== 'pending') {
        throw new Error('این وظیفه قبلاً تعیین تکلیف شده است');
      }

      if (!task.transitionId) {
        throw new Error('انتقال معتبری به این وظیفه متصل نیست');
      }

      const [instance] = await tx.select().from(workflowInstances).where(eq(workflowInstances.id, task.instanceId));
      if (!instance) {
        throw new Error('نمونه فرآیند کاری متناظر با این وظیفه یافت نشد');
      }

      const userRole = (params.userRole || '').trim().toLowerCase();
      const userPerms = params.userPermissions || [];
      const isAdmin = userRole === 'admin' || userPerms.includes('workflow.admin') || userPerms.includes('admin');

      let isAuthorized = false;
      let delegationLogDetails: any = null;

      const candidateUserIds: number[] = Array.isArray(task.candidateUsers) ? task.candidateUsers.map(Number) : [];
      const candidateRolesList: string[] = Array.isArray(task.candidateRoles) ? task.candidateRoles.map(r => String(r).toLowerCase()) : [];

      if (isAdmin) {
        isAuthorized = true;
      } else if (task.assignedUserId === params.userId || candidateUserIds.includes(params.userId)) {
        // Direct assignment or candidate user match
        isAuthorized = true;
      } else {
        // Check candidate roles or assigned role
        const taskRoles = candidateRolesList.length > 0 ? candidateRolesList : [(task.assignedRole || '').toLowerCase()];
        if (taskRoles.some(r => r === '*' || r === 'all' || (r && r === userRole))) {
          isAuthorized = true;
        } else {
          // Check active delegations
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

            const workflowCode = (instance.snapshotDsl as any)?.code || '';
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
        throw new Error('شما مجاز به اجرای این وظیفه نیستید (فاقد تخصیص مستقیم، نقش متناظر یا تفویض اختیار معتبر).');
      }

      // Execute transition through core executor
      const transitionResult = await WorkflowTransitionExecutor.executeTransition({
        instanceId: task.instanceId,
        transitionId: task.transitionId,
        userId: params.userId,
        userName: params.userName,
        userRole: params.userRole,
        userPermissions: params.userPermissions,
        comment: params.comment,
        snapshotData: params.snapshotData,
        tx
      });

      // Update task status and mark completion timestamp
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

    const pendingList = await orm.select({
      approval: workflowPendingApprovals,
      instance: workflowInstances
    })
    .from(workflowPendingApprovals)
    .innerJoin(workflowInstances, eq(workflowPendingApprovals.instanceId, workflowInstances.id));

    const matched = [];
    for (const item of pendingList) {
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
   * Create a new workflow delegation
   */
  static async createDelegation(params: {
    fromUserId: number;
    toUserId: number;
    scope?: string;
    startDate: string;
    endDate: string;
    reason?: string;
    createdByUserId?: number;
    createdByName?: string;
  }) {
    if (params.fromUserId === params.toUserId) {
      throw new Error('کاربر تفویض‌کننده و دریافت‌کننده نمی‌تواند یکسان باشد');
    }

    if (new Date(params.startDate).getTime() > new Date(params.endDate).getTime()) {
      throw new Error('تاریخ شروع تفویض نمی‌تواند بعد از تاریخ پایان باشد');
    }

    const [fromUser] = await orm.select().from(users).where(eq(users.id, params.fromUserId));
    const [toUser] = await orm.select().from(users).where(eq(users.id, params.toUserId));

    if (!fromUser || !toUser) {
      throw new Error('کاربر تفویض‌کننده یا دریافت‌کننده در سیستم یافت نشد');
    }

    const scope = (params.scope || 'ALL').trim();

    const [inserted] = await orm.insert(workflowDelegations).values({
      fromUserId: params.fromUserId,
      toUserId: params.toUserId,
      scope,
      startDate: params.startDate,
      endDate: params.endDate,
      reason: params.reason || '',
      isActive: 1
    }).returning();

    await logActivity({
      userId: params.createdByUserId || params.fromUserId,
      username: params.createdByName || fromUser.username,
      action: 'CREATE',
      entity: 'تفویض اختیار ورکفلو',
      entityId: inserted.id,
      description: `تفویض اختیار از کاربر «${fromUser.fullName || fromUser.username}» به کاربر «${toUser.fullName || toUser.username}» با حوزه ${scope} ایجاد گردید.`,
      details: {
        fromUserId: params.fromUserId,
        toUserId: params.toUserId,
        scope,
        startDate: params.startDate,
        endDate: params.endDate,
        reason: params.reason
      }
    });

    return inserted;
  }

  /**
   * Get list of delegations
   */
  static async getDelegations(params: { userId: number; userRole?: string }) {
    const isAdmin = params.userRole === 'admin';

    let query = orm.select({
      delegation: workflowDelegations,
      fromUserFullName: sql<string>`fu.full_name`,
      fromUsername: sql<string>`fu.username`,
      toUserFullName: sql<string>`tu.full_name`,
      toUsername: sql<string>`tu.username`
    })
    .from(workflowDelegations)
    .leftJoin(sql`users fu`, sql`fu.id = ${workflowDelegations.fromUserId}`)
    .leftJoin(sql`users tu`, sql`tu.id = ${workflowDelegations.toUserId}`);

    if (!isAdmin) {
      query = query.where(
        or(
          eq(workflowDelegations.fromUserId, params.userId),
          eq(workflowDelegations.toUserId, params.userId)
        )!
      ) as any;
    }

    const rows = await query.orderBy(desc(workflowDelegations.createdAt));
    const nowIso = new Date().toISOString();

    return rows.map(r => {
      const isCurrentlyActive = r.delegation.isActive === 1 && 
        r.delegation.startDate <= nowIso && 
        r.delegation.endDate >= nowIso;

      const isExpired = r.delegation.endDate < nowIso;

      return {
        ...r.delegation,
        fromUserName: r.fromUserFullName || r.fromUsername || `کاربر #${r.delegation.fromUserId}`,
        toUserName: r.toUserFullName || r.toUsername || `کاربر #${r.delegation.toUserId}`,
        status: r.delegation.isActive === 0 ? 'revoked' : (isExpired ? 'expired' : (isCurrentlyActive ? 'active' : 'scheduled'))
      };
    });
  }

  /**
   * Revoke delegation
   */
  static async revokeDelegation(params: { id: number; userId: number; userRole?: string; userName?: string }) {
    const [delegation] = await orm.select().from(workflowDelegations).where(eq(workflowDelegations.id, params.id));
    if (!delegation) {
      throw new Error('رکورد تفویض اختیار یافت نشد');
    }

    const isAdmin = params.userRole === 'admin';
    if (!isAdmin && delegation.fromUserId !== params.userId && delegation.toUserId !== params.userId) {
      throw new Error('شما دسترسی لازم برای لغو این تفویض اختیار را ندارید');
    }

    await orm.update(workflowDelegations)
      .set({ isActive: 0 })
      .where(eq(workflowDelegations.id, params.id));

    await logActivity({
      userId: params.userId,
      username: params.userName || 'کاربر',
      action: 'UPDATE',
      entity: 'تفویض اختیار ورکفلو',
      entityId: params.id,
      description: `تفویض اختیار شماره #${params.id} با موفقیت لغو گردید.`,
      details: { delegationId: params.id, revokedBy: params.userId }
    });

    return { success: true, id: params.id };
  }
}
