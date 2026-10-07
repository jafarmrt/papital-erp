import { z } from 'zod';
import { decimalInput } from '../middleware/validate.js';
import { fin } from '../lib/financialDecimal.js';
import { REQUISITION_MAX_ROWS, REQUISITION_PRIORITIES } from '../lib/procurement/requisitionFields.js';

// ==========================================
// Zod Validation Schemas (TD-161 Remediation)
// ==========================================

export const listRequisitionsSchema = z.object({
  query: z.object({
    status: z.enum(['draft', 'pending', 'approved', 'rejected', 'ordered', 'delivered', 'cancelled', 'all']).optional(),
    projectId: z.coerce.number().int().positive().optional(),
    priority: z.enum(['low', 'medium', 'high', 'emergency']).optional(),
    search: z.string().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }).passthrough(),
}).passthrough();

const positiveIdOrNull = z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number), z.null()]).optional();

/**
 * v9.0.266 (TD-688، B10-01): یک ردیف درخواست خرید، همان که سه فرم رابط می‌فرستند (میز تدارکات، کسری مواد پروژه، هشدار
 * نقطه سفارش) و ویرایش هم می‌خواند: مقدار درخواستی (`requestedQty`، بیشتر از صفر)، کالای فهرست (`itemId`) یا نام کالایی
 * بیرون از فهرست، کد، واحد و برآورد قیمت. پیش‌تر `quantity` الزامی بود و این فیلدها حذف می‌شدند؛ سرویس مقدار صفر ذخیره
 * می‌کرد. شناسه ردیف ذخیره‌شده رشته است (`item-…`).
 */
export const requisitionRowSchema = z.object({
  id: z.union([z.string().max(100), z.number().int().positive().transform(String)]).optional(),
  itemId: positiveIdOrNull,
  itemCode: z.string().max(100).optional(),
  itemName: z.string().max(300).optional(),
  category: z.string().max(200).optional(),
  unit: z.string().max(50).optional(),
  requestedQty: decimalInput('مقدار درخواستی')
    .refine(v => v !== undefined && fin(v).isPositive(), 'مقدار درخواستی باید بیشتر از صفر باشد'),
  unitPriceEstimate: decimalInput('برآورد قیمت واحد')
    .refine(v => v === undefined || !fin(v).isNegative(), 'برآورد قیمت واحد نمی‌تواند منفی باشد')
    .optional(),
  targetSupplierId: positiveIdOrNull,
  targetSupplierName: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
}).refine(row => (row.itemId ?? null) !== null || Boolean(row.itemName?.trim()), {
  message: 'برای هر ردیف کالایی از فهرست کالا انتخاب کنید یا نام کالا را بنویسید',
  path: ['itemName'],
});

export type RequisitionRowInput = z.infer<typeof requisitionRowSchema>;

const requisitionTitle = z.string().trim().min(1, 'عنوان درخواست خرید را وارد کنید').max(200);
const requisitionRows = z.array(requisitionRowSchema)
  .min(1, 'دست‌کم یک قلم کالا برای درخواست خرید لازم است')
  .max(REQUISITION_MAX_ROWS);

export const createRequisitionSchema = z.object({
  body: z.object({
    projectId: positiveIdOrNull,
    title: requisitionTitle,
    priority: z.enum(REQUISITION_PRIORITIES).default('normal'),
    requiredDate: z.string().max(50).optional(),
    notes: z.string().max(3000).optional(),
    items: requisitionRows,
  })
});

export type CreateRequisitionBody = z.infer<typeof createRequisitionSchema>['body'];

/** v9.0.271 (TD-696، B10-09): همان قرارداد ثبت؛ فیلدی که نیامده همان مقدار ذخیره‌شده را نگه می‌دارد */
export const updateRequisitionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه نامعتبر است')
  }),
  body: z.object({
    projectId: positiveIdOrNull,
    title: requisitionTitle.optional(),
    priority: z.enum(REQUISITION_PRIORITIES).optional(),
    requiredDate: z.string().max(50).optional(),
    notes: z.string().max(3000).optional(),
    items: requisitionRows.optional(),
  })
});

export type UpdateRequisitionBody = z.infer<typeof updateRequisitionSchema>['body'];

export const workflowActionSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه نامعتبر است')
  }),
  body: z.object({
    actionKey: z.string().min(1, 'کلید اکشن گردش کار الزامی است').max(100),
    comment: z.string().max(1000).optional()
  })
});

export const convertToOrdersSchema = z.object({
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه نامعتبر است')
  }),
  body: z.object({
    // v8.0.37 (TD-291): همان بدنه‌ای که فرم «تقسیم سفارش» می‌فرستد. پیش‌تر شناسه عددی ردیف درخواست (که فرم نمی‌فرستد و
    // شناسه ردیف درخواست رشته است) الزامی بود و هر ثبت فرم با خطای ۴۰۰ رد می‌شد؛ انبار مقصد و وضعیت بسته هم از بدنه حذف می‌شد.
    // وضعیت بسته فقط پیش‌نویس یا پیش‌فاکتور است؛ ورود کالا به انبار از مسیر «تحویل به انبار» است.
    orderGroups: z.array(z.object({
      supplierId: z.union([z.number().int().positive(), z.null()]).optional(),
      supplierName: z.string().max(200).optional(),
      targetWarehouse: z.string().max(100).optional(),
      docType: z.enum(['receipt', 'proforma']).optional(),
      status: z.enum(['draft', 'proforma']).optional(),
      items: z.array(z.object({
        requisitionItemId: z.union([z.number().int().positive(), z.string().max(100)]).optional(),
        itemId: z.number().int().positive(),
        itemCode: z.string().max(100).optional(),
        itemName: z.string().max(300).optional(),
        unit: z.string().max(50).optional(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        location: z.string().optional(),
        notes: z.string().max(500).optional()
      })).min(1, 'حداقل یک قلم برای گروه سفارش الزامی است'),
      notes: z.string().max(1000).optional(),
      currency: z.string().default('IRR').optional()
    })).min(1, 'حداقل یک گروه سفارش خرید الزامی است'),
    closeRequisition: z.boolean().optional(),
    closureReason: z.string().max(500).optional(),
    // v8.0.38 (TD-289): دلیل سفارش بیش از درخواست (بی آن، سفارش بیش از مانده درخواست رد می‌شود)
    overOrderReason: z.string().max(500).optional(),
    notes: z.string().max(1000).optional()
  })
});

export const consolidateRequisitionsSchema = z.object({
  body: z.object({
    requisitionIds: z.array(z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)])).min(2, 'حداقل ۲ درخواست خرید برای تجمیع الزامی است'),
    title: z.string().max(200).optional()
  })
});

export const listProcurementOrdersSchema = z.object({
  query: z.object({
    status: z.string().optional(),
    requisitionId: z.coerce.number().int().positive().optional(),
    search: z.string().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  }).passthrough()
}).passthrough();
