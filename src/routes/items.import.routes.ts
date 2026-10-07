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
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { buildItemExcelTemplate } from '../services/items/itemExcelTemplate.js';

const router = Router();
router.use(authenticateToken);

export const unifiedImportSchema = z.object({
  body: z.object({
    rows: z.array(z.record(z.string(), z.unknown())).min(1, 'فهرست ردیف‌های فایل اکسل خالی است'),
    typeFilter: z.string().optional()
  })
});

// v9.0.201 (O8): الگوی ورود اکسل کالا از سرور، بی خواندن کالاها و بی ردیف ممیزی خروجی
router.get('/items/excel-template', authorizePermission(...READ_PERMISSIONS.items), asyncHandler(async (_req, res) => {
  res.json(await buildItemExcelTemplate());
}));

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

/** v9.0.154 (TD-648، تصمیم ت۲ الف): مجوز هر بخش ورود اکسل، از نقش کاربر (هرگز از بدنه درخواست) */
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
    // v9.0.158 (TD-655): ممیزی هر کالا و جمع‌بندی ورود درون تراکنش سرویس نوشته می‌شود
    const actor = { id: req.user?.id, username: req.user?.username, full_name: req.user?.full_name, ipAddress: extractClientIp(req) };
    const result = await ItemsService.processUnifiedImport(rows, typeFilter, { user: actor }, await itemImportPermissionsOf(req.user));
    res.json(result);
  } catch (err) {
    logger.error({ message: 'Error in unified import', error: err });
    throw err;
  }
}));

export default router;
