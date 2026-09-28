import { eq, and, sql } from 'drizzle-orm';
import { orm, type DbExecutor } from '../db/drizzle.js';
import { pieceworkTasks, pieceworkTaskRateHistory, pieceworkPersonnelRates, pieceworkLogs, taskCategories } from '../db/schema.js';
import { NotFoundError, BadRequestError } from '../errors/customErrors.js';
import { normalizePersianDate, parseQuantityOrTime, jalaliToIsoDate } from '../utils.js';

export interface CreatePieceworkTaskInput {
  code?: string;
  title: string;
  category?: string;
  defaultRate?: number | string;
  unit?: string;
  description?: string;
  userId?: number;
  username?: string;
}

export interface UpdatePieceworkTaskInput {
  title?: string;
  category?: string;
  defaultRate?: number | string;
  unit?: string;
  description?: string;
  isActive?: boolean;
  reason?: string;
  userId?: number;
  username?: string;
}

export interface CreatePieceworkLogInput {
  personnelId: number | string;
  taskId: number | string;
  projectId?: number | string | null;
  date: string;
  quantity: number | string;
  unitRate?: number | string;
  notes?: string;
  createdById?: number;
  createdByUsername?: string;
}

export class PieceworkService {
  /**
   * Helper to record task rate history
   */
  static async recordTaskRateHistory(
    data: {
      taskId: number;
      taskCode?: string;
      taskTitle?: string;
      oldRate?: number;
      newRate: number;
      changeType: 'create' | 'rate_change' | 'excel_import' | 'title_change' | 'archived' | 'restored';
      reason?: string;
      userId?: number;
      username?: string;
    },
    executor: DbExecutor = orm
  ) {
    try {
      const today = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      await executor.insert(pieceworkTaskRateHistory).values({
        taskId: data.taskId,
        taskCode: data.taskCode || '',
        taskTitle: data.taskTitle || '',
        oldRate: Number(data.oldRate || 0),
        newRate: Number(data.newRate || 0),
        changeType: data.changeType,
        reason: data.reason || '',
        changedByUserId: data.userId || null,
        changedByUsername: data.username || 'سیستم',
        effectiveDate: today,
      });
    } catch {
      // Safe fallback
    }
  }

  /**
   * Creates a new piecework task
   */
  static async createTask(
    input: CreatePieceworkTaskInput,
    executor: DbExecutor = orm
  ): Promise<typeof pieceworkTasks.$inferSelect> {
    let taskCode = input.code ? String(input.code).trim() : '';
    if (!taskCode) {
      const countRes = await executor.select({ count: sql<number>`count(*)` }).from(pieceworkTasks);
      const nextId = Number(countRes[0]?.count || 0) + 1;
      taskCode = `PW-${String(nextId).padStart(3, '0')}`;
    }

    const [newTask] = await executor.insert(pieceworkTasks).values({
      code: taskCode,
      title: input.title.trim(),
      category: input.category ? String(input.category).trim() : 'سایر',
      defaultRate: Number(input.defaultRate) || 0,
      unit: input.unit ? String(input.unit).trim() : 'عدد',
      description: input.description ? String(input.description).trim() : '',
      isActive: 1,
      isDeleted: 0
    }).returning();

    await PieceworkService.recordTaskRateHistory({
      taskId: newTask.id,
      taskCode: newTask.code,
      taskTitle: newTask.title,
      oldRate: 0,
      newRate: Number(newTask.defaultRate) || 0,
      changeType: 'create',
      reason: 'تعریف اولیه عنوان کاری',
      userId: input.userId,
      username: input.username
    }, executor);

    return newTask;
  }

  /**
   * Updates an existing piecework task
   */
  static async updateTask(
    id: number,
    input: UpdatePieceworkTaskInput,
    executor: DbExecutor = orm
  ): Promise<{ previous: typeof pieceworkTasks.$inferSelect; current: typeof pieceworkTasks.$inferSelect }> {
    const [existing] = await executor.select().from(pieceworkTasks).where(and(eq(pieceworkTasks.id, id), eq(pieceworkTasks.isDeleted, 0)));
    if (!existing) {
      throw new NotFoundError('عنوان کاری یافت نشد');
    }

    const oldRate = Number(existing.defaultRate) || 0;
    const newRate = input.defaultRate !== undefined ? Number(input.defaultRate) : oldRate;
    const newTitle = input.title !== undefined ? String(input.title).trim() : existing.title;

    const [current] = await executor.update(pieceworkTasks).set({
      title: newTitle,
      category: input.category !== undefined ? String(input.category).trim() : existing.category,
      defaultRate: newRate,
      unit: input.unit !== undefined ? String(input.unit).trim() : existing.unit,
      description: input.description !== undefined ? String(input.description).trim() : existing.description,
      isActive: input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.isActive
    }).where(eq(pieceworkTasks.id, id)).returning();

    if (oldRate !== newRate) {
      await PieceworkService.recordTaskRateHistory({
        taskId: id,
        taskCode: existing.code,
        taskTitle: newTitle,
        oldRate,
        newRate,
        changeType: 'rate_change',
        reason: input.reason || `تغییر نرخ پایه از ${oldRate.toLocaleString()} به ${newRate.toLocaleString()}`,
        userId: input.userId,
        username: input.username
      }, executor);
    } else if (existing.title !== newTitle) {
      await PieceworkService.recordTaskRateHistory({
        taskId: id,
        taskCode: existing.code,
        taskTitle: newTitle,
        oldRate,
        newRate,
        changeType: 'title_change',
        reason: `تغییر عنوان از «${existing.title}» به «${newTitle}»`,
        userId: input.userId,
        username: input.username
      }, executor);
    }

    return { previous: existing, current: current || { ...existing, defaultRate: newRate, title: newTitle } };
  }

  /**
   * Soft deletes a piecework task
   */
  static async deleteTask(
    id: number,
    audit?: { userId?: number; username?: string },
    executor: DbExecutor = orm
  ): Promise<typeof pieceworkTasks.$inferSelect> {
    const [existing] = await executor.select().from(pieceworkTasks).where(and(eq(pieceworkTasks.id, id), eq(pieceworkTasks.isDeleted, 0)));
    if (!existing) {
      throw new NotFoundError('عنوان کاری یافت نشد');
    }

    await executor.update(pieceworkTasks).set({ isDeleted: 1 }).where(eq(pieceworkTasks.id, id));

    await PieceworkService.recordTaskRateHistory({
      taskId: id,
      taskCode: existing.code,
      taskTitle: existing.title,
      oldRate: Number(existing.defaultRate) || 0,
      newRate: Number(existing.defaultRate) || 0,
      changeType: 'archived',
      reason: 'حذف/بایگانی عنوان کاری',
      userId: audit?.userId,
      username: audit?.username
    }, executor);

    return existing;
  }

  /**
   * Logs piecework work entries with rate auto-resolution
   */
  static async logWorkEntries(
    items: CreatePieceworkLogInput[],
    executor: DbExecutor = orm
  ): Promise<number[]> {
    const insertedIds: number[] = [];

    for (const item of items) {
      const { personnelId, taskId, projectId, date, quantity, unitRate, notes, createdById, createdByUsername } = item;
      if (!personnelId || !taskId || !date || quantity === undefined) continue;

      let finalRate = Number(unitRate);
      if (isNaN(finalRate) || finalRate < 0) {
        const [custom] = await executor.select()
          .from(pieceworkPersonnelRates)
          .where(and(
            eq(pieceworkPersonnelRates.personnelId, Number(personnelId)),
            eq(pieceworkPersonnelRates.taskId, Number(taskId)),
            eq(pieceworkPersonnelRates.isDeleted, 0)
          ));

        if (custom) {
          finalRate = custom.customRate;
        } else {
          const [taskDef] = await executor.select()
            .from(pieceworkTasks)
            .where(eq(pieceworkTasks.id, Number(taskId)));
          finalRate = taskDef ? taskDef.defaultRate : 0;
        }
      }

      const qty = parseQuantityOrTime(quantity);
      const totalAmt = qty * finalRate;
      const normDate = normalizePersianDate(String(date));
      const isoDate = jalaliToIsoDate(normDate) || (normDate.includes('-') ? normDate.slice(0, 10) : new Date().toISOString().slice(0, 10));

      const [inserted] = await executor.insert(pieceworkLogs).values({
        personnelId: Number(personnelId),
        taskId: Number(taskId),
        projectId: projectId ? Number(projectId) : null,
        date: normDate,
        dateIso: isoDate,
        quantity: qty,
        unitRate: finalRate,
        totalAmount: totalAmt,
        notes: notes ? String(notes).trim() : '',
        status: 'pending',
        createdById: createdById || null,
        createdByUsername: createdByUsername || 'سیستم',
        isDeleted: 0
      }).returning({ id: pieceworkLogs.id });

      insertedIds.push(inserted.id);
    }

    return insertedIds;
  }

  /**
   * Imports piecework tasks from Excel rows
   */
  static async importTasksFromExcel(
    data: {
      rows: Array<Record<string, unknown>>;
      mode?: 'upsert' | 'replace' | 'append';
      userId?: number;
      username?: string;
    },
    executor: DbExecutor = orm
  ): Promise<{
    createdCount: number;
    updatedCount: number;
    totalProcessed: number;
  }> {
    const { rows, mode = 'upsert', userId, username } = data;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestError('لیست ردیف‌های واردات اکسل خالی است');
    }

    if (mode === 'replace') {
      await executor.update(pieceworkTasks).set({ isDeleted: 1 }).where(eq(pieceworkTasks.isDeleted, 0));
    }

    const existingTasks = await executor.select().from(pieceworkTasks).where(eq(pieceworkTasks.isDeleted, 0));
    const taskByCode = new Map(existingTasks.map(t => [t.code?.trim().toLowerCase(), t]));
    const taskByTitle = new Map(existingTasks.map(t => [t.title?.trim().toLowerCase(), t]));

    let createdCount = 0;
    let updatedCount = 0;
    const addedCategories = new Set<string>();

    let maxSeq = existingTasks.reduce((max, t) => {
      const m = t.code?.match(/PW-(\d+)/i);
      if (m) {
        const num = parseInt(m[1], 10);
        return num > max ? num : max;
      }
      return max;
    }, 0);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = String(row.title || row['عنوان'] || row['عنوان کار'] || row['عنوان کاری'] || '').trim();
      if (!title) continue;

      let code = String(row.code || row['کد'] || row['کد کار'] || row['کد کاری'] || '').trim();
      const category = String(row.category || row['دسته'] || row['دسته‌بندی'] || row['گروه'] || 'سایر').trim();
      const defaultRate = Number(row.defaultRate || row['نرخ'] || row['نرخ پایه'] || row['نرخ پیش‌فرض'] || row['دستمزد'] || 0) || 0;
      const unit = String(row.unit || row['واحد'] || row['واحد سنجش'] || 'عدد').trim();
      const description = String(row.description || row['توضیحات'] || '').trim();

      if (category && category !== 'سایر') {
        addedCategories.add(category);
      }

      if (!code) {
        maxSeq++;
        code = `PW-${String(maxSeq).padStart(3, '0')}`;
      }

      const existing = (code && taskByCode.get(code.toLowerCase())) || taskByTitle.get(title.toLowerCase());

      if (existing && mode !== 'append') {
        const oldRate = Number(existing.defaultRate) || 0;
        await executor.update(pieceworkTasks).set({
          title,
          category,
          defaultRate,
          unit,
          description: description || existing.description,
          isActive: 1,
          isDeleted: 0
        }).where(eq(pieceworkTasks.id, existing.id));
        updatedCount++;

        if (oldRate !== defaultRate || existing.title !== title) {
          await PieceworkService.recordTaskRateHistory({
            taskId: existing.id,
            taskCode: existing.code,
            taskTitle: title,
            oldRate,
            newRate: defaultRate,
            changeType: 'excel_import',
            reason: oldRate !== defaultRate ? `تغییر نرخ پایه از اکسل (${oldRate.toLocaleString()} -> ${defaultRate.toLocaleString()})` : 'به‌روزرسانی عنوان از اکسل',
            userId,
            username
          }, executor);
        }
      } else {
        const [inserted] = await executor.insert(pieceworkTasks).values({
          code,
          title,
          category,
          defaultRate,
          unit,
          description,
          isActive: 1,
          isDeleted: 0
        }).returning();
        createdCount++;
        if (code) taskByCode.set(code.toLowerCase(), inserted);
        taskByTitle.set(title.toLowerCase(), inserted);

        await PieceworkService.recordTaskRateHistory({
          taskId: inserted.id,
          taskCode: inserted.code,
          taskTitle: inserted.title,
          oldRate: 0,
          newRate: Number(inserted.defaultRate) || 0,
          changeType: 'excel_import',
          reason: 'ورود از فایل اکسل',
          userId,
          username
        }, executor);
      }
    }

    for (const catName of addedCategories) {
      try {
        await executor.insert(taskCategories).values({
          name: catName,
          description: 'دسته‌بندی کاری ایجادشده از طریق واردات اکسل'
        }).onConflictDoNothing();
      } catch (_) {}
    }

    return {
      createdCount,
      updatedCount,
      totalProcessed: createdCount + updatedCount
    };
  }

  /**
   * Soft deletes all piecework tasks
   */
  static async clearAllTasks(
    audit?: { userId?: number; username?: string },
    executor: DbExecutor = orm
  ): Promise<number> {
    const deleted = await executor.update(pieceworkTasks)
      .set({ isDeleted: 1 })
      .where(eq(pieceworkTasks.isDeleted, 0))
      .returning({ id: pieceworkTasks.id, title: pieceworkTasks.title, code: pieceworkTasks.code, defaultRate: pieceworkTasks.defaultRate });

    for (const d of deleted) {
      await PieceworkService.recordTaskRateHistory({
        taskId: d.id,
        taskCode: d.code,
        taskTitle: d.title,
        oldRate: Number(d.defaultRate) || 0,
        newRate: Number(d.defaultRate) || 0,
        changeType: 'archived',
        reason: 'پاکسازی کلی عناوین کاری',
        userId: audit?.userId,
        username: audit?.username
      }, executor);
    }

    return deleted.length;
  }

  /**
   * Restores an archived piecework task
   */
  static async restoreTask(
    id: number,
    audit?: { userId?: number; username?: string },
    executor: DbExecutor = orm
  ): Promise<typeof pieceworkTasks.$inferSelect> {
    const [existing] = await executor.select().from(pieceworkTasks).where(eq(pieceworkTasks.id, id));
    if (!existing) {
      throw new NotFoundError('عنوان کاری یافت نشد');
    }

    await executor.update(pieceworkTasks).set({ isDeleted: 0, isActive: 1 }).where(eq(pieceworkTasks.id, id));

    await PieceworkService.recordTaskRateHistory({
      taskId: id,
      taskCode: existing.code,
      taskTitle: existing.title,
      oldRate: Number(existing.defaultRate) || 0,
      newRate: Number(existing.defaultRate) || 0,
      changeType: 'restored',
      reason: 'بازیابی عنوان کاری از بایگانی',
      userId: audit?.userId,
      username: audit?.username
    }, executor);

    return existing;
  }

  /**
   * Creates a new task category or reactivates existing soft-deleted one
   */
  static async createCategory(
    data: { name: string; description?: string },
    executor: DbExecutor = orm
  ): Promise<typeof taskCategories.$inferSelect> {
    const catName = String(data.name).trim();
    if (!catName) {
      throw new BadRequestError('نام دسته‌بندی کاری الزامی است');
    }

    const [existing] = await executor.select().from(taskCategories).where(and(eq(taskCategories.name, catName), eq(taskCategories.isDeleted, 0)));
    if (existing) {
      throw new BadRequestError('این دسته‌بندی کاری قبلاً ثبت شده است');
    }

    const [deletedExisting] = await executor.select().from(taskCategories).where(and(eq(taskCategories.name, catName), eq(taskCategories.isDeleted, 1)));
    if (deletedExisting) {
      const [reactivated] = await executor.update(taskCategories).set({
        isDeleted: 0,
        description: data.description ? String(data.description).trim() : deletedExisting.description
      }).where(eq(taskCategories.id, deletedExisting.id)).returning();
      return reactivated;
    }

    const [newRow] = await executor.insert(taskCategories).values({
      name: catName,
      description: data.description ? String(data.description).trim() : ''
    }).returning();
    return newRow;
  }

  /**
   * Updates an existing task category and cascades name change to piecework tasks
   */
  static async updateCategory(
    idOrName: string | number,
    data: { name: string; description?: string },
    executor: DbExecutor = orm
  ): Promise<{ id: number | null; name: string }> {
    const newName = String(data.name).trim();
    if (!newName) {
      throw new BadRequestError('نام دسته‌بندی الزامی است');
    }

    let oldName = '';
    let targetId: number | null = null;

    if (!isNaN(Number(idOrName)) && Number(idOrName) > 0) {
      const numId = Number(idOrName);
      const [existing] = await executor.select().from(taskCategories).where(eq(taskCategories.id, numId));
      if (existing) {
        oldName = existing.name;
        targetId = existing.id;
        await executor.update(taskCategories).set({
          name: newName,
          description: data.description !== undefined ? String(data.description).trim() : existing.description
        }).where(eq(taskCategories.id, numId));
      }
    } else {
      oldName = decodeURIComponent(String(idOrName)).trim();
      const [existingByName] = await executor.select().from(taskCategories).where(eq(taskCategories.name, oldName));
      if (existingByName) {
        targetId = existingByName.id;
        await executor.update(taskCategories).set({
          name: newName,
          description: data.description !== undefined ? String(data.description).trim() : existingByName.description,
          isDeleted: 0
        }).where(eq(taskCategories.id, existingByName.id));
      } else {
        const [inserted] = await executor.insert(taskCategories).values({
          name: newName,
          description: data.description ? String(data.description).trim() : ''
        }).returning();
        targetId = inserted.id;
      }
    }

    if (oldName && oldName !== newName) {
      await executor.update(pieceworkTasks).set({ category: newName }).where(eq(pieceworkTasks.category, oldName));
    }

    return { id: targetId, name: newName };
  }

  /**
   * Soft deletes a task category
   */
  static async deleteCategory(
    idOrName: string | number,
    executor: DbExecutor = orm
  ): Promise<{ name: string }> {
    let deletedName = '';
    if (!isNaN(Number(idOrName)) && Number(idOrName) > 0) {
      const numId = Number(idOrName);
      const [existing] = await executor.select().from(taskCategories).where(eq(taskCategories.id, numId));
      if (existing) {
        deletedName = existing.name;
        await executor.update(taskCategories).set({ isDeleted: 1 }).where(eq(taskCategories.id, numId));
      }
    } else {
      deletedName = decodeURIComponent(String(idOrName)).trim();
      const [existing] = await executor.select().from(taskCategories).where(eq(taskCategories.name, deletedName));
      if (existing) {
        await executor.update(taskCategories).set({ isDeleted: 1 }).where(eq(taskCategories.id, existing.id));
      } else {
        await executor.insert(taskCategories).values({
          name: deletedName,
          description: '',
          isDeleted: 1
        }).onConflictDoNothing();
      }
    }
    return { name: deletedName || String(idOrName) };
  }

  /**
   * Sets or updates custom personnel piecework rate
   */
  static async setPersonnelRate(
    data: {
      personnelId: number | string;
      taskId: number | string;
      customRate: number | string;
    },
    executor: DbExecutor = orm
  ): Promise<void> {
    const pId = Number(data.personnelId);
    const tId = Number(data.taskId);
    const rate = Number(data.customRate);

    const [existing] = await executor.select()
      .from(pieceworkPersonnelRates)
      .where(and(
        eq(pieceworkPersonnelRates.personnelId, pId),
        eq(pieceworkPersonnelRates.taskId, tId),
        eq(pieceworkPersonnelRates.isDeleted, 0)
      ));

    if (existing) {
      await executor.update(pieceworkPersonnelRates)
        .set({ customRate: rate, updatedAt: sql`NOW()` })
        .where(eq(pieceworkPersonnelRates.id, existing.id));
    } else {
      await executor.insert(pieceworkPersonnelRates).values({
        personnelId: pId,
        taskId: tId,
        customRate: rate,
        isDeleted: 0
      });
    }
  }

  /**
   * Updates a piecework work log entry
   */
  static async updateWorkLog(
    id: number,
    data: {
      date?: string;
      quantity?: number | string;
      unitRate?: number | string;
      notes?: string;
      projectId?: number | string | null;
    },
    executor: DbExecutor = orm
  ): Promise<typeof pieceworkLogs.$inferSelect> {
    const [existing] = await executor.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.id, id), eq(pieceworkLogs.isDeleted, 0)));
    if (!existing) {
      throw new NotFoundError('ردیف کارکرد یافت نشد');
    }

    if (existing.status === 'paid' || existing.payrollId) {
      throw new BadRequestError('کارکردی که در فیش تسویه‌شده درج شده قابل تغییر نیست');
    }

    const newDate = data.date !== undefined ? String(data.date).trim() : existing.date;
    const normDate = normalizePersianDate(newDate);
    const isoDate = jalaliToIsoDate(normDate) || (normDate.includes('-') ? normDate.slice(0, 10) : existing.dateIso);
    const newQty = data.quantity !== undefined ? parseQuantityOrTime(data.quantity) : existing.quantity;
    const newRate = data.unitRate !== undefined ? Number(data.unitRate) : existing.unitRate;
    const newTotal = newQty * newRate;

    const [updated] = await executor.update(pieceworkLogs).set({
      date: normDate,
      dateIso: isoDate,
      quantity: newQty,
      unitRate: newRate,
      totalAmount: newTotal,
      projectId: data.projectId !== undefined ? (data.projectId ? Number(data.projectId) : null) : existing.projectId,
      notes: data.notes !== undefined ? String(data.notes).trim() : existing.notes
    }).where(eq(pieceworkLogs.id, id)).returning();

    return updated;
  }

  /**
   * Soft deletes a piecework work log
   */
  static async deleteWorkLog(
    id: number,
    executor: DbExecutor = orm
  ): Promise<typeof pieceworkLogs.$inferSelect> {
    const [existing] = await executor.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.id, id), eq(pieceworkLogs.isDeleted, 0)));
    if (!existing) {
      throw new NotFoundError('ردیف کارکرد یافت نشد');
    }

    if (existing.status === 'paid' || existing.payrollId) {
      throw new BadRequestError('امکان حذف کارکرد تسویه شده وجود ندارد');
    }

    await executor.update(pieceworkLogs).set({ isDeleted: 1 }).where(eq(pieceworkLogs.id, id));
    return existing;
  }
}

