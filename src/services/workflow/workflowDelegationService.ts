import { orm } from '../../db/drizzle.js';
import { 
  workflowDelegations, 
  users 
} from '../../db/schema.js';
import { eq, or, and, desc, sql } from 'drizzle-orm';
import { logActivity } from '../../lib/auditLogger.js';

export class WorkflowDelegationService {
  /**
   * Create a new time-bounded workflow delegation
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
      throw new Error('کاربر تفویض‌کننده و دریافت‌کننده نمی‌تواند یکسان باشد (WF_DELEGATION_SELF_NOT_ALLOWED)');
    }

    if (new Date(params.startDate).getTime() > new Date(params.endDate).getTime()) {
      throw new Error('تاریخ شروع تفویض نمی‌تواند بعد از تاریخ پایان باشد (WF_DELEGATION_INVALID_TIME)');
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
   * Get list of delegations for a user or admin
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

    const conditions = [];
    if (!isAdmin) {
      conditions.push(
        or(
          eq(workflowDelegations.fromUserId, params.userId),
          eq(workflowDelegations.toUserId, params.userId)
        )!
      );
    }

    const rows = await query
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workflowDelegations.createdAt));
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
   * Revoke an active workflow delegation
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
