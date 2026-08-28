import { Router, Request, Response } from 'express';
import { orm } from '../db/drizzle.js';
import { pendingMaterials, items } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { logger } from '../middleware/logger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';

const router = Router();

const createPendingMaterialSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'عنوان ماده اولیه الزامی است'),
    code: z.string().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
    projectId: z.union([z.number(), z.string(), z.null()]).optional(),
    projectTitle: z.string().optional(),
    reorderPoint: z.union([z.number(), z.string()]).optional(),
    weightedAverageCost: z.union([z.number(), z.string()]).optional(),
    color: z.string().optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    material: z.string().optional(),
    size: z.string().optional(),
    image: z.string().optional(),
    thumbnail: z.string().optional()
  })
});

const approvePendingMaterialSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
    reorderPoint: z.union([z.number(), z.string()]).optional(),
    weightedAverageCost: z.union([z.number(), z.string()]).optional(),
    color: z.string().optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    material: z.string().optional(),
    size: z.string().optional(),
    image: z.string().optional(),
    thumbnail: z.string().optional()
  }).optional(),
  params: z.object({
    id: numericIdString
  })
});

const rejectPendingMaterialSchema = z.object({
  body: z.object({
    rejectionReason: z.string().optional()
  }).optional(),
  params: z.object({
    id: numericIdString
  })
});

const updatePendingMaterialSchema = z.object({
  body: z.object({
    code: z.string().optional(),
    name: z.string().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
    reorderPoint: z.union([z.number(), z.string()]).optional(),
    weightedAverageCost: z.union([z.number(), z.string()]).optional(),
    color: z.string().optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    material: z.string().optional(),
    size: z.string().optional()
  }),
  params: z.object({
    id: numericIdString
  })
});

// GET /api/pending-materials - List pending raw materials
router.get('/pending-materials', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const conditions = [eq(pendingMaterials.isDeleted, 0)];

    if (status && status !== 'all') {
      conditions.push(eq(pendingMaterials.status, String(status)));
    }

    const rows = await orm.select().from(pendingMaterials)
      .where(and(...conditions))
      .orderBy(desc(pendingMaterials.id));

    // Map rows to camelCase & snake_case for frontend consistency
    const result = rows.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      unit: r.unit,
      category: r.category,
      type: r.type,
      projectId: r.projectId,
      project_id: r.projectId,
      projectTitle: r.projectTitle,
      project_title: r.projectTitle,
      requestedBy: r.requestedBy,
      requested_by: r.requestedBy,
      status: r.status,
      reorderPoint: r.reorderPoint,
      reorder_point: r.reorderPoint,
      weightedAverageCost: r.weightedAverageCost,
      weighted_average_cost: r.weightedAverageCost,
      color: r.color,
      weight: r.weight,
      material: r.material,
      size: r.size,
      image: r.image,
      thumbnail: r.thumbnail,
      rejectionReason: r.rejectionReason,
      rejection_reason: r.rejectionReason,
      createdAt: r.createdAt,
      created_at: r.createdAt
    }));

    res.json(result);
  } catch (err) {
    logger.error({ message: 'Error fetching pending materials', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// POST /api/pending-materials - Submit a new pending material (from project inventory control)
router.post('/pending-materials', authenticateToken, validate(createPendingMaterialSchema), async (req: Request, res: Response) => {
  try {
    const {
      code,
      name,
      unit,
      category,
      projectId,
      projectTitle,
      reorderPoint,
      weightedAverageCost,
      color,
      weight,
      material,
      size,
      image,
      thumbnail
    } = req.body;

    const username = req.user?.username || req.user?.full_name || 'کاربر سیستم';

    const [inserted] = await orm.insert(pendingMaterials).values({
      code: code ? code.trim() : `TEMP-${Date.now()}`,
      name: name.trim(),
      unit: unit ? unit.trim() : 'عدد',
      category: category ? category.trim() : 'عمومی',
      type: 'raw_material',
      projectId: projectId ? Number(projectId) : null,
      projectTitle: projectTitle ? projectTitle.trim() : '',
      requestedBy: username,
      status: 'pending',
      reorderPoint: Number(reorderPoint) || 0,
      weightedAverageCost: Number(weightedAverageCost) || 0,
      color: color || '',
      weight: Number(weight) || 0,
      material: material || '',
      size: size || '',
      image: image || '',
      thumbnail: thumbnail || ''
    }).returning();

    // Log activity
    await logActivity({
      userId: req.user?.id,
      username,
      action: 'CREATE',
      entity: 'ماده اولیه',
      entityId: inserted.id,
      description: `ثبت ماده اولیه "${inserted.name}" با کد "${inserted.code}" جهت بررسی انباردار`
    });

    res.status(201).json({
      message: 'ماده اولیه در صف بررسی و تأیید انبار قرار گرفت',
      data: inserted
    });
  } catch (err) {
    logger.error({ message: 'Error creating pending material', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// PUT /api/pending-materials/:id/approve - Approve and register in official warehouse inventory
router.put('/pending-materials/:id/approve', authenticateToken, authorizePermission('pending_materials.approve'), validate(approvePendingMaterialSchema), async (req: Request, res: Response) => {
  try {
    const pId = Number(req.params.id);
    const [existing] = await orm.select().from(pendingMaterials).where(and(eq(pendingMaterials.id, pId), eq(pendingMaterials.isDeleted, 0)));

    if (!existing) {
      return res.status(404).json({ error: 'ماده اولیه مورد نظر یافت نشد' });
    }

    const {
      code,
      name,
      unit,
      category,
      reorderPoint,
      weightedAverageCost,
      color,
      weight,
      material,
      size,
      image,
      thumbnail
    } = req.body || {};

    const finalCode = (code || existing.code).trim();
    const finalName = (name || existing.name).trim();
    const finalUnit = (unit || existing.unit).trim();
    const finalCategory = (category || existing.category || 'عمومی').trim();

    // Check code duplication in official items
    const [codeDup] = await orm.select().from(items).where(and(eq(items.code, finalCode), eq(items.isDeleted, 0)));
    if (codeDup) {
      return res.status(400).json({ error: `کد کالا «${finalCode}» قبلاً در انبار ثبت شده است. لطفاً کد دیگری انتخاب کنید.` });
    }

    // Register into official items table
    const [newItem] = await orm.insert(items).values({
      type: 'raw_material',
      name: finalName,
      code: finalCode,
      unit: finalUnit,
      category: finalCategory,
      currentStock: 0,
      stocks: {},
      reorderPoint: Number(reorderPoint ?? existing.reorderPoint) || 0,
      weightedAverageCost: Number(weightedAverageCost ?? existing.weightedAverageCost) || 0,
      color: color ?? existing.color ?? '',
      weight: Number(weight ?? existing.weight) || 0,
      material: material ?? existing.material ?? '',
      size: size ?? existing.size ?? '',
      image: image ?? existing.image ?? '',
      thumbnail: thumbnail ?? existing.thumbnail ?? ''
    }).returning();

    // Update pending_materials status
    await orm.update(pendingMaterials).set({
      status: 'approved',
      code: finalCode,
      name: finalName,
      unit: finalUnit,
      category: finalCategory
    }).where(eq(pendingMaterials.id, pId));

    const username = req.user?.username || 'انباردار';
    await logActivity({
      userId: req.user?.id,
      username,
      action: 'CREATE',
      entity: 'کالا',
      entityId: newItem.id,
      description: `کالای "${newItem.name}" با کد "${newItem.code}" توسط انباردار تأیید و در انبار ثبت گردید`
    });

    res.json({
      message: 'ماده اولیه با موفقیت تأیید و در انبار ثبت شد',
      item: newItem
    });
  } catch (err) {
    logger.error({ message: 'Error approving pending material', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// PUT /api/pending-materials/:id/reject - Reject pending material
router.put('/pending-materials/:id/reject', authenticateToken, authorizePermission('pending_materials.approve'), validate(rejectPendingMaterialSchema), async (req: Request, res: Response) => {
  try {
    const pId = Number(req.params.id);
    const { rejectionReason } = req.body || {};

    const [existing] = await orm.select().from(pendingMaterials).where(and(eq(pendingMaterials.id, pId), eq(pendingMaterials.isDeleted, 0)));

    if (!existing) {
      return res.status(404).json({ error: 'ماده اولیه مورد نظر یافت نشد' });
    }

    await orm.update(pendingMaterials).set({
      status: 'rejected',
      rejectionReason: rejectionReason ? rejectionReason.trim() : 'عدم تأیید توسط انباردار'
    }).where(eq(pendingMaterials.id, pId));

    const username = req.user?.username || 'انباردار';
    await logActivity({
      userId: req.user?.id,
      username,
      action: 'UPDATE',
      entity: 'ماده اولیه',
      entityId: pId,
      description: `کد ماده اولیه "${existing.name}" (${existing.code}) رد شد و به انبار اضافه نگردید`
    });

    res.json({
      message: 'درخواست ماده اولیه رد گردید. کد کالا در انبار ثبت نشد.'
    });
  } catch (err) {
    logger.error({ message: 'Error rejecting pending material', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// PUT /api/pending-materials/:id - Update pending material details
router.put('/pending-materials/:id', authenticateToken, validate(updatePendingMaterialSchema), async (req: Request, res: Response) => {
  try {
    const pId = Number(req.params.id);
    const {
      code,
      name,
      unit,
      category,
      reorderPoint,
      weightedAverageCost,
      color,
      weight,
      material,
      size
    } = req.body;

    await orm.update(pendingMaterials).set({
      code,
      name,
      unit,
      category,
      reorderPoint: Number(reorderPoint) || 0,
      weightedAverageCost: Number(weightedAverageCost) || 0,
      color,
      weight: Number(weight) || 0,
      material,
      size
    }).where(eq(pendingMaterials.id, pId));

    res.json({ message: 'مشخصات ماده اولیه به‌روزرسانی شد' });
  } catch (err) {
    logger.error({ message: 'Error updating pending material', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

// DELETE /api/pending-materials/:id - Delete pending material
router.delete('/pending-materials/:id', authenticateToken, authorize('admin', 'manager'), validate(paramsIdSchema), async (req: Request, res: Response) => {
  try {
    const pId = Number(req.params.id);
    await orm.update(pendingMaterials).set({ isDeleted: 1 }).where(eq(pendingMaterials.id, pId));
    res.json({ message: 'ماده اولیه حذف شد' });
  } catch (err) {
    logger.error({ message: 'Error deleting pending material', error: err });
    // V9-2.1: Ù‡Ø¯Ø§ÛŒØª Ø®Ø·Ø§ Ø¨Ù‡ errorHandler Ø³Ø±Ø§Ø³Ø±ÛŒ Ø¨Ø§ traceId
    throw err;
  }
});

export default router;
