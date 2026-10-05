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

  /** مقادیر متمایز کاربر، عملیات و موجودیت برای فیلترهای صفحه تاریخچه ممیزی. */
  static async getFilterOptions() {
    const rawUsers = await orm.selectDistinct({ username: activityLogs.username, fullName: activityLogs.userFullName }).from(activityLogs);
    const userMap = new Map<string, string>();
    rawUsers.forEach(u => {
      if (u.username) {
        if (!userMap.has(u.username) || (u.fullName && !userMap.get(u.username))) {
          userMap.set(u.username, u.fullName || '');
        }
      }
    });
    const userOptions = Array.from(userMap.entries()).map(([username, fullName]) => ({ username, fullName }));

    const distinctActions = await orm.selectDistinct({ action: activityLogs.action }).from(activityLogs);
    const distinctEntities = await orm.selectDistinct({ entity: activityLogs.entity }).from(activityLogs);

    return {
      users: userOptions,
      actions: distinctActions.map(a => a.action).filter(Boolean),
      entities: distinctEntities.map(e => e.entity).filter(Boolean)
    };
  }
}
