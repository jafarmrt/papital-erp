import { orm, type DbExecutor } from '../../db/drizzle.js';
import { 
  workflowDelegations, 
  users 
} from '../../db/schema.js';
import { eq, or, and, desc, sql, inArray, type SQL } from 'drizzle-orm';
import { logActivity } from '../../lib/auditLogger.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';

/** v8.0.88 (TD-377): تفویض فعالی که کاربر به‌واسطه آن به جای تفویض‌کننده کار می‌کند */
export interface ActingDelegation {
  id: number;
  fromUserId: number;
  toUserId: number;
  fromRole: string;
  fromName: string;
  scope: string;
}

export class WorkflowDelegationService {
  /** حوزه تفویض این گردش‌کار را می‌پوشاند: «ALL»، «*» یا همان کد گردش‌کار (بی‌توجه به حروف بزرگ و کوچک) */
  static delegationCovers(scope: string | null | undefined, workflowCode: string | null | undefined): boolean {
    const s = (scope || 'ALL').trim().toLowerCase();
    return s === 'all' || s === '*' || (!!workflowCode && s === workflowCode.trim().toLowerCase());
  }

  /**
   * v8.0.88 (TD-377، تصمیم مالک محصول «کارهای نقش او»): تفویض‌های فعال (لغونشده و در بازه) به کاربر یا از کاربران داده‌شده،
   * با نقش و نام تفویض‌کننده؛ تفویض‌کننده یا جانشین حذف‌شده شمرده نمی‌شود.
   */
  static async activeDelegations(
    db: DbExecutor,
    filter: { toUserId?: number; fromUserIds?: number[] },
    now: Date = new Date()
  ): Promise<ActingDelegation[]> {
    if (filter.fromUserIds && filter.fromUserIds.length === 0) return [];
    const nowIso = now.toISOString();
    const rows = await db.select({
      id: workflowDelegations.id,
      fromUserId: workflowDelegations.fromUserId,
      toUserId: workflowDelegations.toUserId,
      scope: workflowDelegations.scope,
      fromRole: users.role,
      fromName: sql<string>`COALESCE(NULLIF(${users.fullName}, ''), ${users.username})`,
    })
      .from(workflowDelegations)
      .innerJoin(users, eq(users.id, workflowDelegations.fromUserId))
      .where(and(
        filter.toUserId !== undefined ? eq(workflowDelegations.toUserId, filter.toUserId) : undefined,
        filter.fromUserIds ? inArray(workflowDelegations.fromUserId, filter.fromUserIds) : undefined,
        eq(workflowDelegations.isActive, 1),
        sql`${workflowDelegations.startDate} <= ${nowIso}`,
        sql`${workflowDelegations.endDate} >= ${nowIso}`,
        sql`COALESCE(${users.isDeleted}, 0) = 0`,
        sql`EXISTS (SELECT 1 FROM users tu WHERE tu.id = ${workflowDelegations.toUserId} AND COALESCE(tu.is_deleted, 0) = 0)`
      ))
      .orderBy(workflowDelegations.id);
    return rows.map(r => ({ ...r, fromRole: r.fromRole || '', scope: r.scope || 'ALL' }));
  }

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
    // v8.0.89 (TD-378): ورودی نادرست ۴۲۲ و کاربر ناموجود ۴۰۴ است، نه خطای خام ۵۰۰
    if (params.fromUserId === params.toUserId) {
      throw new ValidationError('کاربر تفویض‌کننده و دریافت‌کننده نمی‌تواند یکسان باشد (WF_DELEGATION_SELF_NOT_ALLOWED)');
    }

    const start = new Date(params.startDate).getTime();
    const end = new Date(params.endDate).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new ValidationError('تاریخ شروع یا پایان تفویض معتبر نیست (WF_DELEGATION_INVALID_TIME)');
    }
    if (start > end) {
      throw new ValidationError('تاریخ شروع تفویض نمی‌تواند بعد از تاریخ پایان باشد (WF_DELEGATION_INVALID_TIME)');
    }

    const [fromUser] = await orm.select().from(users).where(eq(users.id, params.fromUserId));
    const [toUser] = await orm.select().from(users).where(eq(users.id, params.toUserId));

    if (!fromUser || !toUser || fromUser.isDeleted === 1 || toUser.isDeleted === 1) {
      throw new NotFoundError('کاربر تفویض‌کننده یا دریافت‌کننده در سیستم یافت نشد');
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
      toUsername: sql<string>`tu.username`,
      // V3.0.9 (TD-055/BUG): ستون‌ها `timestamp WITHOUT time zone` هستند و نود
      // رشته‌های UTC ISO (با Z که PG نادیده می‌گیرد) را literal ذخیره می‌کند؛ بنابراین
      // مقایسه باید با «ساعت UTC» باشد نه now() با TZ سشن (تهران) که +۳:۳۰ انحراف می‌دهد.
      isActiveNow: sql<number>`(${workflowDelegations.isActive} = 1 AND ${workflowDelegations.startDate} <= (now() AT TIME ZONE 'utc') AND ${workflowDelegations.endDate} >= (now() AT TIME ZONE 'utc'))`,
      isExpiredFlag: sql<number>`(${workflowDelegations.isActive} = 1 AND ${workflowDelegations.endDate} < (now() AT TIME ZONE 'utc'))`
    })
    .from(workflowDelegations)
    .leftJoin(sql`users fu`, sql`fu.id = ${workflowDelegations.fromUserId}`)
    .leftJoin(sql`users tu`, sql`tu.id = ${workflowDelegations.toUserId}`);

    const conditions: SQL[] = [];
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

    return rows.map(r => {
      const activeNow = Number(r.isActiveNow) === 1;
      const expired = Number(r.isExpiredFlag) === 1;

      return {
        ...r.delegation,
        fromUserName: r.fromUserFullName || r.fromUsername || `کاربر #${r.delegation.fromUserId}`,
        toUserName: r.toUserFullName || r.toUsername || `کاربر #${r.delegation.toUserId}`,
        status: r.delegation.isActive === 0 ? 'revoked' : (expired ? 'expired' : (activeNow ? 'active' : 'scheduled'))
      };
    });
  }

  /**
   * Revoke an active workflow delegation
   */
  static async revokeDelegation(params: { id: number; userId: number; userRole?: string; userName?: string }) {
    return await orm.transaction(async (tx) => {
      const [delegation] = await tx.select().from(workflowDelegations).where(eq(workflowDelegations.id, params.id)).for('update');
      if (!delegation) {
        throw new NotFoundError('رکورد تفویض اختیار یافت نشد');
      }

      // v8.0.89 (TD-378): تفویض را فقط تفویض‌کننده یا ادمین لغو می‌کند؛ پیش‌تر خود جانشین هم آن را لغو می‌کرد
      const isAdmin = params.userRole === 'admin';
      if (!isAdmin && delegation.fromUserId !== params.userId) {
        throw new ForbiddenError('فقط تفویض‌کننده یا مدیر سیستم می‌تواند این تفویض اختیار را لغو کند (WF_DELEGATION_REVOKE_FORBIDDEN)');
      }

      await tx.update(workflowDelegations)
        .set({ isActive: 0 })
        .where(eq(workflowDelegations.id, params.id));

      await logActivity({
        userId: params.userId,
        username: params.userName || 'کاربر',
        action: 'UPDATE',
        entity: 'تفویض اختیار ورکفلو',
        entityId: params.id,
        description: `تفویض اختیار شماره #${params.id} با موفقیت لغو گردید.`,
        details: { delegationId: params.id, revokedBy: params.userId, before: { isActive: delegation.isActive }, after: { isActive: 0 } },
        tx
      });

      return { success: true, id: params.id };
    });
  }
}
