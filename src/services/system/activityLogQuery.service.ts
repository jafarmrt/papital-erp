import { desc, sql, eq, and, SQL } from 'drizzle-orm';
import { orm, raiseWorkMem, type DbExecutor } from '../../db/drizzle.js';
import { activityLogs, activityLogSearchText, users } from '../../db/schema.js';
import { containsLikePattern } from '../../lib/sqlLike.js';
import { withoutNul } from '../../lib/search/searchText.js';
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

/**
 * TD-1324 review: the search text without NUL, which a text column cannot hold (PostgreSQL refused the query with a 500),
 * and without the unit separator that joins the four columns of the search expression, so a typed separator never matches
 * the end of one column and the start of the next. A search left empty is no search, like #338's outbox search.
 */
export function activityLogSearchTerm(search: unknown): string {
  return withoutNul(String(search ?? '')).replace(/\x1f/g, '');
}

/**
 * TD-1324 review: the work_mem of a page read with a search. The planner always takes the trigram index for the search; a
 * phrase of common words matches most rows, and at the default 4 MB the bitmap turns lossy and rechecks millions of rows
 * (2-3 times slower than the scan before the index at 3M rows); 64 MB keeps the bitmap exact (measured 5.8 s to 1.6 s and
 * 6.9 s to 2.2 s).
 */
export const ACTIVITY_LOG_SEARCH_WORK_MEM_MB = 64;

/** Runs a read in a transaction whose work_mem is ACTIVITY_LOG_SEARCH_WORK_MEM_MB; the pool's connections keep their own. */
export function withActivityLogSearchMemory<T>(read: (db: DbExecutor) => Promise<T>): Promise<T> {
  return orm.transaction(async (tx) => {
    await raiseWorkMem(tx, ACTIVITY_LOG_SEARCH_WORK_MEM_MB);
    return read(tx);
  });
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
  // OBS-R1-32 (TD-1324): one ILIKE over the indexed expression (GIN trigram, migration 0132) instead of four that read
  // the whole table; the unit separator between the columns keeps a match inside one column, as before
  const searchTerm = activityLogSearchTerm(search);
  if (searchTerm) {
    conditions.push(sql`(${activityLogSearchText(activityLogs)}) ILIKE ${containsLikePattern(searchTerm)}`);
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

    const readPage = async (db: DbExecutor) => {
      const logs = await db.select({
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

      const [{ count }] = await db.select({ count: sql<number>`count(*)` })
        .from(activityLogs)
        .where(whereClause);

      return { data, count };
    };

    return activityLogSearchTerm(filters.search) ? withActivityLogSearchMemory(readPage) : readPage(orm);
  }

  /**
   * The filter lists of the activity log page. TD-1267 (I-04 follow-up): each list is read with a loose index scan over its
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
