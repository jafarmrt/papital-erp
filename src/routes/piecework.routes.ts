import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { orm } from '../db/drizzle.js';
import { pieceworkTasks, pieceworkPersonnelRates, pieceworkLogs, pieceworkPayrolls, personnel, users, taskCategories, productionProjects, journalVouchers } from '../db/schema.js';
import { eq, and, desc, like, or, sql, inArray } from 'drizzle-orm';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { normalizePersianDate, parseQuantityOrTime } from '../utils.js';
import { VoucherSyncService } from '../services/accounting/voucherSync.service.js';
import { PayrollPaymentService } from '../services/accounting/payrollPayment.service.js';
import { ConflictError } from '../errors/customErrors.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';

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

// GET /api/piecework/tasks - List all tasks
router.get('/piecework/tasks', async (req, res) => {
  try {
    const { category, search } = req.query;
    
    let query = orm.select()
      .from(pieceworkTasks)
      .where(eq(pieceworkTasks.isDeleted, 0))
      .orderBy(pieceworkTasks.category, pieceworkTasks.id);

    const tasks = await query;

    let filtered = tasks;
    if (category && String(category) !== 'ALL') {
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
  } catch (err: any) {
    logger.error({ message: 'Error fetching piecework tasks', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
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

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'عنوان پرکیسی',
      entityId: newTask.id,
      description: `تعریف عنوان کاری پرکیسی جدید «${newTask.title}» با کد «${newTask.code}»`
    });

    res.status(201).json(newTask);
  } catch (err: any) {
    logger.error({ message: 'Error creating piecework task', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
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

    await orm.update(pieceworkTasks).set({
      title: title !== undefined ? String(title).trim() : existing.title,
      category: category !== undefined ? String(category).trim() : existing.category,
      defaultRate: defaultRate !== undefined ? Number(defaultRate) : existing.defaultRate,
      unit: unit !== undefined ? String(unit).trim() : existing.unit,
      description: description !== undefined ? String(description).trim() : existing.description,
      isActive: isActive !== undefined ? (isActive ? 1 : 0) : existing.isActive
    }).where(eq(pieceworkTasks.id, id));

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'عنوان پرکیسی',
      entityId: id,
      description: `ویرایش عنوان کاری پرکیسی «${existing.title}»`
    });

    res.json({ status: 'ok', message: 'عنوان کاری با موفقیت به‌روزرسانی شد' });
  } catch (err: any) {
    logger.error({ message: 'Error updating piecework task', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
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

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'عنوان پرکیسی',
      entityId: id,
      description: `حذف عنوان کاری پرکیسی «${existing.title}»`
    });

    res.json({ status: 'ok', message: 'عنوان کاری حذف شد' });
  } catch (err: any) {
    logger.error({ message: 'Error deleting piecework task', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// ==========================================
// 1.5. Task Categories (دسته‌بندی‌های عناوین کاری)
// ==========================================

// GET /api/piecework/categories
router.get('/piecework/categories', async (req, res) => {
  try {
    let dbCats: any[] = [];
    try {
      dbCats = await orm.select().from(taskCategories).where(eq(taskCategories.isDeleted, 0));
    } catch (e) {
      logger.warn({ message: 'taskCategories table query error, falling back to empty list', error: e });
    }

    let tasks: any[] = [];
    try {
      tasks = await orm.select({ cat: pieceworkTasks.category }).from(pieceworkTasks).where(eq(pieceworkTasks.isDeleted, 0));
    } catch (e) {
      logger.warn({ message: 'pieceworkTasks query error', error: e });
    }

    const catSet = new Set<string>();
    dbCats.forEach(c => catSet.add(c.name));
    tasks.forEach(t => { if (t.cat) catSet.add(t.cat); });
    
    const defaults = ['کاشی و خشت', 'سمباده و روتوش', 'ترنسفر', 'رنگ و گلیز', 'مونتاژ', 'بندبافی', 'بسته‌بندی', 'سایر'];
    defaults.forEach(d => catSet.add(d));

    const resultList = Array.from(catSet).map(name => {
      const match = dbCats.find(c => c.name === name);
      return {
        id: match ? match.id : name,
        name: name,
        description: match ? match.description || '' : ''
      };
    });

    res.json(resultList);
  } catch (err: any) {
    logger.error({ message: 'Error fetching task categories', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/piecework/categories
router.post('/piecework/categories', authorize('personnel.manage', 'admin', 'settings.manage'), validate(createTaskCategorySchema), async (req, res) => {
  try {
    const { name, description } = req.body;
    const catName = String(name).trim();

    const [existing] = await orm.select().from(taskCategories).where(and(eq(taskCategories.name, catName), eq(taskCategories.isDeleted, 0)));
    if (existing) {
      return res.status(400).json({ error: 'این دسته‌بندی کاری قبلاً ثبت شده است' });
    }

    const [inserted] = await orm.insert(taskCategories).values({
      name: catName,
      description: description ? String(description).trim() : ''
    }).returning();

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'دسته‌بندی کاری',
      entityId: inserted.id,
      description: `تعریف دسته‌بندی کاری جدید «${catName}»`
    });

    res.status(201).json(inserted);
  } catch (err: any) {
    logger.error({ message: 'Error creating task category', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// PUT /api/piecework/categories/:id
router.put('/piecework/categories/:id', authorize('personnel.manage', 'admin', 'settings.manage'), validate(updateTaskCategorySchema), async (req, res) => {
  try {
    const id = req.params.id;
    const { name, description } = req.body;
    const newName = String(name).trim();

    let oldName = '';
    if (!isNaN(Number(id))) {
      const [existing] = await orm.select().from(taskCategories).where(eq(taskCategories.id, Number(id)));
      if (existing) {
        oldName = existing.name;
        await orm.update(taskCategories).set({ name: newName, description: description ? String(description).trim() : existing.description }).where(eq(taskCategories.id, Number(id)));
      }
    } else {
      oldName = String(id);
      await orm.insert(taskCategories).values({ name: newName, description: description ? String(description).trim() : '' }).onConflictDoNothing();
    }

    if (oldName && oldName !== newName) {
      await orm.update(pieceworkTasks).set({ category: newName }).where(eq(pieceworkTasks.category, oldName));
    }

    res.json({ status: 'ok', name: newName });
  } catch (err: any) {
    logger.error({ message: 'Error updating task category', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// DELETE /api/piecework/categories/:id
router.delete('/piecework/categories/:id', authorize('personnel.manage', 'admin', 'settings.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = req.params.id;
    if (!isNaN(Number(id))) {
      await orm.update(taskCategories).set({ isDeleted: 1 }).where(eq(taskCategories.id, Number(id)));
    }
    res.json({ status: 'ok' });
  } catch (err: any) {
    logger.error({ message: 'Error deleting task category', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
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
  } catch (err: any) {
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
  } catch (err: any) {
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
      const s = normalizePersianDate(String(startDate));
      rows = rows.filter(r => normalizePersianDate(r.date) >= s);
    }

    if (endDate && String(endDate).trim()) {
      const e = normalizePersianDate(String(endDate));
      rows = rows.filter(r => normalizePersianDate(r.date) <= e);
    }

    if (status && String(status) !== 'ALL') {
      rows = rows.filter(r => r.status === String(status));
    }

    res.json(rows);
  } catch (err: any) {
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

      const [inserted] = await orm.insert(pieceworkLogs).values({
        personnelId: Number(personnelId),
        taskId: Number(taskId),
        projectId: projectId ? Number(projectId) : null,
        date: normalizePersianDate(String(date)),
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
  } catch (err: any) {
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

      const [inserted] = await orm.insert(pieceworkLogs).values({
        personnelId: Number(personnelId),
        taskId: Number(taskId),
        projectId: projectId ? Number(projectId) : null,
        date: normalizePersianDate(String(date)),
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
  } catch (err: any) {
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
    const newQty = quantity !== undefined ? parseQuantityOrTime(quantity) : existing.quantity;
    const newRate = unitRate !== undefined ? Number(unitRate) : existing.unitRate;
    const newTotal = newQty * newRate;

    await orm.update(pieceworkLogs).set({
      date: newDate,
      quantity: newQty,
      unitRate: newRate,
      totalAmount: newTotal,
      projectId: projectId !== undefined ? (projectId ? Number(projectId) : null) : existing.projectId,
      notes: notes !== undefined ? String(notes).trim() : existing.notes
    }).where(eq(pieceworkLogs.id, id));

    res.json({ status: 'ok', message: 'کارکرد ویرایش شد' });
  } catch (err: any) {
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
  } catch (err: any) {
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
    let linkedVouchers: any[] = [];
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

    const voucherMap = new Map<number, any>();
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
  } catch (err: any) {
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
  } catch (err: any) {
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
  } catch (err: any) {
    logger.error({ message: 'Error fetching payroll detail', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/piecework/payrolls - Generate new payroll for personnel
router.post(['/piecework/payrolls', '/piecework/payrolls/generate'], authorize('personnel.manage', 'admin'), validate(generatePieceworkPayrollSchema), async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const { personnelId, startDate, endDate, title, bonuses, totalBonuses, deductions, totalDeductions, advanceDeduction: reqAdvanceDeduction, notes } = req.body;

    const pId = Number(personnelId);
    const [pInfo] = await orm.select().from(personnel).where(and(eq(personnel.id, pId), eq(personnel.isDeleted, 0)));
    if (!pInfo) {
      return res.status(404).json({ error: 'پرسنل انتخاب شده یافت نشد' });
    }

    const sDate = normalizePersianDate(String(startDate));
    const eDate = normalizePersianDate(String(endDate));

    // Find pending work logs in this date range
    const allPersonnelLogs = await orm.select()
      .from(pieceworkLogs)
      .where(and(
        eq(pieceworkLogs.personnelId, pId),
        eq(pieceworkLogs.isDeleted, 0),
        or(eq(pieceworkLogs.status, 'pending'), sql`${pieceworkLogs.payrollId} IS NULL`)
      ));

    const eligibleLogs = allPersonnelLogs.filter(log => {
      const d = normalizePersianDate(log.date);
      return d >= sDate && d <= eDate;
    });

    // V10-4.4: مدل حقوق ثابت/ترکیبی — سهم حقوق ماهانه بدون نیاز به ردیف کارکرد
    // V1.3.2: حقوق ماهانه فقط «یک بار» در هر ماه جلالی به پرسنل تعلق می‌گیرد —
    // جمع سهم ثابت فیش‌های قبلی همان ماه از سهم فعلی کسر می‌شود تا صدور چند فیش در یک ماه منجر به پرداخت تکراری نشود.
    const salaryType = String((pInfo as any).salaryType || 'none');
    const fixedIncluded = salaryType === 'monthly_fixed' || salaryType === 'mixed';
    let fixedPortion = fixedIncluded ? Number(pInfo.monthlySalary || 0) : 0;

    let fixedDedupNote = '';
    if (fixedIncluded && fixedPortion > 0) {
      const targetMonthKey = sDate.slice(0, 7); // '1405/06'
      const priorFixedPayrolls = await orm.select({
        id: pieceworkPayrolls.id,
        payrollNumber: pieceworkPayrolls.payrollNumber,
        startDate: pieceworkPayrolls.startDate,
        totalFixedAmount: pieceworkPayrolls.totalFixedAmount
      })
      .from(pieceworkPayrolls)
      .where(and(
        eq(pieceworkPayrolls.personnelId, pId),
        eq(pieceworkPayrolls.isDeleted, 0)
      ));
      const sameMonthFixed = priorFixedPayrolls.filter(pr => String(pr.startDate || '').slice(0, 7) === targetMonthKey);
      const alreadyGranted = sameMonthFixed.reduce((sum, pr) => sum + Number(pr.totalFixedAmount || 0), 0);
      if (alreadyGranted > 0) {
        fixedPortion = Math.max(0, fixedPortion - alreadyGranted);
        const refs = sameMonthFixed.map(pr => pr.payrollNumber).join('، ');
        fixedDedupNote = alreadyGranted >= Number(pInfo.monthlySalary || 0)
          ? `سهم حقوق ثابت ماه ${targetMonthKey} قبلاً به‌طور کامل در فیش(های) ${refs} محاسبه شده است؛ این فیش فقط کارکرد پرکیسی را پوشش می‌دهد.`
          : `سهم حقوق ثابت این ماه با کسر مبلغ قبلی (فیش ${refs}) محاسبه شد.`;
      }
    }

    if (eligibleLogs.length === 0 && fixedPortion <= 0) {
      return res.status(400).json({ error: 'هیچ کارکرد معوقی در این بازه زمانی برای پرسنل انتخاب‌شده پیدا نشد.' });
    }

    const pieceworkTotal = eligibleLogs.reduce((sum, log) => sum + Number(log.totalAmount || 0), 0);
    const totBonuses = Number(bonuses !== undefined ? bonuses : (totalBonuses !== undefined ? totalBonuses : 0)) || 0;
    const totDeductions = Number(deductions !== undefined ? deductions : (totalDeductions !== undefined ? totalDeductions : 0)) || 0;
    // V1.9.0: کسر از مساعده/وام پرسنلی — بستانکار حساب مساعده (1301) در سند تسویه
    const advanceDeduction = Math.max(0, Number(reqAdvanceDeduction) || 0);
    // V10-4.4: net = کارکرد پرکیسی + سهم ثابت (در صورت وجود) + پاداش − کسورات − کسر مساعده
    const net = pieceworkTotal + fixedPortion + totBonuses - totDeductions - advanceDeduction;
    if (net < 0) {
      return res.status(400).json({ error: 'جمع کسورات و کسر مساعده از اجزای فیش بیشتر است — مقادیر را اصلاح کنید.' });
    }

    // Generate unique payroll number
    const countRes = await orm.select({ count: sql<number>`count(*)` }).from(pieceworkPayrolls);
    const seq = Number(countRes[0]?.count || 0) + 1001;
    const payrollNumber = `PAY-${seq}`;

    const defaultTitle = title && String(title).trim() ? String(title).trim() : `فیش کارکرد ${pInfo.fullName} (${sDate} تا ${eDate})`;
    const finalNotes = [notes ? String(notes).trim() : '', fixedDedupNote].filter(Boolean).join(' | ');

    const [newPayroll] = await orm.insert(pieceworkPayrolls).values({
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

    // Link all logs to this payroll (فقط اگر ردیف کارکردی وجود داشت — فیش صرفاً ثابت ممکن است لاگ نداشته باشد)
    const logIds = eligibleLogs.map(l => l.id);
    if (logIds.length > 0) {
      await orm.update(pieceworkLogs)
        .set({ payrollId: newPayroll.id, status: 'approved' })
        .where(inArray(pieceworkLogs.id, logIds));
    }

    // Automated Double-Entry Accounting Journal Voucher Creation (Subphase 11.1)
    let autoVoucher: any = null;
    try {
      autoVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(
        newPayroll.id,
        currentUserId,
        req.user?.username || 'سیستم'
      );
    } catch (vErr) {
      logger.warn({ message: 'Auto voucher creation warning for piecework payroll', error: vErr });
    }

    await logActivity({
      userId: currentUserId,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'فیش حقوقی',
      entityId: newPayroll.id,
      description: `صدور فیش حقوقی پرکیسی ${newPayroll.payrollNumber} برای ${pInfo.fullName} (سند حسابداری: ${autoVoucher ? autoVoucher.voucherNumber : 'بدون سند'})`
    });

    res.status(201).json({
      ...newPayroll,
      voucherId: autoVoucher ? autoVoucher.id : null,
      voucherNumber: autoVoucher ? autoVoucher.voucherNumber : null,
      isVoucherSynced: !!autoVoucher
    });
  } catch (err: any) {
    logger.error({ message: 'Error generating payroll', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
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

    const [pay] = await orm.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0)));
    if (!pay) {
      return res.status(404).json({ error: 'فیش حقوقی یافت نشد' });
    }

    const updates: any = {};
    if (status) updates.status = String(status);
    if (paymentDate !== undefined) updates.paymentDate = String(paymentDate).trim();
    if (paymentMethod !== undefined) updates.paymentMethod = String(paymentMethod).trim();
    if (paymentReference !== undefined) updates.paymentReference = String(paymentReference).trim();
    if (notes !== undefined) updates.notes = String(notes).trim();

    await orm.update(pieceworkPayrolls).set(updates).where(eq(pieceworkPayrolls.id, id));

    // Also update attached logs status
    if (status) {
      await orm.update(pieceworkLogs)
        .set({ status: String(status) })
        .where(eq(pieceworkLogs.payrollId, id));
    }

    // Trigger or verify journal voucher when approved or paid (Subphase 11.1)
    let autoVoucher: any = null;
    if (status === 'approved' || status === 'paid') {
      try {
        autoVoucher = await VoucherSyncService.autoCreateVoucherForPayroll(
          id,
          req.user?.id,
          req.user?.username || 'سیستم'
        );
      } catch (vErr) {
        logger.warn({ message: 'Auto voucher sync error on payroll status change', error: vErr });
      }
    }

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'فیش حقوقی',
      entityId: id,
      description: `تغییر وضعیت فیش حقوقی ${pay.payrollNumber} به «${status}»`
    });

    res.json({
      status: 'ok',
      message: 'وضعیت فیش حقوقی به‌روزرسانی شد',
      voucherId: autoVoucher ? autoVoucher.id : null,
      voucherNumber: autoVoucher ? autoVoucher.voucherNumber : null
    });
  } catch (err: any) {
    logger.error({ message: 'Error updating payroll status', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/piecework/payrolls/:id/register-payment — V10-4.4: مسیر یگانه پرداخت حقوق
router.post('/piecework/payrolls/:id/register-payment', authorize('personnel.manage', 'admin'), validate(registerPayrollPaymentSchema), async (req, res) => {
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
  } catch (err: any) {
    logger.error({ message: 'Error registering payroll payment', error: err });
    throw err;
  }
});

// POST /api/piecework/payrolls/:id/sync-voucher - Explicitly sync accounting journal voucher for payroll
router.post('/piecework/payrolls/:id/sync-voucher', authorizePermission('piecework.payroll', 'personnel.manage'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [pay] = await orm.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0)));
    if (!pay) {
      return res.status(404).json({ error: 'فیش حقوقی یافت نشد' });
    }

    const voucher = await VoucherSyncService.autoCreateVoucherForPayroll(
      id,
      req.user?.id,
      req.user?.username || 'سیستم'
    );

    if (!voucher) {
      return res.status(400).json({ error: 'ایجاد سند حسابداری برای این فیش حقوقی ناموفق بود یا سرفصل‌های معین دستمزد تعریف نشده‌اند.' });
    }

    res.json({
      success: true,
      message: `سند حسابداری شماره ${voucher.voucherNumber} برای فیش حقوقی ${pay.payrollNumber} ثبت یا همگام گردید.`,
      voucher
    });
  } catch (err: any) {
    logger.error({ message: 'Error syncing payroll voucher', error: err });
    throw err;
  }
});

// DELETE /api/piecework/payrolls/:id - Cancel/delete payroll and un-link logs
router.delete('/piecework/payrolls/:id', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [pay] = await orm.select().from(pieceworkPayrolls).where(and(eq(pieceworkPayrolls.id, id), eq(pieceworkPayrolls.isDeleted, 0)));
    if (!pay) {
      return res.status(404).json({ error: 'فیش حقوقی یافت نشد' });
    }

    // Unlink logs back to pending
    await orm.update(pieceworkLogs)
      .set({ payrollId: null, status: 'pending' })
      .where(eq(pieceworkLogs.payrollId, id));

    await orm.update(pieceworkPayrolls).set({ isDeleted: 1 }).where(eq(pieceworkPayrolls.id, id));

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'فیش حقوقی',
      entityId: id,
      description: `ابطال و حذف فیش حقوقی ${pay.payrollNumber}`
    });

    res.json({ status: 'ok', message: 'فیش حقوقی با موفقیت باطل شد' });
  } catch (err: any) {
    logger.error({ message: 'Error deleting payroll', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

export default router;
