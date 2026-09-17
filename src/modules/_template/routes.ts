import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { idempotency } from '../../middleware/idempotency.js';
import { TemplateService } from './service.js';
import {
  createTemplateValidation,
  updateTemplateValidation,
  getTemplateByIdValidation,
  templateQueryFilterSchema,
} from './validation.js';
import type { TemplateEntity } from './types.js';

/**
 * 📦 Module Template Express Router
 * 
 * استانداردهای الزامی روت‌های سامانه نسخه ۴:
 * 1. استفاده از authenticateToken برای کلیه مسیرهای نیازمند احراز هویت
 * 2. کنترل دسترسی سطحی با authorize('admin', 'manager', ...)
 * 3. اعتبارسنجی ورودی‌ها با validate(schema) و جایگزینی داده‌های تمیز در req
 * 4. استفاده از میدل‌ور idempotency برای مسیرهای حساس به ارسال مجدد
 * 5. کپسوله‌سازی خطاها با asyncHandler
 * 6. فرمت‌بندی دوگانه (Dual Field Formatting: camelCase و snake_case) در خروجی JSON
 */

const router = Router();

// فعال‌سازی احراز هویت برای تمام اندپوینت‌های این ماژول
router.use(authenticateToken);

/**
 * هلپر فرمت‌بندی دوگانه خروجی جهت سازگاری کامل با کامپوننت‌های کلاینت
 */
const formatTemplateEntity = (item: TemplateEntity) => ({
  ...item,
  is_deleted: item.isDeleted,
  created_by: item.createdBy,
  created_at: item.createdAt,
  updated_at: item.updatedAt,
});

/**
 * GET /api/template-entities
 * دریافت لیست رکوردهای ماژول با صفحه‌بندی و فیلتر
 */
router.get(
  '/',
  authorize('admin', 'manager', 'accountant', 'viewer'),
  validate(templateQueryFilterSchema),
  asyncHandler(async (req, res) => {
    const result = await TemplateService.list(req.query as any);
    res.json({
      success: true,
      data: result.data.map(formatTemplateEntity),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  })
);

/**
 * GET /api/template-entities/:id
 * دریافت تکی اطلاعات رکورد
 */
router.get(
  '/:id',
  authorize('admin', 'manager', 'accountant', 'viewer'),
  validate(getTemplateByIdValidation),
  asyncHandler(async (req, res) => {
    const entity = await TemplateService.getById(Number(req.params.id));
    res.json({
      success: true,
      data: formatTemplateEntity(entity),
    });
  })
);

/**
 * POST /api/template-entities
 * ایجاد رکورد جدید با محافظت ایدمپوتنسی
 */
router.post(
  '/',
  authorize('admin', 'manager'),
  idempotency({ scope: 'template_create', lockTimeoutSeconds: 60 }),
  validate(createTemplateValidation),
  asyncHandler(async (req, res) => {
    const user = req.user as { id?: number; username?: string };
    const created = await TemplateService.create(req.body, {
      userId: user?.id,
      username: user?.username,
      req,
    });

    res.status(201).json({
      success: true,
      data: formatTemplateEntity(created),
      message: 'رکورد با موفقیت ایجاد گردید.',
    });
  })
);

/**
 * PUT /api/template-entities/:id
 * به‌روزرسانی اطلاعات رکورد با کنترل نسخه (OCC)
 */
router.put(
  '/:id',
  authorize('admin', 'manager'),
  validate(updateTemplateValidation),
  asyncHandler(async (req, res) => {
    const user = req.user as { id?: number; username?: string };
    const updated = await TemplateService.update(Number(req.params.id), req.body, {
      userId: user?.id,
      username: user?.username,
      req,
    });

    res.json({
      success: true,
      data: formatTemplateEntity(updated),
      message: 'رکورد با موفقیت به‌روزرسانی گردید.',
    });
  })
);

/**
 * DELETE /api/template-entities/:id
 * حذف منطقی رکورد
 */
router.delete(
  '/:id',
  authorize('admin'),
  validate(getTemplateByIdValidation),
  asyncHandler(async (req, res) => {
    const user = req.user as { id?: number; username?: string };
    const result = await TemplateService.softDelete(Number(req.params.id), {
      userId: user?.id,
      username: user?.username,
      req,
    });

    res.json(result);
  })
);

export default router;
