import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { warehouses } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';

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
  } catch(err: any) { throw err; }
});

router.post('/warehouses', authorize('admin'), validate(createWarehouseValidation), async (req, res) => {
  try {
    const { name, code } = req.body;
    const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!cleanCode) {
      return res.status(400).json({ error: 'کد انبار نامعتبر است' });
    }

    const [info] = await orm.insert(warehouses).values({ name, code: cleanCode, isActive: 1 }).returning({ id: warehouses.id });
    res.json({ id: info.id, name, code: cleanCode, is_active: 1 });
  } catch(err: any) { 
    logger.error({ message: 'POST /warehouses ERROR', error: err });
    throw err; 
  }
});

router.put('/warehouses/:id', authorize('admin'), validate(updateWarehouseValidation), async (req, res) => {
  try {
    const { name } = req.body;
    await orm.update(warehouses).set({ name }).where(eq(warehouses.id, Number(req.params.id)));
    res.json({ success: true });
  } catch(err: any) { throw err; }
});

router.delete('/warehouses/:id', authorize('admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    await orm.update(warehouses).set({ isActive: 0 }).where(eq(warehouses.id, Number(req.params.id)));
    res.json({ success: true });
  } catch(err: any) { throw err; }
});

export default router;
