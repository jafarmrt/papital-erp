import { eq, and, asc, desc, isNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { pieceworkTasks, pieceworkTaskRateHistory, pieceworkPersonnelRates, taskCategories } from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';
import type { WorkLogListFilters } from '../../lib/piecework/workLogList.js';
import { listWorkLogs } from './workLogList.js';

/**
 * خواندن عناوین کاری، تاریخچه نرخ، دسته‌بندی‌ها، نرخ‌های اختصاصی و کارکردهای پرکیسی.
 * فیلترها مقدار خام query string هستند و همان مقایسه‌های قبلی روی آن‌ها انجام می‌شود.
 */

export interface TaskListFilters {
  category?: unknown;
  search?: unknown;
  status?: unknown;
}

export type { WorkLogListFilters };

export class PieceworkReadService {
  /** عناوین کاری (فعال، بایگانی یا همه) با فیلتر دسته و جستجو. */
  static async listTasks(filters: TaskListFilters) {
    const { category, search, status = 'active' } = filters;

    let whereClause = eq(pieceworkTasks.isDeleted, 0);
    if (status === 'archived') {
      whereClause = eq(pieceworkTasks.isDeleted, 1);
    } else if (status === 'all') {
      whereClause = sql`1=1`;
    }

    const tasks = await orm.select()
      .from(pieceworkTasks)
      .where(whereClause)
      .orderBy(pieceworkTasks.category, pieceworkTasks.id);

    let filtered = tasks;
    if (category && String(category) !== 'ALL' && String(category) !== 'all') {
      filtered = filtered.filter(t => t.category === String(category));
    }

    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.category && t.category.toLowerCase().includes(q))
      );
    }

    return filtered;
  }

  /** تاریخچه سراسری تغییر نرخ‌ها (جدیدترین اول). */
  static async listRateHistory(limit: number) {
    // v9.0.284 (TD-809): تاریخچه نرخ اختصاصی پرسنل (personnel_id) داده حقوق شخص است و در تاریخچه نرخ پایه نمی‌آید
    return orm.select()
      .from(pieceworkTaskRateHistory)
      .where(isNull(pieceworkTaskRateHistory.personnelId))
      .orderBy(desc(pieceworkTaskRateHistory.id))
      .limit(limit);
  }

  /** تاریخچه تغییر نرخ یک عنوان کاری. */
  static async listTaskRateHistory(taskId: number) {
    return orm.select()
      .from(pieceworkTaskRateHistory)
      .where(and(eq(pieceworkTaskRateHistory.taskId, taskId), isNull(pieceworkTaskRateHistory.personnelId)))
      .orderBy(desc(pieceworkTaskRateHistory.id));
  }

  /** دسته‌بندی‌های تعریف‌شده به‌علاوه نام دسته‌هایی که فقط در عناوین کاری فعال به کار رفته‌اند. */
  static async listCategories() {
    let dbCats: Array<typeof taskCategories.$inferSelect> = [];
    try {
      dbCats = await orm.select().from(taskCategories).where(eq(taskCategories.isDeleted, 0));
    } catch (e) {
      logger.warn({ message: 'taskCategories table query error, falling back to empty list', error: e });
    }

    let tasks: Array<{ cat: string | null }> = [];
    try {
      tasks = await orm.select({ cat: pieceworkTasks.category }).from(pieceworkTasks).where(eq(pieceworkTasks.isDeleted, 0));
    } catch (e) {
      logger.warn({ message: 'pieceworkTasks query error', error: e });
    }

    // Map categories from the database (user created) and any active categories used in tasks
    const catMap = new Map<string, { id: number | string; name: string; description: string }>();

    // First, add all active database categories
    for (const c of dbCats) {
      catMap.set(c.name, {
        id: c.id,
        name: c.name,
        description: c.description || ''
      });
    }

    // Also include any distinct category names present in existing tasks that may not yet be in taskCategories table
    for (const t of tasks) {
      if (t.cat && t.cat.trim() && !catMap.has(t.cat.trim())) {
        catMap.set(t.cat.trim(), {
          id: t.cat.trim(),
          name: t.cat.trim(),
          description: ''
        });
      }
    }

    return Array.from(catMap.values());
  }

  /** نرخ‌های اختصاصی فعال یک پرسنل. */
  static async listPersonnelRates(personnelId: number) {
    return orm.select()
      .from(pieceworkPersonnelRates)
      .where(and(eq(pieceworkPersonnelRates.personnelId, personnelId), eq(pieceworkPersonnelRates.isDeleted, 0)))
      // v9.0.284 (TD-809): ترتیب شناسه؛ صفحه نرخ‌ها آخرین ردیف هر کار را نشان می‌دهد، همان که کارکرد می‌گیرد
      .orderBy(asc(pieceworkPersonnelRates.id));
  }

  /** کارکردهای روزانه با نام پرسنل، عنوان کار و پروژه؛ فیلترها در SQL (v9.0.325، TD-811، `workLogList.ts`). */
  static async listWorkLogs(filters: WorkLogListFilters) {
    return listWorkLogs(filters);
  }
}
