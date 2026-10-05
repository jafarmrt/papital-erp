import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, authorizePermission, userHasRoleOrPermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { PayrollPaymentService } from '../services/accounting/payrollPayment.service.js';
import { PayrollPaymentVoidService } from '../services/accounting/payrollPaymentVoid.service.js';
import { PieceworkService, PieceworkReadService, PayrollReadService, PieceworkPayrollService } from '../services/piecework.service.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString, decimalInput } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { canAccessSensitivePersonnelData, sanitizePayrollRecord } from '../lib/piiMasker.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';

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
    // TD-246: کد جدید (خالی = کد فعلی بماند)؛ کد عنوان فعال دیگر با خطای ۴۰۹ رد می‌شود
    code: z.string().optional(),
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
    customRate: decimalInput('نرخ اختصاصی').refine(v => v !== undefined, 'نرخ اختصاصی الزامی است'),
  })
});

const pieceworkLogItemSchema = z.object({
  personnelId: z.union([z.number(), z.string()]),
  taskId: z.union([z.number(), z.string()]),
  projectId: z.union([z.number(), z.string(), z.null()]).optional(),
  date: z.string().min(1, 'تاریخ کارکرد الزامی است'),
  quantity: z.union([z.number(), z.string()]),
  unitRate: decimalInput('نرخ کارکرد').optional(),
  notes: z.string().optional(),
});

type PieceworkLogItemInput = z.infer<typeof pieceworkLogItemSchema>;

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
    unitRate: decimalInput('نرخ کارکرد').optional(),
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
    bonuses: decimalInput('پاداش').optional(),
    totalBonuses: decimalInput('پاداش').optional(),
    deductions: decimalInput('کسور').optional(),
    totalDeductions: decimalInput('کسور').optional(),
    advanceDeduction: decimalInput('کسر مساعده').optional(),
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
// v8.0.31 (TD-283): ابطال یک پرداخت فیش (دلیل الزامی)
const voidPayrollPaymentSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(1, 'دلیل ابطال پرداخت الزامی است').max(500)
  }),
  params: z.object({
    id: numericIdString,
    transactionId: numericIdString
  })
});

const registerPayrollPaymentSchema = z.object({
  body: z.object({
    bankAccountId: z.union([z.number(), z.string()]),
    method: z.enum(['cash', 'bank_transfer', 'pos', 'cheque']).optional().default('bank_transfer'),
    amount: decimalInput('مبلغ پرداخت').optional(),
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

// GET /api/piecework/tasks - List tasks (active, archived, or all)
router.get('/piecework/tasks', authorizePermission(...READ_PERMISSIONS.pieceworkReference), asyncHandler(async (req, res) => {
  try {
    const { category, search, status } = req.query;
    const filtered = await PieceworkReadService.listTasks({ category, search, status });
    res.json(filtered);
  } catch (err) {
    logger.error({ message: 'Error fetching piecework tasks', error: err });
    throw err;
  }
}));

// GET /api/piecework/tasks-history - Get global rate change history
router.get('/piecework/tasks-history', authorizePermission(...READ_PERMISSIONS.pieceworkReference), asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const history = await PieceworkReadService.listRateHistory(limit);
    res.json(history);
  } catch (err) {
    logger.error({ message: 'Error fetching global piecework task rate history', error: err });
    throw err;
  }
}));

// GET /api/piecework/tasks/:id/history - Get rate change history for specific task
router.get('/piecework/tasks/:id/history', authorizePermission(...READ_PERMISSIONS.pieceworkReference), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const history = await PieceworkReadService.listTaskRateHistory(id);
    res.json(history);
  } catch (err) {
    logger.error({ message: 'Error fetching piecework task rate history', error: err });
    throw err;
  }
}));

// POST /api/piecework/tasks - Create new task
router.post('/piecework/tasks', authorize('personnel.manage', 'admin'), validate(createPieceworkTaskSchema), asyncHandler(async (req, res) => {
  try {
    const { code, title, category, defaultRate, unit, description } = req.body;

    const newTask = await PieceworkService.createTask({
      code,
      title,
      category,
      defaultRate,
      unit,
      description,
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
}));

// POST /api/piecework/tasks/import-excel - Bulk import piecework tasks
router.post('/piecework/tasks/import-excel', authorize('personnel.manage', 'admin'), asyncHandler(async (req, res) => {
  try {
    const { rows, mode = 'upsert' } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'لیست ردیف‌های واردات اکسل خالی است' });
    }

    const result = await PieceworkService.importTasksFromExcel({
      rows,
      mode,
      userId: req.user?.id,
      username: req.user?.username
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'IMPORT',
      entity: 'عناوین پرکیسی',
      description: `واردات اکسل عناوین کاری پرکیسی (${result.createdCount} عنوان جدید، ${result.updatedCount} عنوان ویرایش‌شده، شیوه: ${mode})`
    });

    res.json({
      status: 'ok',
      message: `عملیات واردات با موفقیت انجام شد: ${result.createdCount} عنوان جدید ایجاد و ${result.updatedCount} عنوان به‌روزرسانی شدند.`,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      totalProcessed: result.totalProcessed
    });
  } catch (err) {
    logger.error({ message: 'Error importing piecework tasks from excel', error: err });
    throw err;
  }
}));

// POST /api/piecework/tasks/clear-defaults or clear-all
router.post(['/piecework/tasks/clear-defaults', '/piecework/tasks/clear-all'], authorize('personnel.manage', 'admin'), asyncHandler(async (req, res) => {
  try {
    const count = await PieceworkService.clearAllTasks({
      userId: req.user?.id,
      username: req.user?.username
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'عناوین پرکیسی',
      description: `پاکسازی کلی عناوین کاری پرکیسی (${count} مورد حذف شدند)`
    });

    res.json({
      status: 'ok',
      message: `تمام عناوین کاری (${count} مورد) با موفقیت حذف شدند.`,
      count
    });
  } catch (err) {
    logger.error({ message: 'Error clearing all piecework tasks', error: err });
    throw err;
  }
}));

// PUT /api/piecework/tasks/:id - Update task
router.put('/piecework/tasks/:id', authorize('personnel.manage', 'admin'), validate(updatePieceworkTaskSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { code, title, category, defaultRate, unit, description, isActive } = req.body;

    const { previous: existing, current } = await PieceworkService.updateTask(id, {
      code,
      title,
      category,
      defaultRate,
      unit,
      description,
      isActive,
      reason: req.body.reason,
      userId: req.user?.id,
      username: req.user?.username
    });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'عنوان پرکیسی',
      entityId: id,
      description: `ویرایش عنوان کاری پرکیسی «${existing.title}»${current.code !== existing.code ? ` (کد «${existing.code}» به «${current.code}»)` : ''}`
    });

    res.json({ status: 'ok', message: 'عنوان کاری با موفقیت به‌روزرسانی شد' });
  } catch (err) {
    logger.error({ message: 'Error updating piecework task', error: err });
    throw err;
  }
}));

// DELETE /api/piecework/tasks/:id
router.delete('/piecework/tasks/:id', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await PieceworkService.deleteTask(id, {
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
}));

// POST /api/piecework/tasks/:id/restore - Restore an archived/deleted task
router.post('/piecework/tasks/:id/restore', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await PieceworkService.restoreTask(id, {
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
}));

// ==========================================
// 1.5. Task Categories (دسته‌بندی‌های عناوین کاری)
// ==========================================

// GET /api/piecework/categories
router.get('/piecework/categories', authorizePermission(...READ_PERMISSIONS.pieceworkReference), asyncHandler(async (req, res) => {
  try {
    const resultList = await PieceworkReadService.listCategories();
    res.json(resultList);
  } catch (err) {
    logger.error({ message: 'Error fetching task categories', error: err });
    // V9-2.1: هدایت خطا به errorHandler سراسری با traceId
    throw err;
  }
}));

// POST /api/piecework/categories
router.post('/piecework/categories', authorize('personnel.manage', 'admin', 'settings.manage'), validate(createTaskCategorySchema), asyncHandler(async (req, res) => {
  try {
    const { name, description } = req.body;
    const inserted = await PieceworkService.createCategory({ name, description });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'CREATE',
      entity: 'دسته‌بندی کاری',
      entityId: inserted.id,
      description: `تعریف دسته‌بندی کاری جدید «${inserted.name}»`
    });

    res.status(201).json(inserted);
  } catch (err) {
    logger.error({ message: 'Error creating task category', error: err });
    throw err;
  }
}));

// PUT /api/piecework/categories/:id
router.put('/piecework/categories/:id', authorize('personnel.manage', 'admin', 'settings.manage'), validate(updateTaskCategorySchema), asyncHandler(async (req, res) => {
  try {
    const rawId = req.params.id;
    const { name, description } = req.body;

    const result = await PieceworkService.updateCategory(rawId, { name, description });

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'UPDATE',
      entity: 'دسته‌بندی کاری',
      entityId: result.id || 0,
      description: `ویرایش دسته‌بندی کاری «${result.name}»`
    });

    res.json({ status: 'ok', id: result.id, name: result.name });
  } catch (err) {
    logger.error({ message: 'Error updating task category', error: err });
    throw err;
  }
}));

// DELETE /api/piecework/categories/:id
router.delete('/piecework/categories/:id', authorize('personnel.manage', 'admin', 'settings.manage'), asyncHandler(async (req, res) => {
  try {
    const rawId = req.params.id;
    const result = await PieceworkService.deleteCategory(rawId);

    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      action: 'DELETE',
      entity: 'دسته‌بندی کاری',
      description: `حذف دسته‌بندی کاری «${result.name}»`
    });

    res.json({ status: 'ok', message: `دسته‌بندی «${result.name}» با موفقیت حذف شد` });
  } catch (err) {
    logger.error({ message: 'Error deleting task category', error: err });
    throw err;
  }
}));

// ==========================================
// 2. Custom Personnel Rates (نرخ‌های اختصاصی)
// ==========================================

// GET /api/piecework/personnel-rates/:personnelId
router.get(['/piecework/personnel-rates/:personnelId', '/piecework/rates/:personnelId'], authorizePermission(...READ_PERMISSIONS.pieceworkReference), validate(paramsPersonnelIdSchema), asyncHandler(async (req, res) => {
  try {
    const personnelId = Number(req.params.personnelId);
    const rates = await PieceworkReadService.listPersonnelRates(personnelId);

    res.json(rates);
  } catch (err) {
    logger.error({ message: 'Error fetching custom rates', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
}));

// POST /api/piecework/personnel-rates - Set or update custom rate
router.post(['/piecework/personnel-rates', '/piecework/rates'], authorize('personnel.manage', 'admin'), validate(setPersonnelRateSchema), asyncHandler(async (req, res) => {
  try {
    const { personnelId, taskId, customRate } = req.body;
    await PieceworkService.setPersonnelRate({ personnelId, taskId, customRate });
    res.json({ status: 'ok', message: 'نرخ اختصاصی ثبت شد' });
  } catch (err) {
    logger.error({ message: 'Error setting custom rate', error: err });
    throw err;
  }
}));

// ==========================================
// 3. Piecework Logs (کارکرد روزانه پرکیسی)
// ==========================================

// GET /api/piecework/logs - List work logs
router.get('/piecework/logs', authorizePermission(...READ_PERMISSIONS.pieceworkReference), asyncHandler(async (req, res) => {
  try {
    const { personnelId, projectId, startDate, endDate, status } = req.query;
    const rows = await PieceworkReadService.listWorkLogs({ personnelId, projectId, startDate, endDate, status });

    res.json(rows);
  } catch (err) {
    logger.error({ message: 'Error fetching piecework logs', error: err });
    throw err;
  }
}));

// POST /api/piecework/logs - Record work logs (Supports single or batch array)
// حوزه H (TD-300): ثبت کارکرد مبلغ فیش را می‌سازد؛ مجوزش «ثبت کارکرد پرسنل» است نه «ثبت گزارش کار روزانه»
router.post('/piecework/logs', authorize('personnel.manage', 'piecework.log', 'admin'), validate(createPieceworkLogsSchema), asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';

    const items = Array.isArray(req.body.items) ? req.body.items : [req.body];
    // حوزه H (TD-300، گزینه پیشنهادی «نرخ از سرور»): نرخ دستی فقط برای مدیر پرسنل یا مدیر تعرفه‌ها؛ دیگران نرخ
    // اختصاصی پرسنل یا نرخ پایه عنوان کار را می‌گیرند (logWorkEntries با نرخ خالی همین را می‌خواند)
    const canSetRate = await userHasRoleOrPermission(req.user, 'personnel.manage', 'piecework.manage_tasks');

    if (items.length === 0) {
      return res.status(400).json({ error: 'حداقل یک ردیف کارکرد انتخاب کنید' });
    }

    const insertedIds = await PieceworkService.logWorkEntries(
      items.map((item: PieceworkLogItemInput) => ({
        ...item,
        unitRate: canSetRate ? item.unitRate : undefined,
        createdById: currentUserId,
        createdByUsername: currentUsername
      }))
    );

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
    throw err;
  }
}));

// PUT /api/piecework/logs/:id - Update work log
router.put('/piecework/logs/:id', authorize('personnel.manage', 'admin'), validate(updatePieceworkLogSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { date, quantity, unitRate, notes, projectId } = req.body;

    await PieceworkService.updateWorkLog(id, { date, quantity, unitRate, notes, projectId });

    res.json({ status: 'ok', message: 'کارکرد ویرایش شد' });
  } catch (err) {
    logger.error({ message: 'Error updating piecework log', error: err });
    throw err;
  }
}));

// DELETE /api/piecework/logs/:id - Delete work log
router.delete('/piecework/logs/:id', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    await PieceworkService.deleteWorkLog(id);

    res.json({ status: 'ok', message: 'کارکرد حذف شد' });
  } catch (err) {
    logger.error({ message: 'Error deleting piecework log', error: err });
    throw err;
  }
}));

// ==========================================
// 4. Payrolls & Payslips (فیش‌های حقوقی و تسویه)
// ==========================================

// GET /api/piecework/payrolls - List payrolls
router.get('/piecework/payrolls', authorizePermission(...READ_PERMISSIONS.payrolls), asyncHandler(async (req, res) => {
  try {
    const { personnelId, status } = req.query;
    const enhancedRows = await PayrollReadService.listPayrolls({ personnelId, status });

    const canViewSensitive = await canAccessSensitivePersonnelData(req.user);
    const sanitizedRows = enhancedRows.map(r => sanitizePayrollRecord(r, canViewSensitive));

    res.json(sanitizedRows);
  } catch (err) {
    logger.error({ message: 'Error fetching payrolls', error: err });
    // V9-2.1: هدایت خطا به errorHandler سراسری با traceId
    throw err;
  }
}));

// GET /api/piecework/payrolls/mine - فیش‌های حقوقی کاربر جاری
// برای پرسنلی که همزمان کاربر سیستم هستند: لینک personnel.userId → users.id
router.get('/piecework/payrolls/mine', asyncHandler(async (req, res) => {
  try {
    const uid = Number(req.user?.id);
    if (!uid || isNaN(uid)) return res.json([]);

    res.json(await PayrollReadService.listPayrollsForUser(uid));
  } catch (err) {
    logger.error({ message: 'Error fetching my payrolls', error: err });
    throw err;
  }
}));

// GET /api/piecework/payrolls/:id - Get single payroll with detailed items
router.get('/piecework/payrolls/:id', authorizePermission(...READ_PERMISSIONS.payrolls), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);

    const detail = await PayrollReadService.getPayrollDetail(id);

    if (!detail) {
      return res.status(404).json({ error: 'فیش حقوقی یافت نشد' });
    }

    const { payroll: pay, items, voucherLink } = detail;
    const canViewSensitive = await canAccessSensitivePersonnelData(req.user, pay.personnelUserId);
    const sanitizedPay = sanitizePayrollRecord(pay, canViewSensitive);

    res.json({
      ...sanitizedPay,
      items,
      ...voucherLink
    });
  } catch (err) {
    logger.error({ message: 'Error fetching payroll detail', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
}));

// POST /api/piecework/payrolls - Generate new payroll for personnel
router.post(['/piecework/payrolls', '/piecework/payrolls/generate'], authorize('personnel.manage', 'admin'), idempotency({ scope: 'payroll' }), validate(generatePieceworkPayrollSchema), asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';
    const { personnelId, startDate, endDate, title, bonuses, totalBonuses, deductions, totalDeductions, advanceDeduction: reqAdvanceDeduction, notes } = req.body;

    const result = await PieceworkPayrollService.generatePayroll({
      personnelId,
      startDate,
      endDate,
      title,
      bonuses,
      totalBonuses,
      deductions,
      totalDeductions,
      advanceDeduction: reqAdvanceDeduction,
      notes,
      userId: currentUserId,
      username: currentUsername
    });

    if (result.error || !result.payroll) {
      return res.status(result.status || 400).json({ error: result.error || 'خطا در صدور فیش حقوقی' });
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
}));

// PUT /api/piecework/payrolls/:id/status - Update status or mark as paid
router.put('/piecework/payrolls/:id/status', authorize('personnel.manage', 'admin'), validate(updatePieceworkPayrollStatusSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, paymentDate, paymentMethod, paymentReference, notes } = req.body;

    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';

    const result = await PieceworkPayrollService.updatePayrollStatus(id, {
      status,
      paymentDate,
      paymentMethod,
      paymentReference,
      notes,
      userId: currentUserId,
      username: currentUsername
    });

    if (result.error || !result.payroll) {
      return res.status(result.status || 400).json({ error: result.error || 'خطا در ویرایش وضعیت فیش حقوقی' });
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
}));

// POST /api/piecework/payrolls/:id/register-payment — V10-4.4: مسیر یگانه پرداخت حقوق
router.post('/piecework/payrolls/:id/register-payment', authorize('personnel.manage', 'admin'), idempotency({ scope: 'payroll' }), validate(registerPayrollPaymentSchema), asyncHandler(async (req, res) => {
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
      message: result.isFullyPaid
        ? `پرداخت فیش ${result.payroll.payrollNumber} با موفقیت تسویه کامل شد؛ تراکنش خزانه ${result.transactionNumber} و سند تسویه صادر گردید.`
        : `پرداخت مرحله‌ای فیش ${result.payroll.payrollNumber} ثبت شد (مانده: ${result.remainingAmount.toLocaleString('fa-IR')} ریال)؛ تراکنش خزانه ${result.transactionNumber} صادر گردید.`,
      ...result
    });
  } catch (err) {
    logger.error({ message: 'Error registering payroll payment', error: err });
    throw err;
  }
}));

// POST /api/piecework/payrolls/:id/payments/:transactionId/void — v8.0.31 (TD-283، تصمیم مالک محصول): ابطال یک پرداخت فیش
router.post('/piecework/payrolls/:id/payments/:transactionId/void', authorize('personnel.manage', 'admin'), idempotency({ scope: 'payroll' }), validate(voidPayrollPaymentSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await PayrollPaymentVoidService.voidPayrollPayment({
    payrollId: id,
    transactionId: Number(req.params.transactionId),
    reason: String(req.body.reason),
    userId: req.user?.id,
    username: req.user?.username || 'سیستم'
  });

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'سیستم',
    action: 'DELETE',
    entity: 'پرداخت حقوق',
    entityId: id,
    description: `ابطال پرداخت ${result.transactionNumber} فیش ${result.payroll.payrollNumber} (تراکنش معکوس ${result.reversalTransactionNumber})`,
    details: { payrollId: id, transactionId: Number(req.params.transactionId), reason: req.body.reason, reversalVoucherId: result.reversalVoucherId }
  });

  res.json({
    success: true,
    message: `پرداخت ${result.transactionNumber} فیش ${result.payroll.payrollNumber} ابطال شد؛ مبلغ پرداخت‌شده فیش اکنون ${result.paidAmount.toLocaleString('fa-IR')} ریال است.`,
    ...result
  });
}));

// GET /api/piecework/payrolls/:id/payments — V4.0.33: دریافت سابقه اقساط و پرداخت‌های خزانه‌ای متصل به یک فیش
// حوزه H (TD-303): مبالغ پرداخت فیش همان محدوده خواندن فیش‌ها را دارد (AGENTS.md §5)
router.get('/piecework/payrolls/:id/payments', authorizePermission(...READ_PERMISSIONS.payrolls), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);

    const txs = await PayrollReadService.listPayrollPayments(id);

    res.json(txs);
  } catch (err) {
    logger.error({ message: 'Error fetching payroll payments', error: err });
    throw err;
  }
}));

// GET /api/piecework/personnel/:id/advance-balance — V4.0.33: استعلام سیستمی مانده مساعده تسویه‌نشده پرسنل
router.get('/piecework/personnel/:id/advance-balance', authorizePermission(...READ_PERMISSIONS.payrolls), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const balance = await PayrollPaymentService.getPersonnelAdvanceBalance(id);
    res.json(balance);
  } catch (err) {
    logger.error({ message: 'Error getting personnel advance balance', error: err });
    throw err;
  }
}));

// POST /api/piecework/payrolls/:id/sync-voucher - Explicitly sync accounting journal voucher for payroll
router.post('/piecework/payrolls/:id/sync-voucher', authorizePermission('piecework.payroll', 'personnel.manage'), idempotency({ scope: 'payroll' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await PieceworkPayrollService.syncPayrollVoucher(id, {
      userId: req.user?.id,
      username: req.user?.username || 'سیستم'
    });

    if (result.error || !result.voucher || !result.payroll) {
      return res.status(result.status || 400).json({ error: result.error || 'خطا در ثبت سند فیش حقوقی' });
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
}));

// DELETE /api/piecework/payrolls/:id - Cancel/delete payroll and un-link logs
router.delete('/piecework/payrolls/:id', authorize('personnel.manage', 'admin'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const deletedPayroll = await PieceworkPayrollService.deletePayroll(id, {
    userId: req.user?.id,
    username: req.user?.username || 'سیستم',
    reason: `ابطال و حذف فیش حقوقی توسط کاربر`
  });

  await logActivity({
    userId: req.user?.id,
    username: req.user?.username || 'سیستم',
    action: 'DELETE',
    entity: 'فیش حقوقی',
    entityId: id,
    description: `ابطال و حذف فیش حقوقی ${deletedPayroll?.payrollNumber || id}`
  });

  res.json({ status: 'ok', message: 'فیش حقوقی با موفقیت باطل شد', payroll: deletedPayroll });
}));

export default router;
