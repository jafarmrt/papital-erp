import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { orm } from '../db/drizzle.js';
import { pieceworkTasks, pieceworkTaskRateHistory, pieceworkPersonnelRates, pieceworkLogs, pieceworkPayrolls, personnel, users, taskCategories, productionProjects, journalVouchers } from '../db/schema.js';
import { eq, and, desc, like, or, sql, inArray } from 'drizzle-orm';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { normalizePersianDate, parseQuantityOrTime, jalaliToIsoDate } from '../utils.js';
import { VoucherSyncService } from '../services/accounting/voucherSync.service.js';
import { PayrollPaymentService } from '../services/accounting/payrollPayment.service.js';
import { ConflictError, BusinessLogicError, ValidationError, NotFoundError } from '../errors/customErrors.js';
import { fin, FinancialMath } from '../lib/financialDecimal.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';

const router = Router();

router.use(authenticateToken);

const createPieceworkTaskSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    title: z.string().min(1, 'عنوان کاری پرکیسی الزامی است'),
    category: z.string().optional(),
    defaultRate: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
  })
});

const updatePieceworkTaskSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان کاری پرکیسی الزامی است').optional(),
    category: z.string().optional(),
    defaultRate: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  params: z.object({
    id: numericIdString
  })
});

const createTaskCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'نام دسته‌بندی کاری الزامی است'),
    description: z.string().optional(),
  })
});

const updateTaskCategorySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'نام دسته‌بندی الزامی است'),
    description: z.string().optional(),
  })
});

const paramsPersonnelIdSchema = z.object({
  params: z.object({
    personnelId: numericIdString
  })
});

const setPersonnelRateSchema = z.object({
  body: z.object({
    personnelId: z.union([z.number(), z.string()]),
    taskId: z.union([z.number(), z.string()]),
    customRate: z.union([z.number(), z.string()]),
  })
});

const pieceworkLogItemSchema = z.object({
  personnelId: z.union([z.number(), z.string()]),
  taskId: z.union([z.number(), z.string()]),
  projectId: z.union([z.number(), z.string(), z.null()]).optional(),
  date: z.string().min(1, 'تاریخ کارکرد الزامی است'),
  quantity: z.union([z.number(), z.string()]),
  unitRate: z.union([z.number(), z.string()]).optional(),
  notes: z.string().optional(),
});

const createPieceworkLogsSchema = z.object({
  body: z.union([
    z.object({
      items: z.array(pieceworkLogItemSchema).min(1, 'حداقل یک ردیف کارکرد الزامی است')
    }),
    pieceworkLogItemSchema
  ])
});

const updatePieceworkLogSchema = z.object({
  body: z.object({
    date: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    unitRate: z.union([z.number(), z.string()]).optional(),
    notes: z.string().optional(),
    projectId: z.union([z.number(), z.string(), z.null()]).optional(),
  }),
  params: z.object({
    id: numericIdString
  })
});

const generatePieceworkPayrollSchema = z.object({
  body: z.object({
    personnelId: z.union([z.number(), z.string()]),
    startDate: z.string().min(1, 'تاریخ شروع الزامی است'),
    endDate: z.string().min(1, 'تاریخ پایان الزامی است'),
    title: z.string().optional(),
    bonuses: z.union([z.number(), z.string()]).optional(),
    totalBonuses: z.union([z.number(), z.string()]).optional(),
    deductions: z.union([z.number(), z.string()]).optional(),
    totalDeductions: z.union([z.number(), z.string()]).optional(),
    advanceDeduction: z.union([z.number(), z.string()]).optional(),
    notes: z.string().optional(),
  })
});

const updatePieceworkPayrollStatusSchema = z.object({
  body: z.object({
    status: z.string().optional(),
    paymentDate: z.string().optional(),
    paymentMethod: z.string().optional(),
    paymentReference: z.string().optional(),
    notes: z.string().optional(),
  }),
  params: z.object({
    id: numericIdString
  })
});

// V10-4.4: ثبت پرداخت حقوق — فقط از مسیر خزانه‌داری
const registerPayrollPaymentSchema = z.object({
  body: z.object({
    bankAccountId: z.union([z.number(), z.string()]),
    method: z.enum(['cash', 'bank_transfer', 'pos', 'cheque']).optional().default('bank_transfer'),
    amount: z.union([z.number(), z.string()]).optional(),
    paymentDate: z.string().optional(),
    paymentReference: z.string().optional(),
    notes: z.string().optional()
  }),
  params: z.object({
    id: numericIdString
  })
});

// ==========================================
// 1. Piecework Tasks (عناوین کاری پرکیسی)
// ==========================================

// Helper to record rate change history
async function recordTaskRateHistory(data: {
  taskId: number;
  taskCode?: string;
  taskTitle?: string;
  oldRate?: number;
  newRate: number;
  changeType: 'create' | 'rate_change' | 'excel_import' | 'title_change' | 'archived' | 'restored';
  reason?: string;
  userId?: number;
  username?: string;
}) {
  try {
    const today = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    await orm.insert(pieceworkTaskRateHistory).values({
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
  } catch (err) {
    logger.warn({ message: 'Failed to record piecework rate history', error: err });
  }
}

// GET /api/piecework/tasks - List tasks (active, archived, or all)
router.get('/piecework/tasks', async (req, res) => {
  try {
    const { category, search, status = 'active' } = req.query;
    
    let whereClause = eq(pieceworkTasks.isDeleted, 0);
    if (status === 'archived') {
      whereClause = eq(pieceworkTasks.isDeleted, 1);
    } else if (status === 'all') {
      whereClause = sql`1=1` as any;
    }

    let query = orm.select()
      .from(pieceworkTasks)
      .where(whereClause)
      .orderBy(pieceworkTasks.category, pieceworkTasks.id);

    const tasks = await query;

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

    res.json(filtered);
  } catch (err) {
    logger.error({ message: 'Error fetching piecework tasks', error: err });
    throw err;
  }
});

// GET /api/piecework/tasks-history - Get global rate change history
router.get('/piecework/tasks-history', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const history = await orm.select()
      .from(pieceworkTaskRateHistory)
      .orderBy(desc(pieceworkTaskRateHistory.id))
      .limit(limit);
    res.json(history);
  } catch (err) {
    logger.error({ message: 'Error fetching global piecework task rate history', error: err });
    throw err;
  }
});

// GET /api/piecework/tasks/:id/history - Get rate change history for specific task
router.get('/piecework/tasks/:id/history', validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const history = await orm.select()
      .from(pieceworkTaskRateHistory)
      .where(eq(pieceworkTaskRateHistory.taskId, id))
      .orderBy(desc(pieceworkTaskRateHistory.id));
    res.json(history);
  } catch (err) {
    logger.error({ message: 'Error fetching piecework task rate history', error: err });
    throw err;
  }
});

// POST /api/piecework/tasks - Create new task
router.post('/piecework/tasks', authorize('personnel.manage', 'admin'), validate(createPieceworkTaskSchema), async (req, res) => {
  try {
    const { code, title, category, defaultRate, unit, description } = req.body;

    let taskCode = code ? String(code).trim() : '';
    if (!taskCode) {
      const countRes = await orm.select({ count: sql<number>`count(*)` }).from(pieceworkTasks);
      const nextId = Number(countRes[0]?.count || 0) + 1;
      taskCode = `PW-${String(nextId).padStart(3, '0')}`;
    }

    const [newTask] = await orm.insert(pieceworkTasks).values({
      code: taskCode,
      title: title.trim(),
      category: category ? String(category).trim() : 'سایر',
      defaultRate: Number(defaultRate) || 0,
      unit: unit ? String(unit).trim() : 'عدد',
      description: description ? String(description).trim() : '',
      isActive: 1,
      isDeleted: 0
    }).returning();

    await recordTaskRateHistory({
      taskId: newTask.id,
      taskCode: newTask.code,
      taskTitle: newTask.title,
      oldRate: 0,
      newRate: Number(newTask.defaultRate) || 0,
      changeType: 'create',
      reason: 'تعریف اولیه عنوان کاری',
      userId: req.user?.id,
      username: req.user?.username
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'عنوان پرکیسی',
      entityId: newTask.id,
      description: `تعریف عنوان کاری پرکیسی جدید «${newTask.title}» با کد «${newTask.code}»`
    });

    res.status(201).json(newTask);
  } catch (err) {
    logger.error({ message: 'Error creating piecework task', error: err });
    throw err;
  }
});

// POST /api/piecework/tasks/import-excel - Bulk import piecework tasks
router.post('/piecework/tasks/import-excel', authorize('personnel.manage', 'admin'), async (req, res) => {
  try {
    const { rows, mode = 'upsert' } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'لیست ردیف‌های واردات اکسل خالی است' });
    }

    if (mode === 'replace') {
      await orm.update(pieceworkTasks).set({ isDeleted: 1 }).where(eq(pieceworkTasks.isDeleted, 0));
    }

    const existingTasks = await orm.select().from(pieceworkTasks).where(eq(pieceworkTasks.isDeleted, 0));
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
        await orm.update(pieceworkTasks).set({
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
          await recordTaskRateHistory({
            taskId: existing.id,
            taskCode: existing.code,
            taskTitle: title,
            oldRate,
            newRate: defaultRate,
            changeType: 'excel_import',
            reason: oldRate !== defaultRate ? `تغییر نرخ پایه از اکسل (${oldRate.toLocaleString()} -> ${defaultRate.toLocaleString()})` : 'به‌روزرسانی عنوان از اکسل',
            userId: req.user?.id,
            username: req.user?.username
          });
        }
      } else {
        const [inserted] = await orm.insert(pieceworkTasks).values({
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

        await recordTaskRateHistory({
          taskId: inserted.id,
          taskCode: inserted.code,
          taskTitle: inserted.title,
          oldRate: 0,
          newRate: Number(inserted.defaultRate) || 0,
          changeType: 'excel_import',
          reason: 'ورود از فایل اکسل',
          userId: req.user?.id,
          username: req.user?.username
        });
      }
    }

    // Auto-create missing task categories
    for (const catName of addedCategories) {
      try {
        await orm.insert(taskCategories).values({
          name: catName,
          description: 'دسته‌بندی کاری ایجادشده از طریق واردات اکسل'
        }).onConflictDoNothing();
      } catch (_) {}
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'IMPORT',
      entity: 'عناوین پرکیسی',
      description: `واردات اکسل عناوین کاری پرکیسی (${createdCount} عنوان جدید، ${updatedCount} عنوان ویرایش‌شده، شیوه: ${mode})`
    });

    res.json({
      status: 'ok',
      message: `عملیات واردات با موفقیت انجام شد: ${createdCount} عنوان جدید ایجاد و ${updatedCount} عنوان به‌روزرسانی شدند.`,
      createdCount,
      updatedCount,
      totalProcessed: createdCount + updatedCount
    });
  } catch (err) {
    logger.error({ message: 'Error importing piecework tasks from excel', error: err });
    throw err;
  }
});

// POST /api/piecework/tasks/clear-defaults or clear-all
router.post(['/piecework/tasks/clear-defaults', '/piecework/tasks/clear-all'], authorize('personnel.manage', 'admin'), async (req, res) => {
  try {
    const deleted = await orm.update(pieceworkTasks)
      .set({ isDeleted: 1 })
      .where(eq(pieceworkTasks.isDeleted, 0))
      .returning({ id: pieceworkTasks.id, title: pieceworkTasks.title, code: pieceworkTasks.code, defaultRate: pieceworkTasks.defaultRate });

    for (const d of deleted) {
      await recordTaskRateHistory({
        taskId: d.id,
        taskCode: d.code,
        taskTitle: d.title,
        oldRate: Number(d.defaultRate) || 0,
        newRate: Number(d.defaultRate) || 0,
        changeType: 'archived',
        reason: 'پاکسازی کلی عناوین کاری',
        userId: req.user?.id,
        username: req.user?.username
      });
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'عناوین پرکیسی',
      description: `پاکسازی کلی عناوین کاری پرکیسی (${deleted.length} مورد حذف شدند)`
    });

    res.json({
      status: 'ok',
      message: `تمام عناوین کاری (${deleted.length} مورد) با موفقیت حذف شدند.`,
      count: deleted.length
    });
  } catch (err) {
    logger.error({ message: 'Error clearing all piecework tasks', error: err });
    throw err;
  }
});

// PUT /api/piecework/tasks/:id - Update task
router.put('/piecework/tasks/:id', authorize('personnel.manage', 'admin'), validate(updatePieceworkTaskSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { title, category, defaultRate, unit, description, isActive } = req.body;

    const [existing] = await orm.select().from(pieceworkTasks).where(and(eq(pieceworkTasks.id, id), eq(pieceworkTasks.isDeleted, 0)));
    if (!existing) {
      return res.status(404).json({ error: 'عنوان کاری یافت نشد' });
    }

    const oldRate = Number(existing.defaultRate) || 0;
    const newRate = defaultRate !== undefined ? Number(defaultRate) : oldRate;
    const newTitle = title !== undefined ? String(title).trim() : existing.title;

    await orm.update(pieceworkTasks).set({
      title: newTitle,
      category: category !== undefined ? String(category).trim() : existing.category,
      defaultRate: newRate,
      unit: unit !== undefined ? String(unit).trim() : existing.unit,
      description: description !== undefined ? String(description).trim() : existing.description,
      isActive: isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive
    }).where(eq(pieceworkTasks.id, id));

    if (oldRate !== newRate) {
      await recordTaskRateHistory({
        taskId: id,
        taskCode: existing.code,
        taskTitle: newTitle,
        oldRate,
        newRate,
        changeType: 'rate_change',
        reason: req.body.reason || `تغییر نرخ پایه از ${oldRate.toLocaleString()} به ${newRate.toLocaleString()}`,
        userId: req.user?.id,
        username: req.user?.username
      });
    } else if (existing.title !== newTitle) {
      await recordTaskRateHistory({
        taskId: id,
        taskCode: existing.code,
        taskTitle: newTitle,
        oldRate,
        newRate,
        changeType: 'title_change',
        reason: `تغییر عنوان از «${existing.title}» به «${newTitle}»`,
        userId: req.user?.id,
        username: req.user?.username
      });
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'عنوان پرکیسی',
      entityId: id,
      description: `ویرایش عنوان کاری پرکیسی «${existing.title}»`
    });

    res.json({ status: 'ok', message: 'عنوان کاری با موفقیت به‌روزرسانی شد' });
  } catch (err) {
    logger.error({ message: 'Error updating piecework task', error: err });
    throw err;
  }
});

// DELETE /api/piecework/tasks/:id
router.delete('/piecework/tasks/:id', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await orm.select().from(pieceworkTasks).where(and(eq(pieceworkTasks.id, id), eq(pieceworkTasks.isDeleted, 0)));
    if (!existing) {
      return res.status(404).json({ error: 'عنوان کاری یافت نشد' });
    }

    await orm.update(pieceworkTasks).set({ isDeleted: 1 }).where(eq(pieceworkTasks.id, id));

    await recordTaskRateHistory({
      taskId: id,
      taskCode: existing.code,
      taskTitle: existing.title,
      oldRate: Number(existing.defaultRate) || 0,
      newRate: Number(existing.defaultRate) || 0,
      changeType: 'archived',
      reason: 'حذف/بایگانی عنوان کاری',
      userId: req.user?.id,
      username: req.user?.username
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'عنوان پرکیسی',
      entityId: id,
      description: `حذف عنوان کاری پرکیسی «${existing.title}»`
    });

    res.json({ status: 'ok', message: 'عنوان کاری حذف شد' });
  } catch (err) {
    logger.error({ message: 'Error deleting piecework task', error: err });
    throw err;
  }
});

// POST /api/piecework/tasks/:id/restore - Restore an archived/deleted task
router.post('/piecework/tasks/:id/restore', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await orm.select().from(pieceworkTasks).where(eq(pieceworkTasks.id, id));
    if (!existing) {
      return res.status(404).json({ error: 'عنوان کاری یافت نشد' });
    }

    await orm.update(pieceworkTasks).set({ isDeleted: 0, isActive: 1 }).where(eq(pieceworkTasks.id, id));

    await recordTaskRateHistory({
      taskId: id,
      taskCode: existing.code,
      taskTitle: existing.title,
      oldRate: Number(existing.defaultRate) || 0,
      newRate: Number(existing.defaultRate) || 0,
      changeType: 'restored',
      reason: 'بازیابی عنوان کاری از بایگانی',
      userId: req.user?.id,
      username: req.user?.username
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'عنوان پرکیسی',
      entityId: id,
      description: `بازیابی عنوان کاری پرکیسی «${existing.title}» از بایگانی`
    });

    res.json({ status: 'ok', message: 'عنوان کاری با موفقیت بازیابی شد' });
  } catch (err) {
    logger.error({ message: 'Error restoring piecework task', error: err });
    throw err;
  }
});

// ==========================================
// 1.5. Task Categories (دسته‌بندی‌های عناوین کاری)
// ==========================================

// GET /api/piecework/categories
router.get('/piecework/categories', async (req, res) => {
  try {
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

    const resultList = Array.from(catMap.values());
    res.json(resultList);
  } catch (err) {
    logger.error({ message: 'Error fetching task categories', error: err });
    // V9-2.1: هدایت خطا به errorHandler سراسری با traceId
    throw err;
  }
});

// POST /api/piecework/categories
router.post('/piecework/categories', authorize('personnel.manage', 'admin', 'settings.manage'), validate(createTaskCategorySchema), async (req, res) => {
  try {
    const { name, description } = req.body;
    const catName = String(name).trim();

    // Check if category already exists (active)
    const [existing] = await orm.select().from(taskCategories).where(and(eq(taskCategories.name, catName), eq(taskCategories.isDeleted, 0)));
    if (existing) {
      return res.status(400).json({ error: 'این دسته‌بندی کاری قبلاً ثبت شده است' });
    }

    // If it was soft-deleted, reactivate it
    const [deletedExisting] = await orm.select().from(taskCategories).where(and(eq(taskCategories.name, catName), eq(taskCategories.isDeleted, 1)));
    let inserted;
    if (deletedExisting) {
      const [reactivated] = await orm.update(taskCategories).set({
        isDeleted: 0,
        description: description ? String(description).trim() : deletedExisting.description
      }).where(eq(taskCategories.id, deletedExisting.id)).returning();
      inserted = reactivated;
    } else {
      const [newRow] = await orm.insert(taskCategories).values({
        name: catName,
        description: description ? String(description).trim() : ''
      }).returning();
      inserted = newRow;
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'دسته‌بندی کاری',
      entityId: inserted.id,
      description: `تعریف دسته‌بندی کاری جدید «${catName}»`
    });

    res.status(201).json(inserted);
  } catch (err) {
    logger.error({ message: 'Error creating task category', error: err });
    // V9-2.1: هدایت خطا به errorHandler سراسری با traceId
    throw err;
  }
});

// PUT /api/piecework/categories/:id
router.put('/piecework/categories/:id', authorize('personnel.manage', 'admin', 'settings.manage'), validate(updateTaskCategorySchema), async (req, res) => {
  try {
    const rawId = req.params.id;
    const { name, description } = req.body;
    const newName = String(name).trim();

    let oldName = '';
    let targetId: number | null = null;

    if (!isNaN(Number(rawId)) && Number(rawId) > 0) {
      // It's a numeric ID
      const numId = Number(rawId);
      const [existing] = await orm.select().from(taskCategories).where(eq(taskCategories.id, numId));
      if (existing) {
        oldName = existing.name;
        targetId = existing.id;
        await orm.update(taskCategories).set({
          name: newName,
          description: description !== undefined ? String(description).trim() : existing.description
        }).where(eq(taskCategories.id, numId));
      }
    } else {
      // It's a string name (e.g. from existing tasks or legacy default)
      oldName = decodeURIComponent(String(rawId)).trim();
      // Check if a row with this name already exists in DB
      const [existingByName] = await orm.select().from(taskCategories).where(eq(taskCategories.name, oldName));
      if (existingByName) {
        targetId = existingByName.id;
        await orm.update(taskCategories).set({
          name: newName,
          description: description !== undefined ? String(description).trim() : existingByName.description,
          isDeleted: 0
        }).where(eq(taskCategories.id, existingByName.id));
      } else {
        const [inserted] = await orm.insert(taskCategories).values({
          name: newName,
          description: description ? String(description).trim() : ''
        }).returning();
        targetId = inserted.id;
      }
    }

    // If the category name was changed, cascade update all tasks using the old category name
    if (oldName && oldName !== newName) {
      await orm.update(pieceworkTasks).set({ category: newName }).where(eq(pieceworkTasks.category, oldName));
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'دسته‌بندی کاری',
      entityId: targetId || 0,
      description: `ویرایش دسته‌بندی کاری «${oldName || newName}» به «${newName}»`
    });

    res.json({ status: 'ok', id: targetId, name: newName });
  } catch (err) {
    logger.error({ message: 'Error updating task category', error: err });
    // V9-2.1: هدایت خطا به errorHandler سراسری با traceId
    throw err;
  }
});

// DELETE /api/piecework/categories/:id
router.delete('/piecework/categories/:id', authorize('personnel.manage', 'admin', 'settings.manage'), async (req, res) => {
  try {
    const rawId = req.params.id;
    let deletedName = '';

    if (!isNaN(Number(rawId)) && Number(rawId) > 0) {
      const numId = Number(rawId);
      const [existing] = await orm.select().from(taskCategories).where(eq(taskCategories.id, numId));
      if (existing) {
        deletedName = existing.name;
        await orm.update(taskCategories).set({ isDeleted: 1 }).where(eq(taskCategories.id, numId));
      }
    } else {
      // String ID (e.g. from existing task category or legacy default)
      deletedName = decodeURIComponent(String(rawId)).trim();
      const [existing] = await orm.select().from(taskCategories).where(eq(taskCategories.name, deletedName));
      if (existing) {
        await orm.update(taskCategories).set({ isDeleted: 1 }).where(eq(taskCategories.id, existing.id));
      } else {
        // Insert as soft-deleted record so it doesn't reappear
        await orm.insert(taskCategories).values({
          name: deletedName,
          description: '',
          isDeleted: 1
        }).onConflictDoNothing();
      }
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'دسته‌بندی کاری',
      description: `حذف دسته‌بندی کاری «${deletedName || rawId}»`
    });

    res.json({ status: 'ok', message: `دسته‌بندی «${deletedName || rawId}» با موفقیت حذف شد` });
  } catch (err) {
    logger.error({ message: 'Error deleting task category', error: err });
    // V9-2.1: هدایت خطا به errorHandler سراسری با traceId
    throw err;
  }
});

// ==========================================
// 2. Custom Personnel Rates (نرخ‌های اختصاصی)
// ==========================================

// GET /api/piecework/personnel-rates/:personnelId
router.get(['/piecework/personnel-rates/:personnelId', '/piecework/rates/:personnelId'], validate(paramsPersonnelIdSchema), async (req, res) => {
  try {
    const personnelId = Number(req.params.personnelId);
    const rates = await orm.select()
      .from(pieceworkPersonnelRates)
      .where(and(eq(pieceworkPersonnelRates.personnelId, personnelId), eq(pieceworkPersonnelRates.isDeleted, 0)));
    
    res.json(rates);
  } catch (err) {
    logger.error({ message: 'Error fetching custom rates', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/piecework/personnel-rates - Set or update custom rate
router.post(['/piecework/personnel-rates', '/piecework/rates'], authorize('personnel.manage', 'admin'), validate(setPersonnelRateSchema), async (req, res) => {
  try {
    const { personnelId, taskId, customRate } = req.body;

    const [existing] = await orm.select()
      .from(pieceworkPersonnelRates)
      .where(and(
        eq(pieceworkPersonnelRates.personnelId, Number(personnelId)),
        eq(pieceworkPersonnelRates.taskId, Number(taskId)),
        eq(pieceworkPersonnelRates.isDeleted, 0)
      ));

    if (existing) {
      await orm.update(pieceworkPersonnelRates)
        .set({ customRate: Number(customRate), updatedAt: sql`NOW()` })
        .where(eq(pieceworkPersonnelRates.id, existing.id));
    } else {
      await orm.insert(pieceworkPersonnelRates).values({
        personnelId: Number(personnelId),
        taskId: Number(taskId),
        customRate: Number(customRate),
        isDeleted: 0
      });
    }

    res.json({ status: 'ok', message: 'نرخ اختصاصی ثبت شد' });
  } catch (err) {
    logger.error({ message: 'Error setting custom rate', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// ==========================================
// 3. Piecework Logs (کارکرد روزانه پرکیسی)
// ==========================================

// GET /api/piecework/logs - List work logs
router.get('/piecework/logs', async (req, res) => {
  try {
    const { personnelId, projectId, startDate, endDate, status } = req.query;

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

    if (startDate && String(startDate).trim()) {
      const sRaw = String(startDate).trim();
      const sPersian = normalizePersianDate(sRaw);
      const sIso = jalaliToIsoDate(sRaw) || sRaw;
      rows = rows.filter(r => (r.dateIso && r.dateIso >= sIso) || normalizePersianDate(r.date) >= sPersian);
    }

    if (endDate && String(endDate).trim()) {
      const eRaw = String(endDate).trim();
      const ePersian = normalizePersianDate(eRaw);
      const eIso = jalaliToIsoDate(eRaw) || eRaw;
      rows = rows.filter(r => (r.dateIso && r.dateIso <= eIso) || normalizePersianDate(r.date) <= ePersian);
    }

    if (status && String(status) !== 'ALL') {
      rows = rows.filter(r => r.status === String(status));
    }

    res.json(rows);
  } catch (err) {
    logger.error({ message: 'Error fetching piecework logs', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/piecework/logs - Record work logs (Supports single or batch array)
router.post('/piecework/logs', authorize('personnel.manage', 'daily_logs.create', 'admin'), validate(createPieceworkLogsSchema), async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';

    const items = Array.isArray(req.body.items) ? req.body.items : [req.body];

    if (items.length === 0) {
      return res.status(400).json({ error: 'حداقل یک ردیف کارکرد انتخاب کنید' });
    }

    const insertedIds = [];

    for (const item of items) {
      const { personnelId, taskId, projectId, date, quantity, unitRate, notes } = item;

      if (!personnelId || !taskId || !date || quantity === undefined) {
        continue;
      }

      let finalRate = Number(unitRate);
      if (isNaN(finalRate) || finalRate < 0) {
        // Look up custom personnel rate or default task rate
        const [custom] = await orm.select()
          .from(pieceworkPersonnelRates)
          .where(and(
            eq(pieceworkPersonnelRates.personnelId, Number(personnelId)),
            eq(pieceworkPersonnelRates.taskId, Number(taskId)),
            eq(pieceworkPersonnelRates.isDeleted, 0)
          ));

        if (custom) {
          finalRate = custom.customRate;
        } else {
          const [taskDef] = await orm.select()
            .from(pieceworkTasks)
            .where(eq(pieceworkTasks.id, Number(taskId)));
          finalRate = taskDef ? taskDef.defaultRate : 0;
        }
      }

      const qty = parseQuantityOrTime(quantity);
      const totalAmt = qty * finalRate;
      const normDate = normalizePersianDate(String(date));
      const isoDate = jalaliToIsoDate(normDate) || (normDate.includes('-') ? normDate.slice(0, 10) : new Date().toISOString().slice(0, 10));

      const [inserted] = await orm.insert(pieceworkLogs).values({
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
        createdById: currentUserId,
        createdByUsername: currentUsername,
        isDeleted: 0
      }).returning();

      insertedIds.push(inserted.id);
    }

    await logActivity({
      userId: currentUserId,
      username: currentUsername,
      action: 'CREATE',
      entity: 'کارکرد پرکیسی',
      description: `ثبت ${insertedIds.length} ردیف کارکرد پرکیسی جدید`
    });

    res.status(201).json({ status: 'ok', insertedCount: insertedIds.length });
  } catch (err) {
    logger.error({ message: 'Error logging piecework', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/piecework/logs/batch - Alias for legacy batch logging
router.post('/piecework/logs/batch', authorize('personnel.manage', 'daily_logs.create', 'admin'), async (req, res, next) => {
  if (Array.isArray(req.body.logs) && !req.body.items) {
    req.body.items = req.body.logs;
  }
  next();
}, validate(createPieceworkLogsSchema), async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';

    const items = Array.isArray(req.body.items) ? req.body.items : (Array.isArray(req.body.logs) ? req.body.logs : [req.body]);

    if (items.length === 0) {
      return res.status(400).json({ error: 'حداقل یک ردیف کارکرد انتخاب کنید' });
    }

    const insertedIds = [];

    for (const item of items) {
      const { personnelId, taskId, projectId, date, quantity, unitRate, notes } = item;

      if (!personnelId || !taskId || !date || quantity === undefined) {
        continue;
      }

      let finalRate = Number(unitRate);
      if (isNaN(finalRate) || finalRate < 0) {
        const [custom] = await orm.select()
          .from(pieceworkPersonnelRates)
          .where(and(
            eq(pieceworkPersonnelRates.personnelId, Number(personnelId)),
            eq(pieceworkPersonnelRates.taskId, Number(taskId)),
            eq(pieceworkPersonnelRates.isDeleted, 0)
          ));

        if (custom) {
          finalRate = custom.customRate;
        } else {
          const [taskDef] = await orm.select()
            .from(pieceworkTasks)
            .where(eq(pieceworkTasks.id, Number(taskId)));
          finalRate = taskDef ? taskDef.defaultRate : 0;
        }
      }

      const qty = parseQuantityOrTime(quantity);
      const totalAmt = qty * finalRate;
      const normDate = normalizePersianDate(String(date));
      const isoDate = jalaliToIsoDate(normDate) || (normDate.includes('-') ? normDate.slice(0, 10) : new Date().toISOString().slice(0, 10));

      const [inserted] = await orm.insert(pieceworkLogs).values({
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
        createdById: currentUserId,
        createdByUsername: currentUsername,
        isDeleted: 0
      }).returning();

      insertedIds.push(inserted.id);
    }

    await logActivity({
      userId: currentUserId,
      username: currentUsername,
      action: 'CREATE',
      entity: 'کارکرد پرکیسی',
      description: `ثبت ${insertedIds.length} ردیف کارکرد پرکیسی جدید`
    });

    res.status(201).json({ status: 'ok', insertedCount: insertedIds.length });
  } catch (err) {
    logger.error({ message: 'Error logging piecework batch', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// PUT /api/piecework/logs/:id - Update work log
router.put('/piecework/logs/:id', authorize('personnel.manage', 'admin'), validate(updatePieceworkLogSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { date, quantity, unitRate, notes, projectId } = req.body;

    const [existing] = await orm.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.id, id), eq(pieceworkLogs.isDeleted, 0)));
    if (!existing) {
      return res.status(404).json({ error: 'ردیف کارکرد یافت نشد' });
    }

    if (existing.status === 'paid' || existing.payrollId) {
      return res.status(400).json({ error: 'کارکردی که در فیش تسویه‌شده درج شده قابل تغییر نیست' });
    }

    const newDate = date !== undefined ? String(date).trim() : existing.date;
    const normDate = normalizePersianDate(newDate);
    const isoDate = jalaliToIsoDate(normDate) || (normDate.includes('-') ? normDate.slice(0, 10) : existing.dateIso);
    const newQty = quantity !== undefined ? parseQuantityOrTime(quantity) : existing.quantity;
    const newRate = unitRate !== undefined ? Number(unitRate) : existing.unitRate;
    const newTotal = newQty * newRate;

    await orm.update(pieceworkLogs).set({
      date: normDate,
      dateIso: isoDate,
      quantity: newQty,
      unitRate: newRate,
      totalAmount: newTotal,
      projectId: projectId !== undefined ? (projectId ? Number(projectId) : null) : existing.projectId,
      notes: notes !== undefined ? String(notes).trim() : existing.notes
    }).where(eq(pieceworkLogs.id, id));

    res.json({ status: 'ok', message: 'کارکرد ویرایش شد' });
  } catch (err) {
    logger.error({ message: 'Error updating piecework log', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// DELETE /api/piecework/logs/:id - Delete work log
router.delete('/piecework/logs/:id', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await orm.select().from(pieceworkLogs).where(and(eq(pieceworkLogs.id, id), eq(pieceworkLogs.isDeleted, 0)));
    if (!existing) {
      return res.status(404).json({ error: 'ردیف کارکرد یافت نشد' });
    }

    if (existing.status === 'paid' || existing.payrollId) {
      return res.status(400).json({ error: 'امکان حذف کارکرد تسویه شده وجود ندارد' });
    }

    await orm.update(pieceworkLogs).set({ isDeleted: 1 }).where(eq(pieceworkLogs.id, id));

    res.json({ status: 'ok', message: 'کارکرد حذف شد' });
  } catch (err) {
    logger.error({ message: 'Error deleting piecework log', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// ==========================================
// 4. Payrolls & Payslips (فیش‌های حقوقی و تسویه)
// ==========================================

// GET /api/piecework/payrolls - List payrolls
router.get('/piecework/payrolls', async (req, res) => {
  try {
    const { personnelId, status } = req.query;

    let rows = await orm.select({
      id: pieceworkPayrolls.id,
      payrollNumber: pieceworkPayrolls.payrollNumber,
      personnelId: pieceworkPayrolls.personnelId,
      personnelName: personnel.fullName,
      personnelCode: personnel.personnelCode,
      jobTitle: personnel.jobTitle,
      cardNumber: personnel.cardNumber,
      shebaNumber: personnel.shebaNumber,
      bankName: personnel.bankName,
      startDate: pieceworkPayrolls.startDate,
      endDate: pieceworkPayrolls.endDate,
      title: pieceworkPayrolls.title,
      totalPieceworkAmount: pieceworkPayrolls.totalPieceworkAmount,
      totalFixedAmount: pieceworkPayrolls.totalFixedAmount,
      advanceDeduction: pieceworkPayrolls.advanceDeduction,
      totalBonuses: pieceworkPayrolls.totalBonuses,
      totalDeductions: pieceworkPayrolls.totalDeductions,
      netPayable: pieceworkPayrolls.netPayable,
      status: pieceworkPayrolls.status,
      paymentDate: pieceworkPayrolls.paymentDate,
      paymentMethod: pieceworkPayrolls.paymentMethod,
      paymentReference: pieceworkPayrolls.paymentReference,
      notes: pieceworkPayrolls.notes,
      createdAt: pieceworkPayrolls.createdAt
    })
    .from(pieceworkPayrolls)
    .innerJoin(personnel, eq(pieceworkPayrolls.personnelId, personnel.id))
    .where(eq(pieceworkPayrolls.isDeleted, 0))
    .orderBy(desc(pieceworkPayrolls.id));

    if (personnelId && String(personnelId) !== 'ALL') {
      const pId = Number(personnelId);
      rows = rows.filter(r => r.personnelId === pId);
    }

    if (status && String(status) !== 'ALL') {
      rows = rows.filter(r => r.status === String(status));
    }

    // Attach linked journal voucher info
    const payrollIds = rows.map(r => r.id);
    let linkedVouchers: Array<{
      id: number;
      voucherNumber: number;
      referenceId: number | null;
      status: string;
      date: string;
    }> = [];
    if (payrollIds.length > 0) {
      linkedVouchers = await orm.select({
        id: journalVouchers.id,
        voucherNumber: journalVouchers.voucherNumber,
        referenceId: journalVouchers.referenceId,
        status: journalVouchers.status,
        date: journalVouchers.date
      })
      .from(journalVouchers)
      .where(and(
        eq(journalVouchers.referenceModule, 'payroll'),
        eq(journalVouchers.isDeleted, 0)
      ));
    }

    const voucherMap = new Map<number, (typeof linkedVouchers)[number]>();
    for (const v of linkedVouchers) {
      if (v.referenceId) {
        voucherMap.set(Number(v.referenceId), v);
      }
    }

    const enhancedRows = rows.map(r => {
      const v = voucherMap.get(r.id);
      return {
        ...r,
        voucherId: v ? v.id : null,
        voucherNumber: v ? v.voucherNumber : null,
        voucherStatus: v ? v.status : null,
        isVoucherSynced: !!v
      };
    });

    res.json(enhancedRows);
  } catch (err) {
    logger.error({ message: 'Error fetching payrolls', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// GET /api/piecework/payrolls/mine - فیش‌های حقوقی کاربر جاری
// برای پرسنلی که همزمان کاربر سیستم هستند: لینک personnel.userId → users.id
router.get('/piecework/payrolls/mine', async (req, res) => {
  try {
    const uid = Number((req as any).user?.id);
    if (!uid || isNaN(uid)) return res.json([]);

    const linkedPersonnel = await orm.select({ id: personnel.id })
      .from(personnel)
      .where(and(eq(personnel.userId, uid), eq(personnel.isDeleted, 0)));

    if (!linkedPersonnel.length) return res.json([]);

    const pIds = linkedPersonnel.map(p => p.id);
    const rows = await orm.select({
      id: pieceworkPayrolls.id,
      payrollNumber: pieceworkPayrolls.payrollNumber,
      personnelId: pieceworkPayrolls.personnelId,
      personnelName: personnel.fullName,
      personnelCode: personnel.personnelCode,
      jobTitle: personnel.jobTitle,
      cardNumber: personnel.cardNumber,
      shebaNumber: personnel.shebaNumber,
      bankName: personnel.bankName,
      startDate: pieceworkPayrolls.startDate,
      endDate: pieceworkPayrolls.endDate,
      title: pieceworkPayrolls.title,
      totalPieceworkAmount: pieceworkPayrolls.totalPieceworkAmount,
      totalFixedAmount: pieceworkPayrolls.totalFixedAmount,
      advanceDeduction: pieceworkPayrolls.advanceDeduction,
      totalBonuses: pieceworkPayrolls.totalBonuses,
      totalDeductions: pieceworkPayrolls.totalDeductions,
      netPayable: pieceworkPayrolls.netPayable,
      status: pieceworkPayrolls.status,
      paymentDate: pieceworkPayrolls.paymentDate,
      paymentMethod: pieceworkPayrolls.paymentMethod,
      paymentReference: pieceworkPayrolls.paymentReference,
      notes: pieceworkPayrolls.notes,
      createdAt: pieceworkPayrolls.createdAt
    })
    .from(pieceworkPayrolls)
    .innerJoin(personnel, eq(pieceworkPayrolls.personnelId, personnel.id))
    .where(and(eq(pieceworkPayrolls.isDeleted, 0), inArray(pieceworkPayrolls.personnelId, pIds)))
    .orderBy(desc(pieceworkPayrolls.id));

    // ریز کارکردهای هر فیش — تا فیشی که پرسنل می‌بیند کاملاً با فیش صدورکننده یکسان باشد
    const payrollIds = rows.map(r => r.id);
    let itemsByPayroll = new Map<number, any[]>();
    if (payrollIds.length > 0) {
      const logs = await orm.select({
        id: pieceworkLogs.id,
        payrollId: pieceworkLogs.payrollId,
        date: pieceworkLogs.date,
        dateIso: pieceworkLogs.dateIso,
        taskId: pieceworkLogs.taskId,
        taskTitle: pieceworkTasks.title,
        taskCode: pieceworkTasks.code,
        taskCategory: pieceworkTasks.category,
        unit: pieceworkTasks.unit,
        quantity: pieceworkLogs.quantity,
        unitRate: pieceworkLogs.unitRate,
        totalAmount: pieceworkLogs.totalAmount,
        notes: pieceworkLogs.notes
      })
      .from(pieceworkLogs)
      .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
      .where(and(inArray(pieceworkLogs.payrollId, payrollIds), eq(pieceworkLogs.isDeleted, 0)))
      .orderBy(pieceworkLogs.date);
      for (const lg of logs) {
        const arr = itemsByPayroll.get(lg.payrollId) || [];
        arr.push(lg);
        itemsByPayroll.set(lg.payrollId, arr);
      }
    }

    res.json(rows.map(r => ({ ...r, items: itemsByPayroll.get(r.id) || [] })));
  } catch (err) {
    logger.error({ message: 'Error fetching my payrolls', error: err });
    throw err;
  }
});

// GET /api/piecework/payrolls/:id - Get single payroll with detailed items
router.get('/piecework/payrolls/:id', validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);

    const [pay] = await orm.select({
      id: pieceworkPayrolls.id,
      payrollNumber: pieceworkPayrolls.payrollNumber,
      personnelId: pieceworkPayrolls.personnelId,
      personnelName: personnel.fullName,
      personnelCode: personnel.personnelCode,
      jobTitle: personnel.jobTitle,
      cardNumber: personnel.cardNumber,
      shebaNumber: personnel.shebaNumber,
      bankName: personnel.bankName,
      nobitexUsername: personnel.nobitexUsername,
      startDate: pieceworkPayrolls.startDate,
      endDate: pieceworkPayrolls.endDate,
      title: pieceworkPayrolls.title,
      totalPieceworkAmount: pieceworkPayrolls.totalPieceworkAmount,
      // V1.3.5: بدون این فیلد، ردیف حقوق ثابت در فیش چاپی نمایش داده نمی‌شد
      totalFixedAmount: pieceworkPayrolls.totalFixedAmount,
      advanceDeduction: pieceworkPayrolls.advanceDeduction,
      totalBonuses: pieceworkPayrolls.totalBonuses,
      totalDeductions: pieceworkPayrolls.totalDeductions,
      netPayable: pieceworkPayrolls.netPayable,
      status: pieceworkPayrolls.status,
      paymentDate: pieceworkPayrolls.paymentDate,
      paymentMethod: pieceworkPayrolls.paymentMethod,
      paymentReference: pieceworkPayrolls.paymentReference,
      notes: pieceworkPayrolls.notes,
      createdAt: pieceworkPayrolls.createdAt
    })
    .from(pieceworkPayrolls)
    .innerJoin(personnel, eq(pieceworkPayrolls.personnelId, personnel.id))
    .where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0)));

    if (!pay) {
      return res.status(404).json({ error: 'فیش حقوقی یافت نشد' });
    }

    // Get work log items attached to this payroll
    const items = await orm.select({
      id: pieceworkLogs.id,
      date: pieceworkLogs.date,
      dateIso: pieceworkLogs.dateIso,
      taskId: pieceworkLogs.taskId,
      taskTitle: pieceworkTasks.title,
      taskCode: pieceworkTasks.code,
      taskCategory: pieceworkTasks.category,
      unit: pieceworkTasks.unit,
      quantity: pieceworkLogs.quantity,
      unitRate: pieceworkLogs.unitRate,
      totalAmount: pieceworkLogs.totalAmount,
      notes: pieceworkLogs.notes
    })
    .from(pieceworkLogs)
    .innerJoin(pieceworkTasks, eq(pieceworkLogs.taskId, pieceworkTasks.id))
    .where(and(eq(pieceworkLogs.payrollId, id), eq(pieceworkLogs.isDeleted, 0)))
    .orderBy(pieceworkLogs.date);

    // Get linked journal voucher if available
    const [linkedVoucher] = await orm.select({
      id: journalVouchers.id,
      voucherNumber: journalVouchers.voucherNumber,
      status: journalVouchers.status,
      date: journalVouchers.date,
      totalDebit: journalVouchers.totalDebit
    })
    .from(journalVouchers)
    .where(and(
      eq(journalVouchers.referenceModule, 'payroll'),
      eq(journalVouchers.referenceId, id),
      eq(journalVouchers.isDeleted, 0)
    ))
    .limit(1);

    res.json({
      ...pay,
      items,
      voucherId: linkedVoucher ? linkedVoucher.id : null,
      voucherNumber: linkedVoucher ? linkedVoucher.voucherNumber : null,
      voucherStatus: linkedVoucher ? linkedVoucher.status : null,
      isVoucherSynced: !!linkedVoucher
    });
  } catch (err) {
    logger.error({ message: 'Error fetching payroll detail', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/piecework/payrolls - Generate new payroll for personnel
router.post(['/piecework/payrolls', '/piecework/payrolls/generate'], authorize('personnel.manage', 'admin'), idempotency({ scope: 'payroll' }), validate(generatePieceworkPayrollSchema), async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';
    const { personnelId, startDate, endDate, title, bonuses, totalBonuses, deductions, totalDeductions, advanceDeduction: reqAdvanceDeduction, notes } = req.body;

    const pId = Number(personnelId);
    const sDate = normalizePersianDate(String(startDate));
    const eDate = normalizePersianDate(String(endDate));

    // V4.0.4 (TD-091 / Subphase 3.1): کل چرخه صدور فیش، قفل ردیفی کارکردها، محاسبه مالی و سند دوبل داخل یک تراکنش واحد اتمیک
    const result = await orm.transaction(async (tx) => {
      const [pInfo] = await tx.select().from(personnel).where(and(eq(personnel.id, pId), eq(personnel.isDeleted, 0))).for('update');
      if (!pInfo) {
        return { status: 404, error: 'پرسنل انتخاب شده یافت نشد' };
      }

      // 1. Find pending work logs in this date range WITH ROW LOCKING (.for('update'))
      const allPersonnelLogs = await tx.select()
        .from(pieceworkLogs)
        .where(and(
          eq(pieceworkLogs.personnelId, pId),
          eq(pieceworkLogs.isDeleted, 0),
          or(eq(pieceworkLogs.status, 'pending'), sql`${pieceworkLogs.payrollId} IS NULL`)
        ))
        .for('update');

      const eligibleLogs = allPersonnelLogs.filter(log => {
        const d = normalizePersianDate(log.date);
        return d >= sDate && d <= eDate;
      });

      // 2. Fixed salary deduction & dedup within transaction
      const salaryType = String((pInfo as any).salaryType || 'none');
      const fixedIncluded = salaryType === 'monthly_fixed' || salaryType === 'mixed';
      let fixedPortionFin = fixedIncluded ? fin(pInfo.monthlySalary || 0) : fin(0);

      let fixedDedupNote = '';
      if (fixedIncluded && fixedPortionFin.greaterThan(0)) {
        const targetMonthKey = sDate.slice(0, 7); // '1405/06'
        const priorFixedPayrolls = await tx.select({
          id: pieceworkPayrolls.id,
          payrollNumber: pieceworkPayrolls.payrollNumber,
          startDate: pieceworkPayrolls.startDate,
          totalFixedAmount: pieceworkPayrolls.totalFixedAmount
        })
        .from(pieceworkPayrolls)
        .where(and(
          eq(pieceworkPayrolls.personnelId, pId),
          eq(pieceworkPayrolls.isDeleted, 0)
        ))
        .for('update');

        const sameMonthFixed = priorFixedPayrolls.filter(pr => String(pr.startDate || '').slice(0, 7) === targetMonthKey);
        const alreadyGranted = sameMonthFixed.reduce((sum, pr) => sum.add(pr.totalFixedAmount || 0), fin(0));
        if (alreadyGranted.greaterThan(0)) {
          fixedPortionFin = fixedPortionFin.subtract(alreadyGranted);
          if (fixedPortionFin.isNegative()) {
            fixedPortionFin = fin(0);
          }
          const refs = sameMonthFixed.map(pr => pr.payrollNumber).join('، ');
          fixedDedupNote = alreadyGranted.greaterThanOrEqual(pInfo.monthlySalary || 0)
            ? `سهم حقوق ثابت ماه ${targetMonthKey} قبلاً به‌طور کامل در فیش(های) ${refs} محاسبه شده است؛ این فیش فقط کارکرد پرکیسی را پوشش می‌دهد.`
            : `سهم حقوق ثابت این ماه با کسر مبلغ قبلی (فیش ${refs}) محاسبه شد.`;
        }
      }

      if (eligibleLogs.length === 0 && fixedPortionFin.lessThanOrEqual(0)) {
        return { status: 400, error: 'هیچ کارکرد معوقی در این بازه زمانی برای پرسنل انتخاب‌شده پیدا نشد.' };
      }

      // 3. Financial calculations with financialDecimal (TD-091)
      let pieceworkTotalFin = fin(0);
      for (const log of eligibleLogs) {
        pieceworkTotalFin = pieceworkTotalFin.add(log.totalAmount || 0);
      }
      const totBonusesFin = fin(bonuses !== undefined ? bonuses : (totalBonuses !== undefined ? totalBonuses : 0));
      const totDeductionsFin = fin(deductions !== undefined ? deductions : (totalDeductions !== undefined ? totalDeductions : 0));
      const advanceDeductionFin = fin(Math.max(0, Number(reqAdvanceDeduction) || 0));

      const netFin = pieceworkTotalFin
        .add(fixedPortionFin)
        .add(totBonusesFin)
        .subtract(totDeductionsFin)
        .subtract(advanceDeductionFin)
        .round(4);

      if (netFin.isNegative()) {
        return { status: 400, error: 'جمع کسورات و کسر مساعده از اجزای فیش بیشتر است — مقادیر را اصلاح کنید.' };
      }

      const pieceworkTotal = pieceworkTotalFin.round(4).toNumber();
      const fixedPortion = fixedPortionFin.round(4).toNumber();
      const totBonuses = totBonusesFin.round(4).toNumber();
      const totDeductions = totDeductionsFin.round(4).toNumber();
      const advanceDeduction = advanceDeductionFin.round(4).toNumber();
      const net = netFin.toNumber();

      // 4. Atomic Sequence Numbering from piecework_payroll_number_seq
      const seqResult = await tx.execute(sql`SELECT nextval('piecework_payroll_number_seq') AS num`);
      const seq = Number(seqResult.rows?.[0]?.num);
      const payrollNumber = `PAY-${seq}`;

      const defaultTitle = title && String(title).trim() ? String(title).trim() : `فیش کارکرد ${pInfo.fullName} (${sDate} تا ${eDate})`;
      const finalNotes = [notes ? String(notes).trim() : '', fixedDedupNote].filter(Boolean).join(' | ');

      // 5. Insert payroll record
      const [newPayroll] = await tx.insert(pieceworkPayrolls).values({
        payrollNumber,
        personnelId: pId,
        startDate: sDate,
        endDate: eDate,
        title: defaultTitle,
        totalPieceworkAmount: pieceworkTotal,
        totalFixedAmount: fixedPortion,
        totalBonuses: totBonuses,
        totalDeductions: totDeductions,
        advanceDeduction,
        netPayable: net,
        status: 'approved',
        notes: finalNotes,
        createdById: currentUserId,
        isDeleted: 0
      }).returning();

      // 6. Link logs to payroll with atomic WHERE payrollId IS NULL guard
      const logIds = eligibleLogs.map(l => l.id);
      if (logIds.length > 0) {
        await tx.update(pieceworkLogs)
          .set({ payrollId: newPayroll.id, status: 'approved' })
          .where(and(
            inArray(pieceworkLogs.id, logIds),
            sql`${pieceworkLogs.payrollId} IS NULL`
          ));
      }

      // 7. Synchronize double-entry journal voucher inside the same transaction
      // V4.0.5 (F-3 / TD-093): صدور الزامی سند دوبل حسابداری در حالت strict — جلوگیری از ایجاد فیش‌های معلق بدون سند
      const autoVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(
        newPayroll.id,
        currentUserId,
        currentUsername,
        tx,
        { strict: true }
      );

      return {
        status: 201,
        payroll: newPayroll,
        personnelName: pInfo.fullName,
        voucher: autoVoucher
      };
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    const { payroll, personnelName, voucher } = result;

    await logActivity({
      userId: currentUserId,
      username: currentUsername,
      action: 'CREATE',
      entity: 'فیش حقوقی',
      entityId: payroll.id,
      description: `صدور فیش حقوقی پرکیسی ${payroll.payrollNumber} برای ${personnelName} (سند حسابداری: ${voucher ? voucher.voucherNumber : 'بدون سند'})`
    });

    res.status(201).json({
      ...payroll,
      voucherId: voucher ? voucher.id : null,
      voucherNumber: voucher ? voucher.voucherNumber : null,
      isVoucherSynced: !!voucher
    });
  } catch (err) {
    logger.error({ message: 'Error generating payroll', error: err });
    throw err;
  }
});

// PUT /api/piecework/payrolls/:id/status - Update status or mark as paid
router.put('/piecework/payrolls/:id/status', authorize('personnel.manage', 'admin'), validate(updatePieceworkPayrollStatusSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, paymentDate, paymentMethod, paymentReference, notes } = req.body;

    // V10-4.4: گذار وضعیت به «paid» دیگر مستقیم مجاز نیست — فقط از مسیر خزانه‌داری
    if (status && String(status).trim().toLowerCase() === 'paid') {
      throw new ConflictError(
        'علامت‌گذاری دستی «پرداخت‌شده» مجاز نیست. پرداخت حقوق باید از طریق دکمه «ثبت پرداخت» با انتخاب حساب خزانه/بانک انجام شود تا تراکنش مالی و سند تسویه اتمیک صادر گردد.'
      );
    }

    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';

    const result = await orm.transaction(async (tx) => {
      const [pay] = await tx.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0))).for('update');
      if (!pay) {
        return { status: 404, error: 'فیش حقوقی یافت نشد' };
      }

      const updates: Partial<typeof pieceworkPayrolls.$inferInsert> = {};
      if (status) updates.status = String(status);
      if (paymentDate !== undefined) updates.paymentDate = String(paymentDate).trim();
      if (paymentMethod !== undefined) updates.paymentMethod = String(paymentMethod).trim();
      if (paymentReference !== undefined) updates.paymentReference = String(paymentReference).trim();
      if (notes !== undefined) updates.notes = String(notes).trim();

      await tx.update(pieceworkPayrolls).set(updates).where(eq(pieceworkPayrolls.id, id));

      // Also update attached logs status
      if (status) {
        await tx.update(pieceworkLogs)
          .set({ status: String(status) })
          .where(eq(pieceworkLogs.payrollId, id));
      }

      // Trigger or verify journal voucher inside transaction
      let autoVoucher: { id: number; voucherNumber: number } | null = null;
      if (status === 'approved' || status === 'paid') {
        autoVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(
          id,
          currentUserId,
          currentUsername,
          tx,
          { strict: true }
        );
      }

      return {
        status: 200,
        payroll: pay,
        voucher: autoVoucher
      };
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    await logActivity({
      userId: currentUserId,
      username: currentUsername,
      action: 'UPDATE',
      entity: 'فیش حقوقی',
      entityId: id,
      description: `تغییر وضعیت فیش حقوقی ${result.payroll.payrollNumber} به «${status}»`
    });

    res.json({
      status: 'ok',
      message: 'وضعیت فیش حقوقی به‌روزرسانی شد',
      voucherId: result.voucher ? result.voucher.id : null,
      voucherNumber: result.voucher ? result.voucher.voucherNumber : null
    });
  } catch (err) {
    logger.error({ message: 'Error updating payroll status', error: err });
    throw err;
  }
});

// POST /api/piecework/payrolls/:id/register-payment — V10-4.4: مسیر یگانه پرداخت حقوق
router.post('/piecework/payrolls/:id/register-payment', authorize('personnel.manage', 'admin'), idempotency({ scope: 'payroll' }), validate(registerPayrollPaymentSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { bankAccountId, method, amount, paymentDate, paymentReference, notes } = req.body;

    const result = await PayrollPaymentService.registerPayrollPayment({
      payrollId: id,
      bankAccountId: Number(bankAccountId),
      method,
      amount: amount !== undefined ? Number(amount) : undefined,
      paymentDate,
      paymentReference,
      notes,
      userId: req.user?.id,
      username: req.user?.username || 'سیستم'
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'پرداخت حقوق',
      entityId: id,
      description: `ثبت پرداخت خزانه‌ای فیش ${result.payroll.payrollNumber} با تراکنش ${result.transactionNumber} (سند تسویه: ${result.voucherNumber ?? '—'})`,
      details: {
        payrollId: id,
        transactionNumber: result.transactionNumber,
        voucherId: result.voucherId
      }
    });

    res.json({
      success: true,
      message: `پرداخت فیش ${result.payroll.payrollNumber} ثبت شد؛ تراکنش خزانه ${result.transactionNumber} و سند تسویه صادر گردید.`,
      ...result
    });
  } catch (err) {
    logger.error({ message: 'Error registering payroll payment', error: err });
    throw err;
  }
});

// POST /api/piecework/payrolls/:id/sync-voucher - Explicitly sync accounting journal voucher for payroll
router.post('/piecework/payrolls/:id/sync-voucher', authorizePermission('piecework.payroll', 'personnel.manage'), idempotency({ scope: 'payroll' }), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await orm.transaction(async (tx) => {
      const [pay] = await tx.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0))).for('update');
      if (!pay) {
        return { status: 404, error: 'فیش حقوقی یافت نشد' };
      }

      const voucher = await VoucherSyncService.autoCreateVoucherForPayroll(
        id,
        req.user?.id,
        req.user?.username || 'سیستم',
        tx,
        { strict: true }
      );

      if (!voucher) {
        return { status: 400, error: 'ایجاد سند حسابداری برای این فیش حقوقی ناموفق بود یا سرفصل‌های معین دستمزد تعریف نشده‌اند.' };
      }

      return { status: 200, payroll: pay, voucher };
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json({
      success: true,
      message: `سند حسابداری شماره ${result.voucher.voucherNumber} برای فیش حقوقی ${result.payroll.payrollNumber} ثبت یا همگام گردید.`,
      voucher: result.voucher
    });
  } catch (err) {
    logger.error({ message: 'Error syncing payroll voucher', error: err });
    throw err;
  }
});

// DELETE /api/piecework/payrolls/:id - Cancel/delete payroll and un-link logs
router.delete('/piecework/payrolls/:id', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await orm.transaction(async (tx) => {
      const [pay] = await tx.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0))).for('update');
      if (!pay) {
        return { status: 404, error: 'فیش حقوقی یافت نشد' };
      }

      // Check linked voucher
      const [linkedVoucher] = await tx.select().from(journalVouchers).where(and(
        eq(journalVouchers.referenceModule, 'payroll'),
        eq(journalVouchers.referenceId, id),
        eq(journalVouchers.isDeleted, 0)
      )).for('update');

      if (linkedVoucher && linkedVoucher.status === 'permanent') {
        return { status: 400, error: `سند حسابداری شماره #${linkedVoucher.voucherNumber} قطعی شده است و امکان ابطال فیش حقوقی وجود ندارد.` };
      }

      if (linkedVoucher) {
        await tx.update(journalVouchers).set({ isDeleted: 1 }).where(eq(journalVouchers.id, linkedVoucher.id));
      }

      // Unlink logs back to pending
      await tx.update(pieceworkLogs)
        .set({ payrollId: null, status: 'pending' })
        .where(eq(pieceworkLogs.payrollId, id));

      await tx.update(pieceworkPayrolls).set({ isDeleted: 1 }).where(eq(pieceworkPayrolls.id, id));

      return { status: 200, payroll: pay };
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'فیش حقوقی',
      entityId: id,
      description: `ابطال و حذف فیش حقوقی ${result.payroll.payrollNumber}`
    });

    res.json({ status: 'ok', message: 'فیش حقوقی با موفقیت باطل شد' });
  } catch (err) {
    logger.error({ message: 'Error deleting payroll', error: err });
    throw err;
  }
});

export default router;
