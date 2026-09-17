import { Router, Request, Response } from 'express';
import { orm } from '../db/drizzle.js';
import { transfers, items, activityLogs } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import { authorize } from '../middleware/authorize.js';
import { logger } from '../middleware/logger.js';
import { uploadBase64ToStorage } from '../lib/storage.js';
import { parsePagination } from '../lib/pagination.js';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';

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

// Helper to extract transfer code from item product code
function extractTransferCode(code: string): string | null {
  if (!code) return null;
  const parts = code.split('-');
  // Code format: Year-Category-TransferCode-Serial (e.g. 1403-B-003-01)
  if (parts.length >= 3 && parts[2]) {
    const tr = parts[2].trim();
    if (tr) return tr;
  }
  return null;
}

// GET /api/transfers - Get all transfer codes and their linked products with pagination & search
router.get('/transfers', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 50 });
    const isAll = req.query.all === 'true' || limit === 0;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

    // 1. Fetch saved transfer details
    const savedTransfers = await orm.select().from(transfers);
    const savedMap = new Map<string, any>();
    for (const tr of savedTransfers) {
      savedMap.set(tr.code, tr);
    }

    // 2. Fetch all active products
    const allProducts = await orm.select({
      id: items.id,
      name: items.name,
      code: items.code,
      type: items.type,
      category: items.category,
      unit: items.unit,
      currentStock: items.currentStock,
      image: items.image,
      thumbnail: items.thumbnail,
      weightedAverageCost: items.weightedAverageCost,
      color: items.color,
      weight: items.weight,
      material: items.material,
      size: items.size
    })
    .from(items)
    .where(and(eq(items.type, 'product'), eq(items.isDeleted, 0)));

    // 3. Map products to transfer codes
    const transferProductsMap = new Map<string, any[]>();
    for (const prod of allProducts) {
      const trCode = extractTransferCode(prod.code);
      if (trCode) {
        if (!transferProductsMap.has(trCode)) {
          transferProductsMap.set(trCode, []);
        }
        transferProductsMap.get(trCode)!.push(prod);
      }
    }

    // 4. Combine all known transfer codes (saved in DB or present in product codes)
    const allTransferCodes = new Set<string>([
      ...Array.from(savedMap.keys()),
      ...Array.from(transferProductsMap.keys())
    ]);

    let resultList: Array<Record<string, unknown>> = [];
    for (const code of Array.from(allTransferCodes)) {
      const saved = savedMap.get(code);
      const linkedProds = transferProductsMap.get(code) || [];

      resultList.push({
        id: saved ? saved.id : null,
        code: code,
        title: saved?.title || `ترنسفر کد ${code}`,
        image: saved?.image || '',
        thumbnail: saved?.thumbnail || '',
        notes: saved?.notes || '',
        createdAt: saved?.createdAt || null,
        updatedAt: saved?.updatedAt || null,
        productCount: linkedProds.length,
        products: linkedProds
      });
    }

    // Filter by search query if provided
    if (search) {
      resultList = resultList.filter(t =>
        String(t.code || '').toLowerCase().includes(search) ||
        String(t.title || '').toLowerCase().includes(search) ||
        String(t.notes || '').toLowerCase().includes(search)
      );
    }

    // Sort transfer codes naturally (e.g. 001, 002, 003...)
    resultList.sort((a, b) => (a.code as string).localeCompare(b.code as string, undefined, { numeric: true, sensitivity: 'base' }));

    const total = resultList.length;
    const effectiveLimit = limit || 50;
    const totalPages = Math.ceil(total / effectiveLimit) || 1;
    const pagedList = isAll ? resultList.slice(0, 1000) : resultList.slice(offset, offset + effectiveLimit);

    res.json({
      data: pagedList,
      total,
      page: isAll ? 1 : page,
      limit: isAll ? total : effectiveLimit,
      totalPages
    });
  } catch (error) {
    logger.error({ message: 'Error fetching transfers', error });
    throw error;
  }
});

// GET /api/transfers/:code - Get single transfer code details and products
router.get('/transfers/:code', authenticateToken, validate(deleteTransferSchema), async (req: Request, res: Response) => {
  try {
    const code = req.params.code;
    const [saved] = await orm.select().from(transfers).where(eq(transfers.code, code)).limit(1);

    // Fetch linked products with light projection
    const allProducts = await orm.select({
      id: items.id,
      name: items.name,
      code: items.code,
      type: items.type,
      category: items.category,
      unit: items.unit,
      currentStock: items.currentStock,
      image: items.image,
      thumbnail: items.thumbnail,
      weightedAverageCost: items.weightedAverageCost,
      color: items.color,
      weight: items.weight,
      material: items.material,
      size: items.size
    })
    .from(items)
    .where(and(eq(items.type, 'product'), eq(items.isDeleted, 0)));

    const linkedProds = allProducts.filter(p => extractTransferCode(p.code) === code);

    res.json({
      data: {
        id: saved ? saved.id : null,
        code: code,
        title: saved?.title || `ترنسفر کد ${code}`,
        image: saved?.image || '',
        thumbnail: saved?.thumbnail || '',
        notes: saved?.notes || '',
        createdAt: saved?.createdAt || null,
        updatedAt: saved?.updatedAt || null,
        productCount: linkedProds.length,
        products: linkedProds
      }
    });
  } catch (error) {
    logger.error({ message: 'Error fetching transfer details', error });
    throw error;
  }
});

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

    // Process base64 uploads to storage
    let imageUrl = image || '';
    let thumbnailUrl = thumbnail || '';

    if (imageUrl && imageUrl.startsWith('data:image')) {
      imageUrl = await uploadBase64ToStorage(imageUrl, 'image');
    }
    if (thumbnailUrl && thumbnailUrl.startsWith('data:image')) {
      thumbnailUrl = await uploadBase64ToStorage(thumbnailUrl, 'thumbnail');
    } else if (!thumbnailUrl && imageUrl) {
      thumbnailUrl = imageUrl;
    }

    const existing = await orm.select().from(transfers).where(eq(transfers.code, cleanCode)).limit(1);

    const now = new Date().toISOString();
    let savedRecord: typeof transfers.$inferSelect | null = null;

    if (existing.length > 0) {
      const [updated] = await orm.update(transfers)
        .set({
          title: title !== undefined ? title : existing[0].title,
          image: imageUrl,
          thumbnail: thumbnailUrl,
          notes: notes !== undefined ? notes : existing[0].notes,
          updatedAt: now
        })
        .where(eq(transfers.code, cleanCode))
        .returning();
      savedRecord = updated;
    } else {
      const [inserted] = await orm.insert(transfers)
        .values({
          code: cleanCode,
          title: title || `ترنسفر کد ${cleanCode}`,
          image: imageUrl,
          thumbnail: thumbnailUrl,
          notes: notes || '',
          createdAt: now,
          updatedAt: now
        })
        .returning();
      savedRecord = inserted;
    }

    // Log activity
    const user = req.user;
    if (user) {
      await orm.insert(activityLogs).values({
        userId: user.id || null,
        username: user.username || 'سیستم',
        userFullName: user.full_name || '',
        action: existing.length > 0 ? 'UPDATE' : 'CREATE',
        entity: 'ترنسفر',
        entityId: cleanCode,
        description: `ثبت/ویرایش تصویر و اطلاعات ترنسفر کد ${cleanCode}`,
        details: { code: cleanCode, title: savedRecord.title }
      });
    }

    res.json({
      message: 'اطلاعات و تصویر ترنسفر با موفقیت ذخیره گردید.',
      data: savedRecord
    });
  } catch (error) {
    logger.error({ message: 'Error saving transfer', error });
    throw error;
  }
};

router.post('/transfers', authenticateToken, authorize('admin', 'manager', 'warehouse_keeper', 'products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), handleSaveTransfer);
router.post('/transfers/:code', authenticateToken, authorize('admin', 'manager', 'warehouse_keeper', 'products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), handleSaveTransfer);
router.put('/transfers/:code', authenticateToken, authorize('admin', 'manager', 'warehouse_keeper', 'products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), handleSaveTransfer);
router.put('/transfers', authenticateToken, authorize('admin', 'manager', 'warehouse_keeper', 'products.create', 'products.edit'), idempotency({ scope: 'transfers' }), validate(saveTransferSchema), handleSaveTransfer);

// DELETE /api/transfers/:code - Delete transfer details/image
router.delete('/transfers/:code', authenticateToken, authorize('admin', 'manager', 'products.delete'), validate(deleteTransferSchema), async (req: Request, res: Response) => {
  try {
    const code = req.params.code;
    await orm.delete(transfers).where(eq(transfers.code, code));

    res.json({ message: `اطلاعات و تصویر ترنسفر کد ${code} با موفقیت پاک شد.` });
  } catch (error) {
    logger.error({ message: 'Error deleting transfer', error });
    throw error;
  }
});

export default router;
