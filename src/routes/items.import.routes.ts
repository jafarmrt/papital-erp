import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission, can } from '../middleware/authorize.js';
import { ITEM_IMPORT_PERMISSION_KEYS, type ItemImportPermissions } from '../lib/items/itemImportPermissions.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { ItemsService } from '../services/items.service.js';
import { logActivity, extractClientIp } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';

const router = Router();
router.use(authenticateToken);

export const unifiedImportSchema = z.object({
  body: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1, 'لیست ردیف‌های فایل اکسل خالی است'),
    typeFilter: z.string().optional()
  })
});

// GET /items/unified-export
router.get('/items/unified-export', authorizePermission('products.view'), asyncHandler(async (req, res) => {
  try {
    const typeFilter = req.query.type as string;
    const result = await ItemsService.processUnifiedExport(typeFilter);
    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'user',
      userFullName: req.user?.fullName || '',
      action: 'EXPORT',
      entity: 'کالاها_و_محصولات',
      description: `استخراج خروجی اکسل کالاها و خدمات (فیلتر: ${typeFilter || 'همه'}) شامل ${result?.rows?.length || 0} ردیف`,
      ipAddress: extractClientIp(req)
    });
    res.json(result);
  } catch (err) {
    logger.error({ message: 'Error exporting items', error: err });
    throw err;
  }
}));

/** v9.0.116 (TD-648، تصمیم ت۲ الف): مجوز هر بخش ورود اکسل، از نقش کاربر (هرگز از بدنه درخواست) */
async function itemImportPermissionsOf(user: { role?: string } | undefined): Promise<ItemImportPermissions> {
  const keys = ITEM_IMPORT_PERMISSION_KEYS;
  return {
    createItems: await can(user, keys.createItems),
    editItems: await can(user, keys.editItems),
    editPrices: await can(user, keys.editPrices),
    stockIn: await can(user, keys.stockIn),
    stockOut: await can(user, keys.stockOut),
  };
}

// POST /items/unified-import
router.post('/items/unified-import', authorizePermission('products.create', 'products.edit'), validate(unifiedImportSchema), asyncHandler(async (req, res) => {
  try {
    const { rows, typeFilter } = req.body;
    const result = await ItemsService.processUnifiedImport(rows, typeFilter, req, await itemImportPermissionsOf(req.user));
    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'user',
      userFullName: req.user?.fullName || '',
      action: 'IMPORT',
      entity: 'کالاها_و_محصولات',
      description: `واردات دسته‌ای کالاها و خدمات از طریق اکسل شامل ${rows.length} ردیف داده`,
      ipAddress: extractClientIp(req)
    });
    res.json(result);
  } catch (err) {
    logger.error({ message: 'Error in unified import', error: err });
    throw err;
  }
}));

export default router;
