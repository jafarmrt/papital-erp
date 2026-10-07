import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { categories, items } from '../db/schema.js';
import { DEFAULT_CATEGORIES } from '../data/defaultCategories.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, requireSystemAdmin } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, ValidationError } from '../errors/customErrors.js';

const router = Router();
router.use(authenticateToken);

const categorySchema = z.object({
  name: z.string().min(1, 'نام الزامی است').max(100),
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
router.get('/categories', asyncHandler(async (req, res) => {
  const data = await orm.select().from(categories).orderBy(categories.type, categories.id);
  res.json(data.map(formatCategory));
}));

router.post('/categories/reset-defaults', requireSystemAdmin, asyncHandler(async (req, res) => {
  const existingCatRows = await orm.select().from(categories);
  const existingCatMap = new Map(existingCatRows.map(c => [c.name, c]));

  // v9.0.134 (TD-526): همان فهرست یکتای seed (`src/data/defaultCategories.ts`)
  for (const cat of DEFAULT_CATEGORIES) {
    const existing = existingCatMap.get(cat.name);
    if (existing) {
      await orm.update(categories).set({
        prefix: cat.prefix,
        type: cat.type,
        defaultUnit: cat.defaultUnit
      }).where(eq(categories.id, existing.id));
    } else {
      await orm.insert(categories).values(cat);
    }
  }

  const updated = await orm.select().from(categories).orderBy(categories.type, categories.id);
  res.json(updated.map(formatCategory));
}));

router.post('/categories', authorizePermission('products.create', 'products.edit'), validate(createCategoryValidation), asyncHandler(async (req, res) => {
  const { name, prefix, type, defaultUnit } = req.body;
  const [info] = await orm.insert(categories).values({ name, prefix, type, defaultUnit: defaultUnit || 'عدد' }).returning({ id: categories.id });
  res.json(formatCategory({ id: info.id, name, prefix, type, defaultUnit: defaultUnit || 'عدد' }));
}));

router.put('/categories/:id', authorizePermission('products.edit'), validate(updateCategoryValidation), asyncHandler(async (req, res) => {
  const { name, prefix, type, defaultUnit } = req.body;
  await orm.update(categories).set({ name, prefix, type, defaultUnit: defaultUnit || 'عدد' }).where(eq(categories.id, Number(req.params.id)));
  res.json({ success: true });
}));

router.delete('/categories/:id', authorizePermission('products.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const catId = Number(req.params.id);
  const [cat] = await orm.select().from(categories).where(eq(categories.id, catId));
  if (!cat) {
    throw new NotFoundError('دسته بندی مورد نظر یافت نشد.');
  }

  const [hasItems] = await orm.select({ id: items.id }).from(items).where(
    and(
      eq(items.category, cat.name),
      eq(items.isDeleted, 0)
    )
  );

  if (hasItems) {
    throw new ValidationError('امکان حذف این دسته بندی وجود ندارد؛ زیرا کالاهای فعال در سیستم به آن ارجاع داده‌اند.');
  }

  await orm.delete(categories).where(eq(categories.id, catId));
  res.json({ success: true });
}));

export default router;
