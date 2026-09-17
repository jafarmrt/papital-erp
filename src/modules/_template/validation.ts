import { z } from 'zod';
import { numericIdString } from '../../middleware/validate.js';

/**
 * 📦 Module Template Runtime Validation Schemas (Zod)
 * 
 * اصول الزامی اعتبارسنجی زمان اجرا:
 * 1. مقادیر عددی و مبالغ نامنفی با .nonnegative() و .finite()
 * 2. محدودسازی سقف صفحه‌بندی (حداکثر ۱۰۰ رکورد)
 * 3. اعتبارسنجی مقادیر اختیاری به همراه پاک‌سازی و تریم فیلدهای متنی
 */

export const templateStatusEnum = z.enum(['draft', 'active', 'archived']);

export const createTemplateBodySchema = z.object({
  code: z.string().trim().max(50, 'کد نمی‌تواند بیش از ۵۰ کاراکتر باشد').optional(),
  title: z.string().trim().min(2, 'عنوان باید حداقل ۲ کاراکتر باشد').max(200, 'عنوان نمی‌تواند بیش از ۲۰۰ کاراکتر باشد'),
  status: templateStatusEnum.optional().default('draft'),
  amount: z.number().finite().nonnegative('مبلغ نمی‌تواند منفی باشد').optional().default(0),
  quantity: z.number().finite().nonnegative('تعداد نمی‌تواند منفی باشد').optional().default(0),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  notes: z.string().trim().max(1000, 'توضیحات نمی‌تواند بیش از ۱۰۰۰ کاراکتر باشد').optional(),
});

export const updateTemplateBodySchema = z.object({
  title: z.string().trim().min(2, 'عنوان باید حداقل ۲ کاراکتر باشد').max(200).optional(),
  status: templateStatusEnum.optional(),
  amount: z.number().finite().nonnegative('مبلغ نمی‌تواند منفی باشد').optional(),
  quantity: z.number().finite().nonnegative('تعداد نمی‌تواند منفی باشد').optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().max(1000).optional(),
  version: z.number().int().positive().optional(),
});

export const templateQueryFilterSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100, 'حداکثر سقف صفحه‌بندی ۱۰۰ رکورد است').optional().default(20),
    search: z.string().trim().max(100).optional(),
    status: templateStatusEnum.optional(),
    sortBy: z.enum(['createdAt', 'title', 'amount']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  })
});

export const createTemplateValidation = z.object({
  body: createTemplateBodySchema,
});

export const updateTemplateValidation = z.object({
  params: z.object({
    id: numericIdString,
  }),
  body: updateTemplateBodySchema,
});

export const getTemplateByIdValidation = z.object({
  params: z.object({
    id: numericIdString,
  }),
});
