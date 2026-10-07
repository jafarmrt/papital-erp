import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission, requireSystemAdmin } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { logActivity } from '../lib/auditLogger.js';
import { WarehouseService } from '../services/warehouse.service.js';
import { orm } from '../db/drizzle.js';

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

const listWarehousesValidation = z.object({
  query: z.object({ includeInactive: z.enum(['0', '1', 'true', 'false']).optional() }).passthrough(),
});

// v9.0.110 (TD-490): `includeInactive=1` انبارهای غیرفعال را هم برای «مدیریت انبارها» می‌دهد؛ پیش‌فرض فقط فعال‌ها
router.get('/warehouses', validate(listWarehousesValidation), asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
  res.json(includeInactive ? await WarehouseService.listAll() : await WarehouseService.listActive());
}));

router.post('/warehouses', authorizePermission('warehouse.manage'), validate(createWarehouseValidation), asyncHandler(async (req, res) => {
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
}));

router.put('/warehouses/:id', authorizePermission('warehouse.manage'), validate(updateWarehouseValidation), asyncHandler(async (req, res) => {
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
}));

router.delete('/warehouses/:id', authorizePermission('warehouse.manage'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  // v9.0.110 (TD-490): غیرفعال‌سازی و ثبت ممیزی در یک تراکنش، زیر قفل ردیف انبار
  await orm.transaction(async (tx) => {
    const wh = await WarehouseService.deactivateWarehouse(id, tx);
    await logActivity({
      tx,
      action: 'DELETE',
      entity: 'انبار',
      entityId: wh.id,
      description: `غیرفعال‌سازی انبار «${wh.name}» با کد «${wh.code}»`,
      details: { code: wh.code, name: wh.name, before: { isActive: wh.isActive }, after: { isActive: 0 } },
      req
    });
  });
  res.json({ success: true });
}));

// v9.0.110 (TD-490، تصمیم ت۵ الف): فعال‌سازی دوباره انبار غیرفعال، فقط مدیر سیستم، با ممیزی در همان تراکنش
router.post('/warehouses/:id/reactivate', requireSystemAdmin, validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const result = await orm.transaction(async (tx) => {
    const { previous, current } = await WarehouseService.reactivateWarehouse(id, tx);
    await logActivity({
      tx,
      action: 'RESTORE',
      entity: 'انبار',
      entityId: current.id,
      description: `فعال‌سازی دوباره انبار «${current.name}» با کد «${current.code}»`,
      details: { code: current.code, name: current.name, before: { isActive: previous.isActive }, after: { isActive: current.isActive } },
      req
    });
    return current;
  });
  res.json({ id: result.id, name: result.name, code: result.code, is_active: result.isActive });
}));

export default router;
