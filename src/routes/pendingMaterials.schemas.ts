import { z } from 'zod';
import { decimalInput, numericIdString } from '../middleware/validate.js';
import { fin } from '../lib/financialDecimal.js';
import { isDataUrl } from '../lib/storage.js';
import { PENDING_MATERIAL_MAX_PAGE_SIZE, PENDING_MATERIAL_STATUSES } from '../lib/pendingMaterials/pendingMaterialList.js';

/**
 * v9.0.397 (TD-825، یافته B07-09): عددهای درخواست با `decimalInput` خوانده می‌شوند (ارقام فارسی پذیرفته، متن ۴۰۰ و منفی
 * ۴۰۰)؛ پیش‌تر `Number(x) || 0` نقطه سفارش «۱۲» را ۰ و بهای «abc» را ۰ ذخیره می‌کرد.
 */
const nonNegativeDecimal = (label: string) =>
  decimalInput(label).refine(v => v === undefined || !fin(v).isNegative(), `${label} نمی‌تواند منفی باشد`);

/** تصویر: data URL را سرویس به فایل می‌برد و می‌سنجد (۴۲۲ برای قالب یا اندازه نادرست)؛ متن دیگر فقط نشانی کوتاه فایل است */
const MAX_IMAGE_PATH_LENGTH = 1000;
const imageField = (label: string) => z.string()
  .refine(v => v.length <= MAX_IMAGE_PATH_LENGTH || isDataUrl(v), `${label} باید تصویر بارگذاری‌شده یا نشانی فایل باشد`)
  .optional();

/** بدنه‌های مسیرهای صف «مواد اولیه در انتظار تأیید» (`pendingMaterials.routes.ts`) */
export const createPendingMaterialSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'عنوان ماده اولیه الزامی است'),
    code: z.string().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
    projectId: z.union([z.number(), z.string(), z.null()]).optional(),
    projectTitle: z.string().optional(),
    reorderPoint: nonNegativeDecimal('نقطه سفارش').optional(),
    weightedAverageCost: nonNegativeDecimal('بهای واحد').optional(),
    color: z.string().optional(),
    weight: nonNegativeDecimal('وزن').optional(),
    material: z.string().optional(),
    size: z.string().optional(),
    image: imageField('تصویر'),
    thumbnail: imageField('تصویر کوچک')
  })
});

/**
 * v9.0.396 (TD-824، یافته B07-08): مشخصاتی که بررسی‌کننده در پنجره تأیید تغییر می‌دهد. بدنه تأیید و ویرایش فقط همین کلیدها را
 * می‌پذیرد (`strict`) و کلید دیگر ۴۰۰ است. پیش‌تر صفحه هنگام تأیید `weighted_average_cost` و `reorder_point` می‌فرستاد، طرح آن‌ها
 * را بی‌صدا دور می‌ریخت و کالا با بها و نقطه سفارش درخواست اولیه ساخته می‌شد. صفحه همان فرم `PendingMaterialForm` را می‌فرستد.
 */
const reviewFields = {
  code: z.string().optional(),
  name: z.string().optional(),
  unit: z.string().optional(),
  category: z.string().optional(),
  reorderPoint: nonNegativeDecimal('نقطه سفارش').optional(),
  weightedAverageCost: nonNegativeDecimal('بهای واحد').optional(),
  color: z.string().optional(),
  weight: nonNegativeDecimal('وزن').optional(),
  material: z.string().optional(),
  size: z.string().optional(),
};

export const approvePendingMaterialBody = z.object({
  ...reviewFields,
  image: imageField('تصویر'),
  thumbnail: imageField('تصویر کوچک')
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

/** v10.0.171 (OBS-R1-90): پرسمان فهرست صف؛ وضعیت، دسته، جست‌وجو و صفحه در SQL اعمال می‌شوند */
export const listPendingMaterialsSchema = z.object({
  query: z.object({
    status: z.enum(['all', ...PENDING_MATERIAL_STATUSES]).optional(),
    category: z.string().trim().max(200).optional(),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(PENDING_MATERIAL_MAX_PAGE_SIZE).optional(),
  }),
});
