import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { listTransferCodes, getTransferCode } from '../services/transfers/transferCodeList.js';
import { TRANSFER_CODE_MAX_PAGE_SIZE, TRANSFER_IMAGE_FILTERS, TransferImageFilter } from '../lib/transfers/transferCodeList.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { TransferService } from '../services/transfer.service.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { NotFoundError } from '../errors/customErrors.js';

const router = Router();

export const saveTransferSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    title: z.string().optional(),
    image: z.string().optional(),
    thumbnail: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
  params: z.object({
    code: z.string().optional()
  }).optional()
});

export const deleteTransferSchema = z.object({
  params: z.object({
    code: z.string().min(1, 'کد ترنسفر الزامی است')
  })
});

export const listTransfersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(TRANSFER_CODE_MAX_PAGE_SIZE).optional(),
    search: z.string().max(200).optional(),
    image: z.enum(TRANSFER_IMAGE_FILTERS).optional(),
  }),
});

// GET /api/transfers — v10.0.26 (OBS-R1-82): یک صفحه از کدها با کالاهای همان صفحه و خلاصه همه کدها، در پایگاه‌داده
router.get('/transfers', authenticateToken, authorizePermission(...READ_PERMISSIONS.transfers), validate(listTransfersSchema), asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as { page?: number; limit?: number; search?: string; image?: TransferImageFilter };
  res.json(await listTransferCodes({
    page: query.page === undefined ? undefined : Number(query.page),
    limit: query.limit === undefined ? undefined : Number(query.limit),
    search: query.search,
    image: query.image,
  }));
}));

// GET /api/transfers/:code - Get single transfer code details and products
router.get('/transfers/:code', authenticateToken, authorizePermission(...READ_PERMISSIONS.transfers), validate(deleteTransferSchema), asyncHandler(async (req: Request, res: Response) => {
  const transfer = await getTransferCode(req.params.code);
  // TD-493: a deleted design with no product using its code is gone
  if (!transfer) throw new NotFoundError('ترنسفر یافت نشد');
  res.json({ data: transfer });
}));

// POST /api/transfers - Create or Update transfer image/details
// V9-2.2: مسیر مرده GET /transfers/test حذف شد — توسط /transfers/:code سایه‌گذاری شده بود و هرگز اجرا نمی‌شد

// Handler for saving/updating transfer image and metadata
const handleSaveTransfer = async (req: Request, res: Response) => {
  try {
    const codeParam = req.params.code;
    const body = req.body || {};
    const rawCode = body.code || codeParam;

    if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
      return res.status(400).json({ error: 'کد ترنسفر الزامی است' });
    }

    const { title, image, thumbnail, notes } = body;
    const cleanCode = rawCode.trim();

    const savedRecord = await TransferService.saveTransfer({
      code: cleanCode,
      title,
      image,
      thumbnail,
      notes,
      user: req.user ? {
        id: req.user.id,
        username: req.user.username,
        full_name: req.user.full_name
      } : undefined
    });

    res.json({
      message: 'اطلاعات و تصویر ترنسفر با موفقیت ذخیره گردید.',
      data: savedRecord
    });
  } catch (error) {
    logger.error({ message: 'Error saving transfer', error });
    throw error;
  }
};

router.post('/transfers', authenticateToken, authorizePermission('products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), asyncHandler(handleSaveTransfer));
router.post('/transfers/:code', authenticateToken, authorizePermission('products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), asyncHandler(handleSaveTransfer));
router.put('/transfers/:code', authenticateToken, authorizePermission('products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), asyncHandler(handleSaveTransfer));
router.put('/transfers', authenticateToken, authorizePermission('products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), asyncHandler(handleSaveTransfer));

// DELETE /api/transfers/:code - Delete transfer details/image
router.delete('/transfers/:code', authenticateToken, authorizePermission('products.delete'), validate(deleteTransferSchema), asyncHandler(async (req: Request, res: Response) => {
  try {
    const code = req.params.code;
    await TransferService.deleteTransfer(code, req.user);

    res.json({ message: `اطلاعات و تصویر ترنسفر کد ${code} با موفقیت پاک شد.` });
  } catch (error) {
    logger.error({ message: 'Error deleting transfer', error });
    throw error;
  }
}));

export default router;

