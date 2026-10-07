import { Router } from 'express';
import { categories } from '../db/schema.js';
import {
  createCategory, deleteCategory, listActiveCategories, resetDefaultCategories, updateCategory,
} from '../services/items/itemCategory.service.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, requireSystemAdmin } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticateToken);

const categorySchema = z.object({
  name: z.string().trim().min(1, 'نام الزامی است').max(100),
  prefix: z.string().min(1, 'پیشوند الزامی است').max(10),
  type: z.enum(['product', 'raw_material']),
  defaultUnit: z.string().optional().default('عدد'),
});

const createCategoryValidation = z.object({
  body: categorySchema
});

const updateCategoryValidation = z.object({
  body: categorySchema,
  params: z.object({
    id: numericIdString
  })
});

const formatCategory = (cat: Partial<typeof categories.$inferSelect> & Record<string, unknown>) => {
  let prefix = (cat.prefix as string) || '';
  if (cat.type === 'product') {
    prefix = prefix.replace(/-+$/g, '');
  }
  return {
    ...cat,
    prefix,
    defaultUnit: cat.defaultUnit || cat.default_unit || 'عدد',
    default_unit: cat.defaultUnit || cat.default_unit || 'عدد',
  };
};

// v9.0.134 (TD-526، A02-19): خواندن فهرست دیگر چیزی نمی‌نویسد؛ نصب تازه دسته‌های استاندارد را در بوت می‌گیرد (seed)
// v9.0.204 (TD-659): فقط دسته‌های حذف‌نشده؛ نوشتن‌ها در `itemCategory.service.ts` با تراکنش و ردیف ممیزی
router.get('/categories', asyncHandler(async (req, res) => {
  const data = await listActiveCategories();
  res.json(data.map(formatCategory));
}));

router.post('/categories/reset-defaults', requireSystemAdmin, asyncHandler(async (req, res) => {
  const updated = await resetDefaultCategories(req);
  res.json(updated.map(formatCategory));
}));

router.post('/categories', authorizePermission('products.create', 'products.edit'), validate(createCategoryValidation), asyncHandler(async (req, res) => {
  const created = await createCategory(req, req.body);
  res.json(formatCategory(created));
}));

router.put('/categories/:id', authorizePermission('products.edit'), validate(updateCategoryValidation), asyncHandler(async (req, res) => {
  await updateCategory(req, Number(req.params.id), req.body);
  res.json({ success: true });
}));

router.delete('/categories/:id', authorizePermission('products.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  await deleteCategory(req, Number(req.params.id));
  res.json({ success: true });
}));

export default router;
