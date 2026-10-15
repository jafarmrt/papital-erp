import { desc, sql, eq, and, SQL } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { activityLogs, users } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { getDisplayTimezone } from '../../lib/businessClock.js';
import { serverTimestampToUtcIso, zonedDayRangeUtc } from '../../lib/serverTimestamp.js';

/**
 * خواندن تاریخچه ممیزی (GET /activity-logs و /activity-logs/filters). پاکسازی و بررسی یکپارچگی
 * در src/lib/auditLogger.ts (purgeOldAuditLogs / checkAuditLogIntegrity) می‌ماند.
 * فیلترها مقدار خام query string هستند و همان شرط‌های قبلی روی آن‌ها ساخته می‌شود.
 */

export interface ActivityLogFilters {
  user?: string;
  action?: string;
  entity?: string;
  category?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}

function buildActivityLogConditions(filters: ActivityLogFilters, dayRange: { from?: string; before?: string }): SQL[] {
  const {
    user: userFilter, action: actionFilter, entity: entityFilter, category: categoryFilter, search
  } = filters;

  const conditions: SQL[] = [];

  if (categoryFilter === 'auth_security') {
    conditions.push(
      sql`(${activityLogs.action} IN ('LOGIN', 'LOGIN_FAILED', 'LOGOUT') OR ${activityLogs.entity} IN ('احراز هویت', 'کاربر', 'کاربران سیستم', 'پروفایل کاربر', 'نقش و دسترسی', 'نقش'))`
    );
  } else if (categoryFilter === 'financial_docs') {
    conditions.push(
      sql`(${activityLogs.entity} IN ('فاکتور', 'پیش‌فاکتور', 'اسناد انبار', 'اسناد انبار / پیش‌فاکتور', 'account', 'journal_voucher', 'bank_account', 'bank_reconciliation', 'treasury_transaction', 'treasury_transfer', 'treasury_reconciliation', 'cheque', 'فیش حقوقی', 'پرداخت حقوق', 'طرف حساب', 'تامین‌کننده', 'طرفین حساب') OR ${activityLogs.entity} ILIKE 'حسابداری%')`
    );
  } else if (categoryFilter === 'inventory_items') {
    conditions.push(
      sql`(${activityLogs.entity} IN ('کالا', 'کالاها_و_محصولات', 'قیمت کالا', 'ماده اولیه', 'موجودی انبار', 'انبار', 'انبارداری و موجودی', 'ترنسفر', 'پروژه تولید', 'پیشرفت به تفکیک کد کالا', 'عنوان پرکیسی', 'عناوین پرکیسی', 'کارکرد پرکیسی') OR ${activityLogs.entity} ILIKE '%کالا%' OR ${activityLogs.entity} ILIKE '%انبار%')`
    );
  } else if (categoryFilter === 'settings_system') {
    conditions.push(
      sql`(${activityLogs.action} IN ('SETTING_CHANGE', 'EXPORT', 'RESTORE', 'AUDIT_APPLY', 'RECONCILIATION_EXECUTE', 'SEED') OR ${activityLogs.entity} LIKE 'سیستم:%' OR ${activityLogs.entity} IN ('تنظیمات سیستم', 'صف خطاهای قرنطینه (DLQ)', 'رویدادهای سیستم'))`
    );
  }

  if (userFilter) {
    conditions.push(eq(activityLogs.username, userFilter));
  }
  if (actionFilter) {
    conditions.push(eq(activityLogs.action, actionFilter));
  }
  if (entityFilter) {
    conditions.push(eq(activityLogs.entity, entityFilter));
  }
  // v8.0.53 (TD-315): روزهای فیلتر روزهای منطقه زمانی توافقی‌اند و زمان ثبت UTC است؛ پیش‌تر روز UTC بریده می‌شد
  if (dayRange.from) {
    conditions.push(sql`${activityLogs.timestamp} >= ${dayRange.from}`);
  }
  if (dayRange.before) {
    conditions.push(sql`${activityLogs.timestamp} < ${dayRange.before}`);
  }
  if (search) {
    conditions.push(
      sql`(${activityLogs.description} ILIKE ${containsLikePattern(search)} OR ${activityLogs.userFullName} ILIKE ${containsLikePattern(search)} OR ${activityLogs.username} ILIKE ${containsLikePattern(search)} OR ${activityLogs.entity} ILIKE ${containsLikePattern(search)})`
    );
  }

  return conditions;
}

export class ActivityLogQueryService {
  /** یک صفحه از تاریخچه ممیزی (جدیدترین اول) به‌همراه تعداد کل ردیف‌های منطبق. */
  static async listLogs(filters: ActivityLogFilters, limit: number, offset: number) {
    const dayRange = (filters.startDate || filters.endDate)
      ? zonedDayRangeUtc(filters.startDate, filters.endDate, await getDisplayTimezone())
      : {};
    const conditions = buildActivityLogConditions(filters, dayRange);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const logs = await orm.select({
      log: activityLogs,
      resolvedFullName: users.fullName
    })
      .from(activityLogs)
      .leftJoin(users, eq(users.username, activityLogs.username))
      .where(whereClause)
      .orderBy(desc(activityLogs.id))
      .limit(limit)
      .offset(offset);

    // یک موجودیت هویت کاربر: نام کامل ثبت‌شده > نام کامل از جدول users > username
    // v8.0.53 (TD-315): زمان ثبت UTC است و با Z برمی‌گردد تا مرورگر آن را به وقت منطقه توافقی نشان دهد
    const data = logs.map(({ log: l, resolvedFullName }) => ({
      ...l,
      timestamp: serverTimestampToUtcIso(l.timestamp),
      userFullName: l.userFullName || resolvedFullName || l.username
    }));

    const [{ count }] = await orm.select({ count: sql<number>`count(*)` })
      .from(activityLogs)
      .where(whereClause);

    return { data, count };
  }

  /**
   * The filter lists of the activity log page. TD-1266 (I-04 follow-up): each list is read with a loose index scan over its
   * own index (`activity_logs_username` / `_action` / `_entity`), one index probe per distinct value, so the answer stays
   * fast as the table grows; before, three `SELECT DISTINCT` read the whole table (p95 107 ms at 300,000 rows, the slowest
   * API of the baseline). A user's full name is read through the same index: the range form of the username condition with
   * `ORDER BY username` keeps the planner on the index, where an equality let it pick a whole-table scan for a rare user.
   */
  static async getFilterOptions() {
    const [userRows, actionRows, entityRows] = await Promise.all([
      orm.execute(sql`
        WITH RECURSIVE names(username) AS (
          (SELECT username FROM activity_logs ORDER BY username LIMIT 1)
          UNION ALL
          SELECT (SELECT a.username FROM activity_logs a WHERE a.username > names.username ORDER BY a.username LIMIT 1)
          FROM names WHERE names.username IS NOT NULL
        )
        SELECT names.username,
          COALESCE((SELECT a.user_full_name FROM activity_logs a
            WHERE a.username >= names.username AND a.username <= names.username AND a.user_full_name <> ''
            ORDER BY a.username LIMIT 1), '') AS full_name
        FROM names WHERE names.username IS NOT NULL AND names.username <> ''`),
      distinctColumnValues(sql`action`),
      distinctColumnValues(sql`entity`),
    ]);
    const users = (userRows.rows as Array<{ username: string; full_name: string }>)
      .map(u => ({ username: String(u.username), fullName: String(u.full_name ?? '') }));
    return { users, actions: actionRows, entities: entityRows };
  }

}

/** The distinct non-empty values of an indexed text column of `activity_logs`, by a loose index scan */
async function distinctColumnValues(column: SQL): Promise<string[]> {
  const res = await orm.execute(sql`
    WITH RECURSIVE vals(v) AS (
      (SELECT ${column} FROM activity_logs ORDER BY ${column} LIMIT 1)
      UNION ALL
      SELECT (SELECT ${column} FROM activity_logs WHERE ${column} > vals.v ORDER BY ${column} LIMIT 1) FROM vals WHERE vals.v IS NOT NULL
    )
    SELECT v FROM vals WHERE v IS NOT NULL AND v <> ''`);
  return (res.rows as Array<{ v: string }>).map(r => String(r.v));
}
