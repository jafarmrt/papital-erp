import { eq, and, asc, desc, isNull, sql } from 'drizzle-orm';
import { orm } from '../../db/drizzle.js';
import { pieceworkTasks, pieceworkTaskRateHistory, pieceworkPersonnelRates, pieceworkLogs, personnel, taskCategories, productionProjects } from '../../db/schema.js';
import { logger } from '../../middleware/logger.js';
import { requireStorageDate } from '../../lib/storageDate.js';

/**
 * خواندن عناوین کاری، تاریخچه نرخ، دسته‌بندی‌ها، نرخ‌های اختصاصی و کارکردهای پرکیسی.
 * فیلترها مقدار خام query string هستند و همان مقایسه‌های قبلی روی آن‌ها انجام می‌شود.
 */

export interface TaskListFilters {
  category?: unknown;
  search?: unknown;
  status?: unknown;
}

export interface WorkLogListFilters {
  personnelId?: unknown;
  projectId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  status?: unknown;
}

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
    // v9.0.275 (TD-809): تاریخچه نرخ اختصاصی پرسنل (personnel_id) داده حقوق شخص است و در تاریخچه نرخ پایه نمی‌آید
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
      // v9.0.275 (TD-809): ترتیب شناسه؛ صفحه نرخ‌ها آخرین ردیف هر کار را نشان می‌دهد، همان که کارکرد می‌گیرد
      .orderBy(asc(pieceworkPersonnelRates.id));
  }

  /** کارکردهای روزانه با نام پرسنل، عنوان کار و پروژه، و فیلتر پرسنل/پروژه/بازه تاریخ/وضعیت. */
  static async listWorkLogs(filters: WorkLogListFilters) {
    const { personnelId, projectId, startDate, endDate, status } = filters;

    let rows = await orm.select({
      id: pieceworkLogs.id,
      personnelId: pieceworkLogs.personnelId,
      personnelName: personnel.fullName,
      personnelCode: personnel.personnelCode,
      taskId: pieceworkLogs.taskId,
      taskTitle: pieceworkTasks.title,
      taskCode: pieceworkTasks.code,
      taskCategory: pieceworkTasks.category,
      unit: pieceworkTasks.unit,
      projectId: pieceworkLogs.projectId,
      projectCode: productionProjects.projectCode,
      projectTitle: productionProjects.title,
      date: pieceworkLogs.date,
      dateIso: pieceworkLogs.dateIso,
      quantity: pieceworkLogs.quantity,
      unitRate: pieceworkLogs.unitRate,
      totalAmount: pieceworkLogs.totalAmount,
      notes: pieceworkLogs.notes,
      payrollId: pieceworkLogs.payrollId,
      status: pieceworkLogs.status,
      createdById: pieceworkLogs.createdById,
      createdByUsername: pieceworkLogs.createdByUsername,
      createdAt: pieceworkLogs.createdAt
    })
    .from(pieceworkLogs)
    .innerJoin(personnel, eq(pieceworkLogs.personnelId, personnel.id))
    .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
    .leftJoin(productionProjects, eq(pieceworkLogs.projectId, productionProjects.id))
    .where(eq(pieceworkLogs.isDeleted, 0))
    .orderBy(desc(pieceworkLogs.date), desc(pieceworkLogs.id));

    if (personnelId && String(personnelId) !== 'ALL') {
      const pId = Number(personnelId);
      rows = rows.filter(r => r.personnelId === pId);
    }

    if (projectId && String(projectId) !== 'ALL') {
      const projId = Number(projectId);
      rows = rows.filter(r => r.projectId === projId);
    }

    // v7.0.134 (TD-232): تاریخ کارکرد میلادی ISO است؛ بازه شمسی ورودی ISO می‌شود (پیش‌تر هر ردیف میلادی از شرط «از تاریخ» رد می‌شد)
    const sIso = requireStorageDate(startDate, 'از تاریخ');
    const eIso = requireStorageDate(endDate, 'تا تاریخ');
    if (sIso) rows = rows.filter(r => r.date >= sIso);
    if (eIso) rows = rows.filter(r => r.date <= eIso);

    if (status && String(status) !== 'ALL') {
      rows = rows.filter(r => r.status === String(status));
    }

    return rows;
  }
}
