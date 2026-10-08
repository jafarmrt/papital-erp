import { z } from 'zod';
import { numericIdString } from '../middleware/validate.js';

/** بدنه‌های مسیرهای صف «مواد اولیه در انتظار تأیید» (`pendingMaterials.routes.ts`) */
export const createPendingMaterialSchema = z.object({
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

/**
 * v9.0.377 (TD-824، یافته B07-08): مشخصاتی که بررسی‌کننده در پنجره تأیید تغییر می‌دهد. بدنه تأیید و ویرایش فقط همین کلیدها را
 * می‌پذیرد (`strict`) و کلید دیگر ۴۰۰ است. پیش‌تر صفحه هنگام تأیید `weighted_average_cost` و `reorder_point` می‌فرستاد، طرح آن‌ها
 * را بی‌صدا دور می‌ریخت و کالا با بها و نقطه سفارش درخواست اولیه ساخته می‌شد. صفحه همان فرم `PendingMaterialForm` را می‌فرستد.
 */
const reviewFields = {
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
};

export const approvePendingMaterialBody = z.object({
  ...reviewFields,
  image: z.string().optional(),
  thumbnail: z.string().optional()
}).strict();

export const updatePendingMaterialBody = z.object(reviewFields).strict();

export const approvePendingMaterialSchema = z.object({
  body: approvePendingMaterialBody.optional(),
  params: z.object({
    id: numericIdString
  })
});

export const rejectPendingMaterialSchema = z.object({
  body: z.object({
    rejectionReason: z.string().optional()
  }).optional(),
  params: z.object({
    id: numericIdString
  })
});

export const updatePendingMaterialSchema = z.object({
  body: updatePendingMaterialBody,
  params: z.object({
    id: numericIdString
  })
});
