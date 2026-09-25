import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { warehouses } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { NotFoundError, ConflictError } from '../errors/customErrors.js';
import { logActivity } from '../lib/auditLogger.js';

const router = Router();
router.use(authenticateToken);

const warehouseSchema = z.object({
  name: z.string().min(1, 'نام انبار الزامی است').max(100),
  code: z.string().min(1, 'کد انبار الزامی است').max(50),
});

const warehouseUpdateSchema = z.object({
  name: z.string().min(1, 'نام انبار الزامی است').max(100),
});

const createWarehouseValidation = z.object({
  body: warehouseSchema
});

const updateWarehouseValidation = z.object({
  body: warehouseUpdateSchema,
  params: z.object({
    id: numericIdString
  })
});

router.get('/warehouses', async (req, res) => {
  try {
    const data = await orm.select().from(warehouses).where(eq(warehouses.isActive, 1));
    res.json(data);
  } catch (err) { throw err; }
});

router.post('/warehouses', authorize('admin'), validate(createWarehouseValidation), async (req, res) => {
  try {
    const { name, code } = req.body;
    const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanCode) {
      return res.status(400).json({ error: 'کد انبار نامعتبر است' });
    }

    const [info] = await orm.insert(warehouses).values({ name, code: cleanCode, isActive: 1 }).returning({ id: warehouses.id });
    await logActivity({
      action: 'CREATE',
      entity: 'انبار',
      entityId: info.id,
      description: `تعریف انبار جدید «${name}» با کد «${cleanCode}»`,
      details: { name, code: cleanCode },
      req
    });

    res.json({ id: info.id, name, code: cleanCode, is_active: 1 });
  } catch (err) { 
    logger.error({ message: 'POST /warehouses ERROR', error: err });
    throw err; 
  }
});

router.put('/warehouses/:id', authorize('admin'), validate(updateWarehouseValidation), async (req, res) => {
  try {
    const { name } = req.body;
    const id = Number(req.params.id);
    const [oldWh] = await orm.select().from(warehouses).where(eq(warehouses.id, id));
    if (!oldWh) throw new NotFoundError('انبار یافت نشد');

    await orm.update(warehouses).set({ name }).where(eq(warehouses.id, id));
    await logActivity({
      action: 'UPDATE',
      entity: 'انبار',
      entityId: oldWh.id,
      description: `ویرایش نام انبار کد «${oldWh.code}» از «${oldWh.name}» به «${name}»`,
      details: { before: { name: oldWh.name }, after: { name } },
      req
    });

    res.json({ success: true });
  } catch (err) { throw err; }
});

router.delete('/warehouses/:id', authorize('admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [wh] = await orm.select().from(warehouses).where(eq(warehouses.id, id));
    if (!wh) throw new NotFoundError('انبار یافت نشد');

    // TD-117: بررسی وجود موجودی کالا در انبار پیش از غیرفعال‌سازی
    const resCheck = await orm.execute(sql`
      SELECT COUNT(*)::int AS n FROM items
      WHERE is_deleted = 0 AND COALESCE((stocks->>${wh.code}::text)::numeric, 0) <> 0`);
    if (Number((resCheck.rows[0] as any)?.n) > 0) {
      throw new ConflictError(`انبار «${wh.name}» هنوز موجودی دارد؛ ابتدا موجودی را با سند انتقال خالی کنید.`);
    }

    await orm.update(warehouses).set({ isActive: 0 }).where(eq(warehouses.id, id));
    await logActivity({
      action: 'DELETE',
      entity: 'انبار',
      entityId: wh.id,
      description: `غیرفعال‌سازی انبار «${wh.name}» با کد «${wh.code}»`,
      details: { code: wh.code, name: wh.name, isActive: 0 },
      req
    });

    res.json({ success: true });
  } catch (err) { throw err; }
});

export default router;
