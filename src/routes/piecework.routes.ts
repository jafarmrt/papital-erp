import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can, userHasRoleOrPermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { PayrollPaymentService } from '../services/accounting/payrollPayment.service.js';
import { PayrollPaymentVoidService } from '../services/accounting/payrollPaymentVoid.service.js';
import { PieceworkService, PieceworkReadService, PayrollReadService, PieceworkPayrollService } from '../services/piecework.service.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString, decimalInput } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { canAccessSensitivePayrollData, sanitizePayrollRecord } from '../lib/piiMasker.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { ForbiddenError } from '../errors/customErrors.js';
import { fin } from '../lib/financialDecimal.js';
import { parseWorkQuantity } from '../lib/piecework/workQuantity.js';

const router = Router();

router.use(authenticateToken);

/**
 * v9.0.266 (TD-804، تصمیم ت۱ الف): پاداش، کسورات و کسر مساعده فیش نامنفی‌اند. پیش‌تر `decimalInput` منفی را می‌پذیرفت و
 * کسورات «-100000» خالص فیش را بالا می‌برد بی آنکه سند حسابداری آن را ببیند.
 * v9.0.270 (TD-813): نرخ پایه عنوان کار هم (پیش‌تر «abc» صفر و «-1000» منفی ذخیره می‌شد).
 */
const nonNegativeAmount = (label: string) =>
  decimalInput(label).refine(v => v === undefined || !fin(v).isNegative(), `${label} نمی‌تواند منفی باشد`);

const createPieceworkTaskSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    title: z.string().min(1, 'عنوان کاری پرکیسی الزامی است'),
    category: z.string().optional(),
    defaultRate: nonNegativeAmount('نرخ پایه').optional(),
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
    defaultRate: nonNegativeAmount('نرخ پایه').optional(),
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

/**
 * v9.0.271 (TD-812): شناسه‌ها عدد صحیح مثبت (عدد یا رشته)، مقدار بزرگ‌تر از صفر یا «ساعت:دقیقه» و نرخ دستی نامنفی است.
 * پیش‌تر «-5» با مبلغ منفی و «abc» صفر ذخیره می‌شد. سرویس همین را دوباره می‌سنجد (۴۲۲) و پرسنل، کار و پروژه زنده را می‌خواهد.
 */
const bodyId = (label: string) => z.union([z.number(), z.string()]).refine(v => /^[1-9]\d*$/.test(String(v).trim()), `${label} باید عدد صحیح مثبت باشد`);

// v9.0.275 (TD-809): شناسه‌ها عدد صحیح مثبت و نرخ اختصاصی نامنفی و الزامی (پیش‌تر «-50000» و پرسنل ۹۸۷۶۵۴ پذیرفته شد)
const setPersonnelRateSchema = z.object({
  body: z.object({
    personnelId: bodyId('شناسه پرسنل'),
    taskId: bodyId('شناسه عنوان کار'),
    customRate: nonNegativeAmount('نرخ اختصاصی').refine(v => v !== undefined, 'نرخ اختصاصی الزامی است'),
  })
});

const optionalProjectId = z.union([bodyId('شناسه پروژه'), z.null(), z.literal('')]).optional();
const workQuantityInput = z.union([z.number(), z.string()]).transform((v, ctx): number => {
  const parsed = parseWorkQuantity(v);
  if (!parsed.ok) {
    ctx.addIssue({ code: 'custom', message: parsed.message });
    return z.NEVER;
  }
  return parsed.value;
});

const pieceworkLogItemSchema = z.object({
  personnelId: bodyId('شناسه پرسنل'),
  taskId: bodyId('شناسه عنوان کار'),
  projectId: optionalProjectId,
  date: z.string().min(1, 'تاریخ کارکرد الزامی است'),
  quantity: workQuantityInput,
  unitRate: nonNegativeAmount('نرخ کارکرد').optional(),
  notes: z.string().optional(),
  // v9.0.272 (TD-735): ردیف برنامه کارگاه پروژه؛ نرخ چنین کارکردی را سرور می‌دهد
  scheduleRef: z.object({
    stageId: bodyId('شناسه مرحله').transform(Number),
    productId: z.string().trim().min(1, 'شناسه محصول ردیف برنامه الزامی است').max(200),
    rowId: z.string().trim().min(1, 'شناسه ردیف برنامه الزامی است').max(200),
  }).optional(),
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
    quantity: workQuantityInput.optional(),
    unitRate: nonNegativeAmount('نرخ کارکرد').optional(),
    notes: z.string().optional(),
    projectId: optionalProjectId,
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
    bonuses: nonNegativeAmount('پاداش').optional(),
    totalBonuses: nonNegativeAmount('پاداش').optional(),
    deductions: nonNegativeAmount('کسورات').optional(),
    totalDeductions: nonNegativeAmount('کسورات').optional(),
    advanceDeduction: nonNegativeAmount('کسر مساعده').optional(),
    notes: z.string().optional(),
  })
});

// v9.0.269 (TD-816): تاریخ، روش و شماره پیگیری پرداخت فقط از «ثبت پرداخت» (register-payment) نوشته می‌شود
const PAYMENT_FIELDS_OF_PAYROLL = ['paymentDate', 'paymentMethod', 'paymentReference'] as const;
const updatePieceworkPayrollStatusSchema = z.object({
  body: z.object({
    status: z.string().optional(),
    notes: z.string().optional(),
    paymentDate: z.unknown().optional(),
    paymentMethod: z.unknown().optional(),
    paymentReference: z.unknown().optional(),
  }).superRefine((body, ctx) => {
    for (const key of PAYMENT_FIELDS_OF_PAYROLL) {
      if (body[key] !== undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'تاریخ، روش و شماره پیگیری پرداخت فیش فقط از «ثبت پرداخت» ثبت می‌شود' });
      }
    }
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
router.post('/piecework/tasks', authorizePermission('personnel.manage'), validate(createPieceworkTaskSchema), asyncHandler(async (req, res) => {
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
router.post('/piecework/tasks/import-excel', authorizePermission('personnel.manage'), asyncHandler(async (req, res) => {
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

    // v9.0.270 (TD-813): ردیف‌های ثبت‌نشده (نرخ متن یا منفی) با شماره ردیف و دلیل در `errors`
    const skipped = result.errors.length > 0 ? ` ${result.errors.length} ردیف ثبت نشد.` : '';
    res.json({
      status: 'ok',
      message: `عملیات واردات با موفقیت انجام شد: ${result.createdCount} عنوان جدید ایجاد و ${result.updatedCount} عنوان به‌روزرسانی شدند.${skipped}`,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      totalProcessed: result.totalProcessed,
      errors: result.errors
    });
  } catch (err) {
    logger.error({ message: 'Error importing piecework tasks from excel', error: err });
    throw err;
  }
}));

// POST /api/piecework/tasks/clear-defaults or clear-all
router.post(['/piecework/tasks/clear-defaults', '/piecework/tasks/clear-all'], authorizePermission('personnel.manage'), asyncHandler(async (req, res) => {
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
router.put('/piecework/tasks/:id', authorizePermission('personnel.manage'), validate(updatePieceworkTaskSchema), asyncHandler(async (req, res) => {
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
router.delete('/piecework/tasks/:id', authorizePermission('personnel.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
router.post('/piecework/tasks/:id/restore', authorizePermission('personnel.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
router.post('/piecework/categories', authorizePermission('personnel.manage', 'settings.manage'), validate(createTaskCategorySchema), asyncHandler(async (req, res) => {
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
router.put('/piecework/categories/:id', authorizePermission('personnel.manage', 'settings.manage'), validate(updateTaskCategorySchema), asyncHandler(async (req, res) => {
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
router.delete('/piecework/categories/:id', authorizePermission('personnel.manage', 'settings.manage'), asyncHandler(async (req, res) => {
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
router.get(['/piecework/personnel-rates/:personnelId', '/piecework/rates/:personnelId'], authorizePermission(...READ_PERMISSIONS.pieceworkRates), validate(paramsPersonnelIdSchema), asyncHandler(async (req, res) => {
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
router.post(['/piecework/personnel-rates', '/piecework/rates'], authorizePermission('personnel.manage'), validate(setPersonnelRateSchema), asyncHandler(async (req, res) => {
  try {
    const { personnelId, taskId, customRate } = req.body;
    const saved = await PieceworkService.setPersonnelRate({ personnelId, taskId, customRate }, { req });
    res.json({ status: 'ok', message: saved.changed ? 'نرخ اختصاصی ثبت شد' : 'نرخ اختصاصی تغییری نکرد', id: saved.id, changed: saved.changed });
  } catch (err) {
    logger.error({ message: 'Error setting custom rate', error: err });
    throw err;
  }
}));

// ==========================================
// 3. Piecework Logs (کارکرد روزانه پرکیسی)
// ==========================================

// GET /api/piecework/logs - List work logs
// v9.0.142 (TD-892، ت۱۰ الف): کارکرد همه پرسنل فقط با مجوز کارمزدی؛ مشاهده پروژه فقط کارکردهای یک پروژه را می‌خواند
router.get('/piecework/logs', authorizePermission(...READ_PERMISSIONS.pieceworkLogs, ...READ_PERMISSIONS.projectPieceworkLogs), asyncHandler(async (req, res) => {
  const { personnelId, projectId, startDate, endDate, status } = req.query;
  if (!(await can(req.user, ...READ_PERMISSIONS.pieceworkLogs))) {
    const projId = Number(projectId);
    if (!Number.isInteger(projId) || projId <= 0) {
      throw new ForbiddenError('کارکرد همه پرسنل مجوز کارمزدی را می‌خواهد؛ مشاهده پروژه فقط کارکردهای یک پروژه را نشان می‌دهد.', undefined, 'PIECEWORK_LOGS_PROJECT_ONLY');
    }
  }
  try {
    const rows = await PieceworkReadService.listWorkLogs({ personnelId, projectId, startDate, endDate, status });

    res.json(rows);
  } catch (err) {
    logger.error({ message: 'Error fetching piecework logs', error: err });
    throw err;
  }
}));

// POST /api/piecework/logs - Record work logs (Supports single or batch array)
// حوزه H (TD-300): ثبت کارکرد مبلغ فیش را می‌سازد؛ مجوزش «ثبت کارکرد پرسنل» است نه «ثبت گزارش کار روزانه»
router.post('/piecework/logs', authorizePermission('personnel.manage', 'piecework.log'), validate(createPieceworkLogsSchema), asyncHandler(async (req, res) => {
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
      })),
      undefined,
      // v9.0.276 (TD-810): یک ردیف ممیزی برای هر کارکرد در تراکنش ثبت، با کاربر و IP
      { req }
    );

    res.status(201).json({ status: 'ok', insertedCount: insertedIds.length, insertedIds });
  } catch (err) {
    logger.error({ message: 'Error logging piecework', error: err });
    throw err;
  }
}));

// PUT /api/piecework/logs/:id - Update work log
router.put('/piecework/logs/:id', authorizePermission('personnel.manage'), validate(updatePieceworkLogSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { date, quantity, unitRate, notes, projectId } = req.body;

    await PieceworkService.updateWorkLog(id, { date, quantity, unitRate, notes, projectId }, undefined, { req });

    res.json({ status: 'ok', message: 'کارکرد ویرایش شد' });
  } catch (err) {
    logger.error({ message: 'Error updating piecework log', error: err });
    throw err;
  }
}));

// DELETE /api/piecework/logs/:id - Delete work log
router.delete('/piecework/logs/:id', authorizePermission('personnel.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    await PieceworkService.deleteWorkLog(id, undefined, { req });

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

    const canViewSensitive = await canAccessSensitivePayrollData(req.user);
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
    const canViewSensitive = await canAccessSensitivePayrollData(req.user, pay.personnelUserId);
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
router.post(['/piecework/payrolls', '/piecework/payrolls/generate'], authorizePermission('personnel.manage'), idempotency({ scope: 'payroll' }), validate(generatePieceworkPayrollSchema), asyncHandler(async (req, res) => {
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
      username: currentUsername,
      // v9.0.276 (TD-810): ردیف ممیزی با جزئیات و IP در تراکنش صدور نوشته می‌شود
      req
    });

    if (result.error || !result.payroll) {
      return res.status(result.status || 400).json({ error: result.error || 'خطا در صدور فیش حقوقی' });
    }

    const { payroll, voucher } = result;

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
router.put('/piecework/payrolls/:id/status', authorizePermission('personnel.manage'), validate(updatePieceworkPayrollStatusSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, notes } = req.body;

    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';

    const result = await PieceworkPayrollService.updatePayrollStatus(id, {
      status,
      notes,
      userId: currentUserId,
      username: currentUsername,
      req
    });

    if (result.error || !result.payroll) {
      return res.status(result.status || 400).json({ error: result.error || 'خطا در ویرایش وضعیت فیش حقوقی' });
    }

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
router.post('/piecework/payrolls/:id/register-payment', authorizePermission('personnel.manage'), idempotency({ scope: 'payroll' }), validate(registerPayrollPaymentSchema), asyncHandler(async (req, res) => {
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
router.post('/piecework/payrolls/:id/payments/:transactionId/void', authorizePermission('personnel.manage'), idempotency({ scope: 'payroll' }), validate(voidPayrollPaymentSchema), asyncHandler(async (req, res) => {
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
router.delete('/piecework/payrolls/:id', authorizePermission('personnel.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const deletedPayroll = await PieceworkPayrollService.deletePayroll(id, {
    userId: req.user?.id,
    username: req.user?.username || 'سیستم',
    reason: `ابطال و حذف فیش حقوقی توسط کاربر`,
    req
  });

  res.json({ status: 'ok', message: 'فیش حقوقی با موفقیت باطل شد', payroll: deletedPayroll });
}));

export default router;
