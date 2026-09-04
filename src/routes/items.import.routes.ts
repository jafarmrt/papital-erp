import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { ItemsService } from '../services/items.service.js';
import { logActivity } from '../lib/auditLogger.js';
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
router.get('/items/unified-export', authorize('admin', 'manager', 'products.view'), async (req, res) => {
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
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });
    res.json(result);
  } catch (err) {
    logger.error({ message: 'Error exporting items', error: err });
    throw err;
  }
});

// POST /items/unified-import
router.post('/items/unified-import', authorize('admin', 'manager', 'products.create', 'products.edit'), validate(unifiedImportSchema), async (req, res) => {
  try {
    const { rows, typeFilter } = req.body;
    const result = await ItemsService.processUnifiedImport(rows, typeFilter, req);
    await logActivity({
      userId: req.user?.id,
      username: req.user?.username || 'user',
      userFullName: req.user?.fullName || '',
      action: 'IMPORT',
      entity: 'کالاها_و_محصولات',
      description: `واردات دسته‌ای کالاها و خدمات از طریق اکسل شامل ${rows.length} ردیف داده`,
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.ip || ''
    });
    res.json(result);
  } catch (err) {
    logger.error({ message: 'Error in unified import', error: err });
    throw err;
  }
});

export default router;
