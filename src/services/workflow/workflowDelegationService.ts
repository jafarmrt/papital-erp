import { orm, type DbExecutor } from '../../db/drizzle.js';
import { 
  workflowDelegations, 
  workflowDefinitions,
  users 
} from '../../db/schema.js';
import { eq, or, and, desc, sql, inArray, type SQL } from 'drizzle-orm';
import { logActivity } from '../../lib/auditLogger.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/customErrors.js';
import { ROW_ADVISORY_LOCK_NAMESPACES } from '../../lib/advisoryLock.js';
import { toPersianDigits } from '../../utils/persianNumber.js';
import { getDisplayTimezone } from '../../lib/businessClock.js';
import { zonedDayStartUtc } from '../../lib/serverTimestamp.js';
import { isSystemAdminRole } from '../../lib/permissions/permissionCatalog.js';

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** بازه تفویض: روز تنها به آغاز روز اول و آخرین لحظه روز آخر در منطقه زمانی توافقی (زمان سرور UTC) */
async function delegationWindow(startDate: string, endDate: string): Promise<{ startDate: string; endDate: string }> {
  if (!DAY_ONLY.test(startDate) && !DAY_ONLY.test(endDate)) return { startDate, endDate };
  const tz = await getDisplayTimezone();
  const dayAfter = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  };
  const endOfDay = (day: string) => {
    const next = new Date(`${zonedDayStartUtc(dayAfter(day), tz).replace(' ', 'T')}Z`).getTime() - 1;
    return new Date(next).toISOString().replace('T', ' ').replace('Z', '');
  };
  return {
    startDate: DAY_ONLY.test(startDate) ? zonedDayStartUtc(startDate, tz) : startDate,
    endDate: DAY_ONLY.test(endDate) ? endOfDay(endDate) : endDate,
  };
}

const isAllScope = (scope: string | null | undefined): boolean => ['all', '*'].includes(String(scope ?? 'ALL').trim().toLowerCase());

/**
 * v10.1.14 (D-06 part C, OBS-R2-66): a live (not revoked) delegation of the same delegator whose window meets the given one
 * and whose scope meets it: «همه» meets every scope, otherwise the same workflow code.
 */
export async function findOverlappingDelegation(
  db: DbExecutor,
  candidate: { fromUserId: number; scope: string; startDate: string; endDate: string },
): Promise<{ id: number; toUserId: number; toName: string; scope: string; startDate: string; endDate: string } | null> {
  const scopeKey = candidate.scope.trim().toLowerCase();
  const [row] = await db.select({
    id: workflowDelegations.id,
    toUserId: workflowDelegations.toUserId,
    toName: sql<string>`COALESCE(NULLIF(${users.fullName}, ''), ${users.username}, '')`,
    scope: workflowDelegations.scope,
    startDate: workflowDelegations.startDate,
    endDate: workflowDelegations.endDate,
  })
    .from(workflowDelegations)
    .leftJoin(users, eq(users.id, workflowDelegations.toUserId))
    .where(and(
      eq(workflowDelegations.fromUserId, candidate.fromUserId),
      eq(workflowDelegations.isActive, 1),
      sql`${workflowDelegations.startDate} <= ${candidate.endDate}::timestamp`,
      sql`${workflowDelegations.endDate} >= ${candidate.startDate}::timestamp`,
      isAllScope(scopeKey)
        ? undefined
        : sql`lower(btrim(COALESCE(${workflowDelegations.scope}, 'ALL'))) IN ('all', '*', ${scopeKey})`,
    ))
    .orderBy(workflowDelegations.id)
    .limit(1);
  return row ? { ...row, scope: row.scope || 'ALL' } : null;
}

/** v8.0.97 (TD-377): تفویض فعالی که کاربر به‌واسطه آن به جای تفویض‌کننده کار می‌کند */
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
   * v8.0.97 (TD-377، تصمیم مالک محصول «کارهای نقش او»): تفویض‌های فعال (لغونشده و در بازه) به کاربر یا از کاربران داده‌شده،
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
    // v8.0.98 (TD-378): ورودی نادرست ۴۲۲ و کاربر ناموجود ۴۰۴ است، نه خطای خام ۵۰۰
    if (params.fromUserId === params.toUserId) {
      throw new ValidationError('کاربر تفویض‌کننده و دریافت‌کننده نمی‌تواند یکسان باشد', undefined, 'WF_DELEGATION_SELF_NOT_ALLOWED');
    }

    // TD-468 (یافته B14-26): تفویضی که با روز فرستاده شود (YYYY-MM-DD، فرم تفویض) از ۰۰:۰۰ روز اول تا پایان روز آخر در منطقه
    // زمانی توافقی است؛ پیش‌تر فرم نیمه‌شب UTC (۰۳:۳۰ تهران) را می‌فرستاد و پایانش ۰۳:۲۹ روز بعد بود
    const { startDate, endDate } = await delegationWindow(params.startDate, params.endDate);
    const start = new Date(`${startDate.replace(' ', 'T')}${DAY_ONLY.test(params.startDate) ? 'Z' : ''}`).getTime();
    const end = new Date(`${endDate.replace(' ', 'T')}${DAY_ONLY.test(params.endDate) ? 'Z' : ''}`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new ValidationError('تاریخ شروع یا پایان تفویض معتبر نیست', undefined, 'WF_DELEGATION_INVALID_TIME');
    }
    if (start > end) {
      throw new ValidationError('تاریخ شروع تفویض نمی‌تواند بعد از تاریخ پایان باشد', undefined, 'WF_DELEGATION_INVALID_TIME');
    }

    const scope = (params.scope || 'ALL').trim();
    // TD-963 (بخش ۲): تفویض و ردیف ممیزی آن در یک تراکنش ثبت می‌شوند؛ پیش‌تر ردیف ممیزی بیرون از نوشتن تفویض بود
    const inserted = await orm.transaction(async (tx) => {
      // v10.1.14 (D-06 part C, OBS-R2-66, decision ت۹): the delegations of one delegator are written one at a time, so the
      // overlap check below sees a delegation saved at the same moment
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ROW_ADVISORY_LOCK_NAMESPACES.WORKFLOW_DELEGATION_FROM_USER}::int, ${params.fromUserId}::int)`);

      const [fromUser] = await tx.select().from(users).where(eq(users.id, params.fromUserId));
      const [toUser] = await tx.select().from(users).where(eq(users.id, params.toUserId));
      if (!fromUser || !toUser || fromUser.isDeleted === 1 || toUser.isDeleted === 1) {
        throw new NotFoundError('کاربر تفویض‌کننده یا دریافت‌کننده در سامانه یافت نشد');
      }

      // TD-467 (یافته B14-25، تصمیم ت۶ الف): حوزه «همه» یا کد یکی از گردش‌کارهای تعریف‌شده است؛ پیش‌تر هر متنی (مانند invoice،
      // transfer یا project که فرم پیشنهاد می‌داد) ذخیره می‌شد و چون با هیچ گردش کاری جور نمی‌شد، تفویض اثری نداشت
      if (!isAllScope(scope)) {
        const [definition] = await tx.select({ id: workflowDefinitions.id }).from(workflowDefinitions)
          .where(sql`lower(btrim(${workflowDefinitions.code})) = ${scope.toLowerCase()}`).limit(1);
        if (!definition) {
          throw new ValidationError('حوزه تفویض باید «همه» یا یکی از گردش‌کارهای تعریف‌شده باشد؛ از فهرست حوزه انتخاب کنید.');
        }
      }

      // v10.1.14 (D-06 part C, OBS-R2-66, decision ت۹): one delegator has one deputy per workflow in any moment; a live
      // delegation whose window and scope meet this one refuses it, naming the delegation to revoke first
      const overlap = await findOverlappingDelegation(tx, { fromUserId: params.fromUserId, scope, startDate, endDate });
      if (overlap) {
        throw new ConflictError(
          `در این بازه تفویض شماره ${toPersianDigits(overlap.id)} به «${overlap.toName}» برای همین گردش کار هست؛ یک نفر در یک بازه یک جانشین دارد. نخست آن تفویض را لغو کنید یا بازه دیگری انتخاب کنید.`,
          { delegationId: overlap.id, toUserId: overlap.toUserId, scope: overlap.scope, startDate: overlap.startDate, endDate: overlap.endDate },
          'WF_DELEGATION_OVERLAP',
        );
      }

      const [row] = await tx.insert(workflowDelegations).values({
        fromUserId: params.fromUserId,
        toUserId: params.toUserId,
        scope,
        startDate,
        endDate,
        reason: params.reason || '',
        isActive: 1
      }).returning();

      await logActivity({
        userId: params.createdByUserId || params.fromUserId,
        username: params.createdByName || fromUser.username,
        action: 'CREATE',
        entity: 'تفویض اختیار ورکفلو',
        entityId: row.id,
        description: `تفویض اختیار از کاربر «${fromUser.fullName || fromUser.username}» به کاربر «${toUser.fullName || toUser.username}» با حوزه ${scope} ثبت شد.`,
        details: {
          fromUserId: params.fromUserId,
          toUserId: params.toUserId,
          scope,
          startDate: params.startDate,
          endDate: params.endDate,
          reason: params.reason
        },
        tx
      });
      return row;
    });

    return inserted;
  }

  /**
   * Get list of delegations for a user or admin
   */
  static async getDelegations(params: { userId: number; userRole?: string; mineOnly?: boolean }) {
    // v10.1.14 (D-06 part C, OBS-R2-73): «تفویض‌های من» of the inbox asks only the user's own, the system admin included
    const isAdmin = isSystemAdminRole(params.userRole) && !params.mineOnly;

    let query = orm.select({
      delegation: workflowDelegations,
      fromUserFullName: sql<string>`fu.full_name`,
      fromUsername: sql<string>`fu.username`,
      toUserFullName: sql<string>`tu.full_name`,
      toUsername: sql<string>`tu.username`,
      // v10.1.14 (D-06 part C): the scope's workflow title, so the inbox names it without the definition list
      scopeTitle: sql<string | null>`(SELECT d.title FROM workflow_definitions d WHERE lower(btrim(d.code)) = lower(btrim(${workflowDelegations.scope})) ORDER BY d.id LIMIT 1)`,
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
        scopeTitle: isAllScope(r.delegation.scope) ? null : (r.scopeTitle ?? null),
        status: r.delegation.isActive === 0 ? 'revoked' : (expired ? 'expired' : (activeNow ? 'active' : 'scheduled'))
      };
    });
  }

  /**
   * v10.1.14 (D-06 part C, OBS-R2-73): the scopes a delegation form offers besides «همه»: the code and title of every
   * workflow not archived, so an approver picks a scope without the design permission the definition list asks.
   */
  static async listDelegationScopes(): Promise<Array<{ code: string; title: string }>> {
    return orm.select({ code: workflowDefinitions.code, title: workflowDefinitions.title })
      .from(workflowDefinitions)
      .where(sql`COALESCE(${workflowDefinitions.isArchived}, 0) = 0`)
      .orderBy(workflowDefinitions.title, workflowDefinitions.id);
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

      // v8.0.98 (TD-378): تفویض را فقط تفویض‌کننده یا ادمین لغو می‌کند؛ پیش‌تر خود جانشین هم آن را لغو می‌کرد
      const isAdmin = isSystemAdminRole(params.userRole);
      if (!isAdmin && delegation.fromUserId !== params.userId) {
        throw new ForbiddenError('فقط تفویض‌کننده یا مدیر سامانه می‌تواند این تفویض اختیار را لغو کند', undefined, 'WF_DELEGATION_REVOKE_FORBIDDEN');
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
        description: `تفویض اختیار شماره ${params.id} لغو شد.`,
        details: { delegationId: params.id, revokedBy: params.userId, before: { isActive: delegation.isActive }, after: { isActive: 0 } },
        tx
      });

      return { success: true, id: params.id };
    });
  }
}
