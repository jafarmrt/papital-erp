import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can, requirePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { PayrollPaymentService } from '../services/accounting/payrollPayment.service.js';
import { PayrollPaymentVoidService } from '../services/accounting/payrollPaymentVoid.service.js';
import { PieceworkService, PieceworkReadService, PayrollReadService, PieceworkPayrollService } from '../services/piecework.service.js';
import { z } from 'zod';
import { pieceworkCategoryParamSchema, pieceworkTaskImportSchema } from './importRows.schemas.js';
import { validate, paramsIdSchema, numericIdString, decimalInput, storageDateParam } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { canAccessSensitivePayrollData, sanitizePayrollRecord } from '../lib/piiMasker.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { PIECEWORK_LOG_PERMISSION, PIECEWORK_PAY_PERMISSION, PIECEWORK_PAYROLL_APPROVE_PERMISSION, PIECEWORK_PAYROLL_PERMISSION, PIECEWORK_TASKS_PERMISSION } from '../lib/permissions/pieceworkPermissions.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/customErrors.js';
import { fin } from '../lib/financialDecimal.js';
import { parseWorkQuantity } from '../lib/piecework/workQuantity.js';
import { WORK_LOG_PAGE_SIZE } from '../lib/piecework/workLogList.js';
import { parsePagination } from '../lib/pagination.js';
import { PREPAYMENT_REASON_MAX } from '../lib/payroll/payrollPeriod.js';
import { STATUTORY_OVERRIDE_REASON_MAX } from '../lib/payroll/statutoryDeductions.js';
import { payrollAmountText } from '../lib/payroll/payrollCurrency.js';
import { editDraftPayroll } from '../services/piecework/payrollDraftEdit.js';
import { pageWorkLogs, workLogSummary } from '../services/piecework/workLogList.js';

const router = Router();

router.use(authenticateToken);

/**
 * v9.0.266 (TD-804، تصمیم ت۱ الف): پاداش، کسورات و کسر مساعده فیش نامنفی‌اند. پیش‌تر `decimalInput` منفی را می‌پذیرفت و
 * کسورات «-100000» خالص فیش را بالا می‌برد بی آنکه سند حسابداری آن را ببیند.
 * v9.0.279 (TD-813): نرخ پایه عنوان کار هم (پیش‌تر «abc» صفر و «-1000» منفی ذخیره می‌شد).
 */
const nonNegativeAmount = (label: string) =>
  decimalInput(label).refine(v => v === undefined || !fin(v).isNegative(), `${label} نمی‌تواند منفی باشد`);

const createPieceworkTaskSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    title: z.string().min(1, 'عنوان کاری کارمزدی الزامی است'),
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
    title: z.string().min(1, 'عنوان کاری کارمزدی الزامی است').optional(),
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
 * v9.0.280 (TD-812): شناسه‌ها عدد صحیح مثبت (عدد یا رشته)، مقدار بزرگ‌تر از صفر یا «ساعت:دقیقه» و نرخ دستی نامنفی است.
 * پیش‌تر «-5» با مبلغ منفی و «abc» صفر ذخیره می‌شد. سرویس همین را دوباره می‌سنجد (۴۲۲) و پرسنل، کار و پروژه زنده را می‌خواهد.
 */
const bodyId = (label: string) => z.union([z.number(), z.string()]).refine(v => /^[1-9]\d*$/.test(String(v).trim()), `${label} باید عدد صحیح مثبت باشد`);

// v9.0.284 (TD-809): شناسه‌ها عدد صحیح مثبت و نرخ اختصاصی نامنفی و الزامی (پیش‌تر «-50000» و پرسنل ۹۸۷۶۵۴ پذیرفته شد)
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
  // v9.0.281 (TD-735): ردیف برنامه کارگاه پروژه؛ نرخ چنین کارکردی را سرور می‌دهد
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

/**
 * v9.0.330 (TD-811، B12P-08): فیلترهای فهرست کارکرد در SQL. `page` که بیاید یک صفحه با شمار و جمع همه منطبق‌ها
 * برمی‌گردد (صفحه کارمزدی)؛ بی آن همه منطبق‌ها، مثل پیش (کارکردهای یک پروژه، پیش‌نمایش صدور فیش).
 */
const listPieceworkLogsSchema = z.object({
  query: z.object({
    personnelId: z.string().trim().regex(/^(all|[1-9]\d*)$/i, 'پرسنل فیلتر باید شناسه عددی یا «all» باشد').optional(),
    projectId: z.string().trim().regex(/^(all|none|[1-9]\d*)$/i, 'پروژه فیلتر باید شناسه عددی، «none» یا «all» باشد').optional(),
    status: z.string().trim().max(30).optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    search: z.string().max(100, 'عبارت جست‌وجو حداکثر ۱۰۰ نویسه است').optional(),
    page: z.string().regex(/^[1-9]\d*$/, 'شماره صفحه باید عدد صحیح مثبت باشد').optional(),
    limit: z.string().regex(/^[1-9]\d*$/, 'اندازه صفحه باید عدد صحیح مثبت باشد').optional(),
  }).passthrough(),
}).passthrough();

type ListPieceworkLogsQuery = z.infer<typeof listPieceworkLogsSchema>['query'];

const statutoryFields = {
  employeeInsurance: nonNegativeAmount('بیمه سهم کارگر').optional(),
  employerInsurance: nonNegativeAmount('بیمه سهم کارفرما').optional(),
  incomeTax: nonNegativeAmount('مالیات حقوق').optional(),
  statutoryOverrideReason: z.string().max(STATUTORY_OVERRIDE_REASON_MAX, 'شرح تغییر بیمه و مالیات حداکثر ۵۰۰ نویسه است').optional(),
};

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
    // v9.0.329 (TD-861): شرح «سایر کسورات»؛ با کسورات بالای صفر الزامی است (سرویس، ۴۲۲)
    deductionsDescription: z.string().max(500, 'شرح سایر کسورات حداکثر ۵۰۰ نویسه است').optional(),
    advanceDeduction: nonNegativeAmount('کسر مساعده').optional(),
    notes: z.string().optional(),
    // v10.0.199 (TD-1085): فیش پیش‌پرداخت دوره آینده با دلیل الزامی (سرویس، ۴۲۲)
    isPrepayment: z.boolean().optional(),
    prepaymentReason: z.string().max(PREPAYMENT_REASON_MAX, 'دلیل فیش پیش‌پرداخت حداکثر ۵۰۰ نویسه است').optional(),
    // v10.0.210 (TD-1087): کسورات قانونی؛ نفرستاده = پیشنهاد سرور، مبلغ دیگر با شرح (سرویس، ۴۲۲)
    ...statutoryFields,
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
router.post('/piecework/tasks', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(createPieceworkTaskSchema), asyncHandler(async (req, res) => {
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
    }, undefined, { req });

    res.status(201).json(newTask);
  } catch (err) {
    logger.error({ message: 'Error creating piecework task', error: err });
    throw err;
  }
}));

// POST /api/piecework/tasks/import-excel - Bulk import piecework tasks
router.post('/piecework/tasks/import-excel', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(pieceworkTaskImportSchema), asyncHandler(async (req, res) => {
  try {
    const { rows, mode = 'upsert' } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestError('لیست ردیف‌های واردات اکسل خالی است');
    }

    const result = await PieceworkService.importTasksFromExcel({
      rows,
      mode,
      userId: req.user?.id,
      username: req.user?.username
    }, undefined, { req });

    // v9.0.279 (TD-813): ردیف‌های ثبت‌نشده (نرخ متن یا منفی) با شماره ردیف و دلیل در `errors`
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
router.post(['/piecework/tasks/clear-defaults', '/piecework/tasks/clear-all'], requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), asyncHandler(async (req, res) => {
  try {
    const count = await PieceworkService.clearAllTasks({
      userId: req.user?.id,
      username: req.user?.username
    }, undefined, { req });

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
router.put('/piecework/tasks/:id', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(updatePieceworkTaskSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { code, title, category, defaultRate, unit, description, isActive } = req.body;

    // OBS-R2-50: the edit, its rate history row and its audit row are one transaction in the service
    await PieceworkService.updateTask(id, {
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
    }, undefined, { req });

    res.json({ status: 'ok', message: 'عنوان کاری با موفقیت به‌روزرسانی شد' });
  } catch (err) {
    logger.error({ message: 'Error updating piecework task', error: err });
    throw err;
  }
}));

// DELETE /api/piecework/tasks/:id
router.delete('/piecework/tasks/:id', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    await PieceworkService.deleteTask(id, {
      userId: req.user?.id,
      username: req.user?.username
    }, undefined, { req });

    res.json({ status: 'ok', message: 'عنوان کاری حذف شد' });
  } catch (err) {
    logger.error({ message: 'Error deleting piecework task', error: err });
    throw err;
  }
}));

// POST /api/piecework/tasks/:id/restore - Restore an archived/deleted task
router.post('/piecework/tasks/:id/restore', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    await PieceworkService.restoreTask(id, {
      userId: req.user?.id,
      username: req.user?.username
    }, undefined, { req });

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
router.post('/piecework/categories', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(createTaskCategorySchema), asyncHandler(async (req, res) => {
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
router.put('/piecework/categories/:id', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(updateTaskCategorySchema), asyncHandler(async (req, res) => {
  try {
    const rawId = String(req.params.id);
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
router.delete('/piecework/categories/:id', requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(pieceworkCategoryParamSchema), asyncHandler(async (req, res) => {
  try {
    const rawId = String(req.params.id);
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
    // Pass the error on to the global errorHandler, which answers with the trace id
    throw err;
  }
}));

// POST /api/piecework/personnel-rates - Set or update custom rate
router.post(['/piecework/personnel-rates', '/piecework/rates'], requirePermission(PIECEWORK_TASKS_PERMISSION), idempotency({ scope: 'piecework' }), validate(setPersonnelRateSchema), asyncHandler(async (req, res) => {
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
router.get('/piecework/logs', authorizePermission(...READ_PERMISSIONS.pieceworkLogs, ...READ_PERMISSIONS.projectPieceworkLogs), validate(listPieceworkLogsSchema), asyncHandler(async (req, res) => {
  const { personnelId, projectId, startDate, endDate, status, search, page } = req.query as ListPieceworkLogsQuery;
  if (!(await can(req.user, ...READ_PERMISSIONS.pieceworkLogs))) {
    const projId = Number(projectId);
    if (!Number.isInteger(projId) || projId <= 0) {
      throw new ForbiddenError('کارکرد همه پرسنل مجوز کارمزدی را می‌خواهد؛ مشاهده پروژه فقط کارکردهای یک پروژه را نشان می‌دهد.', undefined, 'PIECEWORK_LOGS_PROJECT_ONLY');
    }
  }
  const filters = { personnelId, projectId, startDate, endDate, status, search };
  try {
    if (page !== undefined) {
      const paging = parsePagination(req.query as Record<string, unknown>, { limit: WORK_LOG_PAGE_SIZE });
      return res.json(await pageWorkLogs(filters, paging.page, Math.max(1, paging.limit)));
    }
    res.json(await PieceworkReadService.listWorkLogs(filters));
  } catch (err) {
    logger.error({ message: 'Error fetching piecework logs', error: err });
    throw err;
  }
}));

// GET /api/piecework/logs/summary - v9.0.330 (TD-811): کارت‌های صفحه و «هزینه پروژه‌ها»، جمع SQL روی همه کارکردهای زنده
router.get('/piecework/logs/summary', authorizePermission(...READ_PERMISSIONS.pieceworkLogs), asyncHandler(async (_req, res) => {
  res.json(await workLogSummary());
}));

// POST /api/piecework/logs - Record work logs (Supports single or batch array)
// حوزه H (TD-300): ثبت کارکرد مبلغ فیش را می‌سازد؛ مجوزش «ثبت کارکرد پرسنل» است نه «ثبت گزارش کار روزانه»
router.post('/piecework/logs', requirePermission(PIECEWORK_LOG_PERMISSION), idempotency({ scope: 'piecework' }), validate(createPieceworkLogsSchema), asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';

    const items = Array.isArray(req.body.items) ? req.body.items : [req.body];
    // حوزه H (TD-300، گزینه پیشنهادی «نرخ از سرور»): نرخ دستی فقط برای مدیر تعرفه‌ها؛ دیگران نرخ اختصاصی پرسنل یا نرخ
    // پایه عنوان کار را می‌گیرند (logWorkEntries با نرخ خالی همین را می‌خواند). v9.0.320 (TD-805): «مدیریت کامل پرسنل» دیگر نه
    const canSetRate = await can(req.user, PIECEWORK_TASKS_PERMISSION);

    if (items.length === 0) {
      throw new BadRequestError('حداقل یک ردیف کارکرد انتخاب کنید');
    }

    const insertedIds = await PieceworkService.logWorkEntries(
      items.map((item: PieceworkLogItemInput) => ({
        ...item,
        unitRate: canSetRate ? item.unitRate : undefined,
        createdById: currentUserId,
        createdByUsername: currentUsername
      })),
      undefined,
      // v9.0.285 (TD-810): یک ردیف ممیزی برای هر کارکرد در تراکنش ثبت، با کاربر و IP
      { req }
    );

    res.status(201).json({ status: 'ok', insertedCount: insertedIds.length, insertedIds });
  } catch (err) {
    logger.error({ message: 'Error logging piecework', error: err });
    throw err;
  }
}));

// PUT /api/piecework/logs/:id - Update work log
router.put('/piecework/logs/:id', requirePermission(PIECEWORK_LOG_PERMISSION), idempotency({ scope: 'piecework' }), validate(updatePieceworkLogSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { date, quantity, unitRate, notes, projectId } = req.body;
    // v9.0.320 (TD-805): ویرایش کارکرد با «ثبت و ویرایش کارکرد» است، ولی نرخ دستی همان قاعده ثبت را دارد: بی مدیریت تعرفه‌ها
    // نرخ کارکرد همان که بود می‌ماند (پیش‌تر ویرایش فقط برای «مدیریت کامل پرسنل» بود که نرخ را آزادانه عوض می‌کرد)
    const canSetRate = await can(req.user, PIECEWORK_TASKS_PERMISSION);

    await PieceworkService.updateWorkLog(id, { date, quantity, unitRate: canSetRate ? unitRate : undefined, notes, projectId }, undefined, { req });

    res.json({ status: 'ok', message: 'کارکرد ویرایش شد' });
  } catch (err) {
    logger.error({ message: 'Error updating piecework log', error: err });
    throw err;
  }
}));

// DELETE /api/piecework/logs/:id - Delete work log
router.delete('/piecework/logs/:id', requirePermission(PIECEWORK_LOG_PERMISSION), idempotency({ scope: 'piecework' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
      throw new NotFoundError('فیش حقوقی یافت نشد');
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
    // Pass the error on to the global errorHandler, which answers with the trace id
    throw err;
  }
}));

// POST /api/piecework/payrolls - Generate new payroll for personnel
router.post(['/piecework/payrolls', '/piecework/payrolls/generate'], requirePermission(PIECEWORK_PAYROLL_PERMISSION), idempotency({ scope: 'payroll' }), validate(generatePieceworkPayrollSchema), asyncHandler(async (req, res) => {
  try {
    const currentUserId = req.user?.id;
    const currentUsername = req.user?.username || 'سیستم';
    const { personnelId, startDate, endDate, title, bonuses, totalBonuses, deductions, totalDeductions, deductionsDescription, advanceDeduction: reqAdvanceDeduction, notes, isPrepayment, prepaymentReason,
      employeeInsurance, employerInsurance, incomeTax, statutoryOverrideReason } = req.body;

    const result = await PieceworkPayrollService.generatePayroll({
      personnelId,
      startDate,
      endDate,
      title,
      bonuses,
      totalBonuses,
      deductions,
      totalDeductions,
      deductionsDescription,
      advanceDeduction: reqAdvanceDeduction,
      notes,
      isPrepayment,
      prepaymentReason,
      employeeInsurance,
      employerInsurance,
      incomeTax,
      statutoryOverrideReason,
      userId: currentUserId,
      username: currentUsername,
      // v9.0.285 (TD-810): ردیف ممیزی با جزئیات و IP در تراکنش صدور نوشته می‌شود
      req
    });

    if (result.error || !result.payroll) {
      return res.status(result.status || 400).json({ error: result.error || 'خطا در صدور فیش حقوقی' });
    }

    const { payroll, voucher } = result;

    res.status(201).json({
      ...payroll,
      statutoryWarning: result.statutoryWarning ?? null,
      eidiWarning: result.eidiWarning ?? null,
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
// v10.0.193 (TD-1083، طرح حقوق ت۱ الف): تغییر وضعیت (تأیید و بازگشت به پیش‌نویس) «تأیید فیش حقوق» را می‌خواهد و یادداشت
// تنها «محاسبه و صدور فیش حقوقی» را؛ پیش‌تر صادرکننده با همان کلید صدور، فیش خودش را تأیید هم می‌کرد.
router.put('/piecework/payrolls/:id/status', requirePermission(PIECEWORK_PAYROLL_PERMISSION, PIECEWORK_PAYROLL_APPROVE_PERMISSION), idempotency({ scope: 'piecework' }), validate(updatePieceworkPayrollStatusSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, notes } = req.body;
    const changesStatus = status !== undefined && String(status).trim() !== '';
    if (changesStatus && !(await can(req.user, PIECEWORK_PAYROLL_APPROVE_PERMISSION))) {
      throw new ForbiddenError('تأیید فیش یا بازگرداندن آن به پیش‌نویس مجوز «تأیید فیش حقوق» را می‌خواهد.', undefined, 'PAYROLL_APPROVE_PERMISSION_REQUIRED');
    }
    if (!changesStatus && !(await can(req.user, PIECEWORK_PAYROLL_PERMISSION))) {
      throw new ForbiddenError('ویرایش یادداشت فیش مجوز «محاسبه و صدور فیش حقوقی» را می‌خواهد.', undefined, 'PAYROLL_PERMISSION_REQUIRED');
    }

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

// v10.0.200 (TD-1242، طرح حقوق §۳.۱ بند ۳): ویرایش فیش پیش‌نویس (عنوان، پاداش، کسورات و شرحش، کسر مساعده) و ساخت دوباره سند پیش‌نویس آن
const editDraftPayrollSchema = z.object({
  params: paramsIdSchema.shape.params,
  body: z.object({
    title: z.string().max(300, 'عنوان فیش حداکثر ۳۰۰ نویسه است').optional(),
    bonuses: nonNegativeAmount('پاداش').optional(),
    deductions: nonNegativeAmount('کسورات').optional(),
    deductionsDescription: z.string().max(500, 'شرح سایر کسورات حداکثر ۵۰۰ نویسه است').optional(),
    advanceDeduction: nonNegativeAmount('کسر مساعده').optional(),
    // v10.0.210 (TD-1087): کسورات قانونی فیش پیش‌نویس با همان قاعده صدور
    ...statutoryFields,
  }).strict(),
});

router.put('/piecework/payrolls/:id', requirePermission(PIECEWORK_PAYROLL_PERMISSION), idempotency({ scope: 'piecework' }), validate(editDraftPayrollSchema), asyncHandler(async (req, res) => {
  const { payroll, voucher, statutoryWarning } = await editDraftPayroll(Number(req.params.id), {
    ...req.body,
    userId: req.user?.id,
    username: req.user?.username || 'سیستم',
    req,
  });
  res.json({ ...payroll, voucherId: voucher?.id ?? null, voucherNumber: voucher?.voucherNumber ?? null, statutoryWarning });
}));

// POST /api/piecework/payrolls/:id/register-payment — V10-4.4: مسیر یگانه پرداخت حقوق
router.post('/piecework/payrolls/:id/register-payment', requirePermission(PIECEWORK_PAY_PERMISSION), idempotency({ scope: 'payroll' }), validate(registerPayrollPaymentSchema), asyncHandler(async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { bankAccountId, method, amount, paymentDate, paymentReference, notes } = req.body;

    const result = await PayrollPaymentService.registerPayrollPayment({
      payrollId: id,
      bankAccountId: Number(bankAccountId),
      method,
      // OBS-R2-51: the exact decimal string of `decimalInput`; `Number()` dropped digits past the 15th
      amount,
      paymentDate,
      paymentReference,
      notes,
      userId: req.user?.id,
      username: req.user?.username || 'سیستم',
      // v10.0.259 (TD-950): ممیزی پرداخت در تراکنش سرویس، با کاربر و IP
      req,
    });

    res.json({
      success: true,
      message: result.isFullyPaid
        ? `پرداخت فیش ${result.payroll.payrollNumber} با موفقیت تسویه کامل شد؛ تراکنش خزانه ${result.transactionNumber} و سند تسویه صادر گردید.`
        : `پرداخت مرحله‌ای فیش ${result.payroll.payrollNumber} ثبت شد (مانده: ${payrollAmountText(result.remainingAmount, result.currency)})؛ تراکنش خزانه ${result.transactionNumber} صادر گردید.`,
      ...result
    });
  } catch (err) {
    logger.error({ message: 'Error registering payroll payment', error: err });
    throw err;
  }
}));

// POST /api/piecework/payrolls/:id/payments/:transactionId/void — v8.0.31 (TD-283، تصمیم مالک محصول): ابطال یک پرداخت فیش
router.post('/piecework/payrolls/:id/payments/:transactionId/void', requirePermission(PIECEWORK_PAY_PERMISSION), idempotency({ scope: 'payroll' }), validate(voidPayrollPaymentSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await PayrollPaymentVoidService.voidPayrollPayment({
    payrollId: id,
    transactionId: Number(req.params.transactionId),
    reason: String(req.body.reason),
    userId: req.user?.id,
    username: req.user?.username || 'سیستم',
    // v10.0.259 (TD-950): ممیزی ابطال در تراکنش سرویس، با کاربر و IP و مبلغ
    req,
  });

  res.json({
    success: true,
    message: `پرداخت ${result.transactionNumber} فیش ${result.payroll.payrollNumber} ابطال شد؛ مبلغ پرداخت‌شده فیش اکنون ${payrollAmountText(result.paidAmount, result.currency)} است.`,
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
router.post('/piecework/payrolls/:id/sync-voucher', requirePermission(PIECEWORK_PAYROLL_PERMISSION), idempotency({ scope: 'payroll' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
router.delete('/piecework/payrolls/:id', requirePermission(PIECEWORK_PAYROLL_PERMISSION), idempotency({ scope: 'piecework' }), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
