import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { categories, items } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { NotFoundError, ValidationError } from '../errors/customErrors.js';
import { ItemCatalogService } from '../services/items/itemCatalog.service.js';

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

export const defaultCategories = [
  // محصولات نهایی (product)
  { name: 'گردنبند', prefix: 'N', type: 'product', defaultUnit: 'عدد' },
  { name: 'گوشواره میخی', prefix: 'S', type: 'product', defaultUnit: 'جفت' },
  { name: 'گوشواره آویز', prefix: 'E', type: 'product', defaultUnit: 'جفت' },
  { name: 'انگشتر', prefix: 'R', type: 'product', defaultUnit: 'عدد' },
  { name: 'دستبند', prefix: 'B', type: 'product', defaultUnit: 'عدد' },
  { name: 'گوشواره آویز بزرگ', prefix: 'N', type: 'product', defaultUnit: 'جفت' },
  { name: 'گردنبند بزرگ', prefix: 'N', type: 'product', defaultUnit: 'عدد' },
  { name: 'گوشواره دو تکه', prefix: 'N', type: 'product', defaultUnit: 'عدد' },
  { name: 'گردنبند دو تکه', prefix: 'N', type: 'product', defaultUnit: 'عدد' },

  // مواد اولیه (raw_material)
  { name: 'ترنسفر', prefix: 'T-', type: 'raw_material', defaultUnit: 'برگ' },
  { name: 'مهره', prefix: 'B-', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'مهره کریستالی', prefix: 'B-C-', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'سنگ', prefix: 'S-', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'مهره حدید', prefix: 'B-H-', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'مهره چوبی', prefix: 'B-W-', type: 'raw_material', defaultUnit: 'ریسه' },
  { name: 'خرج کار', prefix: 'M-', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'خرج کار طلایی', prefix: 'M-G-', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'خرج کار برنزی', prefix: 'M-B-', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'خرج کار استیل', prefix: 'M-M-', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'بند چرمی و زنجیر', prefix: 'C-', type: 'raw_material', defaultUnit: 'متر' },
  { name: 'کیلر، رنگ، گلیز', prefix: 'G-', type: 'raw_material', defaultUnit: 'عدد' },
  { name: 'سایر اقلام', prefix: 'O-', type: 'raw_material', defaultUnit: 'عدد' }
];

router.get('/categories', asyncHandler(async (req, res) => {
  let data = await orm.select().from(categories).orderBy(categories.type, categories.id);
  if (data.length === 0) {
    await orm.insert(categories).values(defaultCategories);
    data = await orm.select().from(categories).orderBy(categories.type, categories.id);
  }
  res.json(data.map(formatCategory));
}));

router.post('/categories/reset-defaults', authorize('admin'), asyncHandler(async (req, res) => {
  const existingCatRows = await orm.select().from(categories);
  const existingCatMap = new Map(existingCatRows.map(c => [c.name, c]));

  for (const cat of defaultCategories) {
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

router.post('/categories', authorize('admin', 'manager', 'products.create', 'products.edit'), validate(createCategoryValidation), asyncHandler(async (req, res) => {
  const { name, prefix, type, defaultUnit } = req.body;
  const [info] = await orm.insert(categories).values({ name, prefix, type, defaultUnit: defaultUnit || 'عدد' }).returning({ id: categories.id });
  res.json(formatCategory({ id: info.id, name, prefix, type, defaultUnit: defaultUnit || 'عدد' }));
}));

router.put('/categories/:id', authorize('admin', 'manager', 'products.edit'), validate(updateCategoryValidation), asyncHandler(async (req, res) => {
  const { name, prefix, type, defaultUnit } = req.body;
  await orm.update(categories).set({ name, prefix, type, defaultUnit: defaultUnit || 'عدد' }).where(eq(categories.id, Number(req.params.id)));
  res.json({ success: true });
}));

router.delete('/categories/:id', authorize('admin', 'products.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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

router.get('/categories/next-code', asyncHandler(async (req, res) => {
  const { prefix } = req.query as Record<string, string>;
  if (!prefix) return res.json({ nextCode: '' });

  // V10-2.1: مسیر یتیم به سرویس اتمیک next-code متصل شد (حذف الگوی ممنوع MAX()+1 / DB-001)
  const result = await ItemCatalogService.peekNextItemCode({ type: 'raw_material', prefix });
  res.json({ nextCode: result.code });
}));

export default router;
