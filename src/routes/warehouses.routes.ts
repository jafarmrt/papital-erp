import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { logActivity } from '../lib/auditLogger.js';
import { WarehouseService } from '../services/warehouse.service.js';

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
    const data = await WarehouseService.listActive();
    res.json(data);
  } catch (err) { throw err; }
});

router.post('/warehouses', authorize('admin'), validate(createWarehouseValidation), async (req, res) => {
  try {
    const { name, code } = req.body;
    const created = await WarehouseService.createWarehouse({ name, code });

    await logActivity({
      action: 'CREATE',
      entity: 'انبار',
      entityId: created.id,
      description: `تعریف انبار جدید «${created.name}» با کد «${created.code}»`,
      details: { name: created.name, code: created.code },
      req
    });

    res.json({ id: created.id, name: created.name, code: created.code, is_active: created.isActive });
  } catch (err) { 
    logger.error({ message: 'POST /warehouses ERROR', error: err });
    throw err; 
  }
});

router.put('/warehouses/:id', authorize('admin'), validate(updateWarehouseValidation), async (req, res) => {
  try {
    const { name } = req.body;
    const id = Number(req.params.id);
    const { previous: oldWh, current: updatedWh } = await WarehouseService.updateWarehouse(id, { name });

    await logActivity({
      action: 'UPDATE',
      entity: 'انبار',
      entityId: oldWh.id,
      description: `ویرایش نام انبار کد «${oldWh.code}» از «${oldWh.name}» به «${name}»`,
      details: { before: { name: oldWh.name }, after: { name: updatedWh.name } },
      req
    });

    res.json({ success: true });
  } catch (err) { throw err; }
});

router.delete('/warehouses/:id', authorize('admin'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const wh = await WarehouseService.deactivateWarehouse(id);

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
