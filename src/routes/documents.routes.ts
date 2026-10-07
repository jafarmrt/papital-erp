import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission, can, userHasRoleOrPermission } from '../middleware/authorize.js';
import { permissionDefinition } from '../lib/permissions/permissionCatalog.js';
import { SALES_FINALIZE_PERMISSION } from '../lib/permissions/documentPermissions.js';
import { assertRecordableDocument, createdDocumentStatus, permissionToCreateDocument, permissionToFinalizeDocument } from '../services/documents/documentRecordRule.js';
import { BACKDATE_PERMISSION } from '../services/inventory/stockMovementDate.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString, storageDateParam, decimalInput } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { DocumentService } from '../services/document.service.js';
import { WorkflowEngineService } from '../services/workflow/workflowEngineService.js';
import { terminateOpenWorkflows } from '../services/workflow/workflowTermination.js';
import { needsApprovalWorkflow } from '../services/documents/documentApprovalScope.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../errors/customErrors.js';
import { logActivity } from '../lib/auditLogger.js';
import { orm } from '../db/drizzle.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { lockLeadForNewProforma, markLeadProforma, releaseLeadOfVoidedDocument } from '../services/crm/leadProforma.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination } from '../lib/pagination.js';
import { getStockCountSheetItems } from '../services/inventory/stockCountSheet.js';
import { READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { assertDocumentTypeReadable, readableDocumentTypes } from '../services/documents/documentReadScope.js';
import type { AuthUserPayload } from '../types.js';

const router = Router();

/**
 * حوزه H (TD-307): نام ثبت‌کننده سند، کاردکس و سند حسابداری از نشست است نه از بدنه درخواست
 * (پیش‌تر فیلد `user` بدنه هر نامی را در documents.user و createdBy کاردکس می‌نوشت).
 */
function sessionUserLabel(user: AuthUserPayload | undefined): string {
  return user?.full_name || user?.username || 'سیستم';
}
router.use(authenticateToken);

const nonNegativeMoney = (label: string) => (val: unknown): boolean =>
  val === undefined || val === null || (Number.isFinite(Number(val)) && Number(val) >= 0);

/**
 * v9.0.240 (TD-784، یافته B08-15): عددهای ردیف سند با `decimalInput` خوانده می‌شوند (AGENTS §6، TD-385): ارقام فارسی و عربی و
 * جداکننده هزارگان پذیرفته می‌شوند و «0x10»، «1e3» یا متن خطای اعتبارسنجی است. پیش‌تر مقدار خام به `Number()` می‌رسید:
 * «0x10» شانزده و «1e3» هزار ثبت می‌شد و «۲» رد. قیمت فرستاده‌شده‌ی خالی خطاست، نه صفر؛ قیمتی که فرستاده نشود مثل پیش است.
 */
const sentPrice = (label: string) => decimalInput(label)
  .refine(v => v !== undefined, { message: `${label} خالی است؛ عدد آن را وارد کنید (برای کالای رایگان ۰)` })
  .optional();

export const documentItemInputSchema = z.object({
  itemId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]).transform(v => Number(v)),
  quantity: decimalInput('تعداد').optional(),
  unit_price: sentPrice('قیمت واحد'),
  unitPrice: sentPrice('قیمت واحد'),
  price: sentPrice('قیمت واحد'),
  discount: decimalInput('تخفیف').optional(),
  system_stock: decimalInput('موجودی دفتری').optional(),
  physical_stock: decimalInput('موجودی شمارش‌شده').optional(),
  location: z.string().max(100).optional(),
  targetLoc: z.string().max(100).optional(),
  unit: z.string().max(50).optional()
});

const refineDocumentItems = (ctx: z.RefinementCtx, docLines: Array<Record<string, unknown>>, skipQuantityCheck: boolean): void => {
  for (let i = 0; i < docLines.length; i++) {
    const it = docLines[i] || {};
    if (!skipQuantityCheck) {
      const qty = Number(it.quantity);
      if (it.quantity === undefined || it.quantity === null || it.quantity === '' || !Number.isFinite(qty) || qty <= 0) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'quantity'], message: 'مقدار/تعداد باید عددی بزرگ‌تر از صفر باشد' });
      }
    }
    const unitPrice = it.unit_price ?? it.unitPrice ?? it.price;
    if (!nonNegativeMoney('unit_price')(unitPrice)) {
      ctx.addIssue({ code: 'custom', path: ['items', i, 'unit_price'], message: 'قیمت واحد نمی‌تواند منفی یا نامعتبر باشد' });
    }
    if (!nonNegativeMoney('discount')(it.discount)) {
      ctx.addIssue({ code: 'custom', path: ['items', i, 'discount'], message: 'تخفیف نمی‌تواند منفی یا نامعتبر باشد' });
    }
  }
};

// v7.0.32 (TD-197 / audit P1-7): مالیات ساختاریافته اسناد فروش — رشته فقط به‌صورت عدد نامنفی پذیرفته می‌شود
const vatPercentInput = z.union([
  z.number().min(0).max(100),
  z.string().regex(/^\d+(\.\d+)?$/, 'درصد مالیات بر ارزش افزوده نامعتبر است'),
  z.null()
]).optional();
const vatAmountInput = z.union([
  z.number().min(0),
  z.string().regex(/^\d+(\.\d+)?$/, 'مبلغ مالیات بر ارزش افزوده نامعتبر است'),
  z.null()
]).optional();
// v7.0.63 (TD-198): نرخ تسعیر سند غیرریالی (ریال به ازای یک واحد ارز)
const exchangeRateInput = z.union([
  z.number().positive('نرخ تسعیر باید بزرگ‌تر از صفر باشد'),
  z.string().regex(/^\d+(\.\d+)?$/, 'نرخ تسعیر نامعتبر است'),
  z.null()
]).optional();

export const documentCreateSchema = z.object({
  body: z.object({
    // v9.0.238 (TD-770، تصمیم ت۲ الف): انتقال بین انبارها فقط از transfers.routes.ts (TD-489)
    docType: z.enum(['receipt', 'production_receipt', 'invoice', 'proforma', 'return', 'audit', 'remittance', 'waste'], {
      error: (issue) => issue.input === 'transfer'
        ? 'انتقال بین انبارها فقط از صفحه «انتقال بین انبارها» ثبت می‌شود'
        : 'نوع سند نامعتبر است'
    }),
    refNumber: z.union([z.string().min(1, 'شماره مرجع الزامی است'), z.number().int().positive()]),
    date: z.string().min(1, 'تاریخ سند الزامی است'),
    items: z.array(documentItemInputSchema).min(1, 'حداقل یک کالا باید ثبت شود'),
    user: z.string().max(100).nullable().optional(),
    inOut: z.enum(['in', 'out']).nullable().optional(),
    buyer_name: z.string().max(255).nullable().optional(),
    buyerName: z.string().max(255).nullable().optional(),
    buyer_city: z.string().max(100).nullable().optional(),
    buyerCity: z.string().max(100).nullable().optional(),
    buyer_phone: z.string().max(50).nullable().optional(),
    buyerPhone: z.string().max(50).nullable().optional(),
    buyer_address: z.string().max(500).nullable().optional(),
    buyerAddress: z.string().max(500).nullable().optional(),
    status: z.enum(['draft', 'proforma', 'final']).nullable().optional(),
    currency: z.string().max(10).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    location: z.string().max(100).nullable().optional(),
    crmLeadId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/), z.null()]).optional(),
    projectId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/), z.null()]).optional(),
    // v7.0.81 (TD-230): فاکتور فروش اصلی سند برگشت از فروش
    returnOfDocumentId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/), z.null()]).optional(),
    vatPercent: vatPercentInput,
    vatAmount: vatAmountInput,
    exchangeRate: exchangeRateInput,
    attachments: z.array(z.any()).optional()
  }).superRefine((body, ctx) => {
    // اسناد انبارگردانی از physical_stock استفاده می‌کنند و مقدار صفر در آن‌ها مجاز است
    refineDocumentItems(ctx, body.items as unknown as Array<Record<string, unknown>>, body.docType === 'audit');
  })
});

export const finalizeDocumentSchema = z.object({
  body: z.object({
    user: z.string().max(100).optional(),
    vatPercent: vatPercentInput,
    vatAmount: vatAmountInput,
    exchangeRate: exchangeRateInput,
  }).optional(),
  params: z.object({
    id: numericIdString
  })
});

export const updateDocumentNotesSchema = z.object({
  body: z.object({
    notes: z.string().max(2000).optional()
  }),
  params: z.object({
    id: numericIdString
  })
});

export const documentUpdateSchema = z.object({
  body: z.object({
    refNumber: z.union([z.string().min(1), z.number().int().positive()]).optional(),
    date: z.string().min(1).optional(),
    user: z.string().max(100).nullable().optional(),
    buyer_name: z.string().max(255).nullable().optional(),
    buyerName: z.string().max(255).nullable().optional(),
    buyer_city: z.string().max(100).nullable().optional(),
    buyerCity: z.string().max(100).nullable().optional(),
    buyer_phone: z.string().max(50).nullable().optional(),
    buyerPhone: z.string().max(50).nullable().optional(),
    buyer_address: z.string().max(500).nullable().optional(),
    buyerAddress: z.string().max(500).nullable().optional(),
    status: z.string().optional().refine(
      (v) => v === undefined || v === 'draft' || v === 'proforma',
      { message: 'گذار وضعیت سند به «نهایی» از مسیر ویرایش مجاز نیست؛ برای نهایی‌سازی از عملیات «نهایی‌سازی و تایید» استفاده کنید.' }
    ),
    currency: z.string().max(10).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    vatPercent: vatPercentInput,
    vatAmount: vatAmountInput,
    exchangeRate: exchangeRateInput,
    location: z.string().max(100).nullable().optional(),
    // V10-4.3: پذیرش لینک رسمی CRM در ویرایش سند
    crmLeadId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/), z.null()]).optional(),
    expectedVersion: z.number().int().positive().optional(),
    version: z.number().int().positive().optional(),
    attachments: z.array(z.any()).optional(),
    items: z.array(documentItemInputSchema).min(1, 'حداقل یک کالا باید ثبت شود').optional()
  }).superRefine((body, ctx) => {
    if (body.items) {
      refineDocumentItems(ctx, body.items as unknown as Array<Record<string, unknown>>, false);
    }
  }),
  params: z.object({
    id: numericIdString
  }).passthrough()
}).passthrough();

export const paramsRefSchema = z.object({
  params: z.object({
    ref: z.string().min(1, 'شماره سند الزامی است')
  })
});

export const paramsDocIdOrRefSchema = z.object({
  params: z.object({
    id: z.string().min(1, 'شناسه یا شماره سند الزامی است')
  })
});

export const nextRefQuerySchema = z.object({
  query: z.object({
    type: z.enum(['receipt', 'production_receipt', 'invoice', 'proforma', 'return', 'audit', 'transfer', 'remittance', 'waste'], {
      message: 'نوع سند نامعتبر است'
    })
  }).passthrough()
}).passthrough();

export const documentsQuerySchema = z.object({
  query: z.object({
    type: z.enum(['receipt', 'production_receipt', 'invoice', 'proforma', 'return', 'audit', 'transfer', 'remittance', 'waste']).optional(),
    status: z.enum(['draft', 'proforma', 'final']).optional(),
    search: z.string().max(100).optional(),
    startDate: storageDateParam,
    endDate: storageDateParam,
    projectId: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    export: z.union([z.string(), z.boolean()]).optional()
  }).passthrough()
}).passthrough();

export const auditItemsQuerySchema = z.object({
  query: z.object({
    location: z.string().max(100).optional()
  }).passthrough()
}).passthrough();

// V9-1.2: نگاه غیرمخرب (Peek) — شماره بعدی را بدون افزایش شمارنده برمی‌گرداند تا
// بارگذاری فرم‌ها و فرم‌های رهاشده هرگز شماره سند نسوزانند.
router.get('/documents/next-ref', authorizePermission(...READ_PERMISSIONS.documentNextRef), validate(nextRefQuerySchema), asyncHandler(async (req, res) => {
  const nextRef = await DocumentService.peekNextRef(String(req.query.type));
  res.json({ nextRef });
}));

const docTypeTitles: Record<string, string> = {
  receipt: 'رسید خرید مواد و کالا',
  production_receipt: 'رسید تولید و تحویل محصول',
  invoice: 'فاکتور فروش',
  proforma: 'پیش‌فاکتور',
  return: 'سند مرجوعی',
  audit: 'سند انبارگردانی',
  transfer: 'حواله انتقال',
  remittance: 'حواله خروج',
  waste: 'سند ضایعات'
};

/** v9.0.125 (TD-541 / TD-771): کاربر مجوز این کار را دارد، وگرنه ۴۰۳ با نام فارسی مجوز */
async function assertMayRecordDocument(user: AuthUserPayload | undefined, permission: string, action: string): Promise<void> {
  if (await can(user, permission)) return;
  throw new ForbiddenError(`${action} مجوز «${permissionDefinition(permission)?.title ?? permission}» را می‌خواهد.`, { permission }, 'DOCUMENT_PERMISSION_REQUIRED');
}

// v9.0.125 (TD-541 / TD-771، تصمیم ت۱ بسته ۸): مجوز هر سند از جدول «نوع سند و وضعیت ← مجوز» (documentPermissions.ts)
// خوانده می‌شود. پیش‌تر هر نقشی جز چهار کد ثابت «کاربر فروش» بود: سند قطعی نمی‌زد و پیش‌نویسش پیش‌فاکتور می‌شد
router.post('/documents', authorizePermission('documents.create', 'documents.finalize', 'warehouse.in', 'warehouse.out', 'audit.apply'), idempotency({ scope: 'documents' }), validate(documentCreateSchema), asyncHandler(async (req, res) => {
  const requestedType = String(req.body.docType);
  // v9.0.238 (TD-770): جهت گردش از نوع سند؛ `inOut` ناسازگار پیش از سنجش مجوز ۴۲۲ می‌گیرد
  assertRecordableDocument(requestedType, req.body.inOut);
  const recordStatus = createdDocumentStatus(requestedType, req.body.status);
  await assertMayRecordDocument(req.user, permissionToCreateDocument(req.body),
    `ثبت ${docTypeTitles[requestedType] ?? 'سند'}${recordStatus === 'final' ? ' به‌صورت قطعی' : ''}`);
  // پیش‌فاکتورِ کسی که سند فروش را قطعی نمی‌کند، مانند پیش، نوع «پیش‌فاکتور» می‌گیرد (شماره و تاریخش هنگام نهایی‌سازی
  // از سری فاکتور، TD-317 و TD-410). یکی شدن دو شکل پیش‌فاکتور کار B08-31 است؛ پیش‌نویس همیشه پیش‌نویس می‌ماند
  if (requestedType === 'invoice' && recordStatus === 'proforma' && !await can(req.user, SALES_FINALIZE_PERMISSION)) {
    req.body.docType = 'proforma';
  }

  // V10-4.3: اتصال سند به پرونده CRM فقط با فیلد صریح crmLeadId — حذف اتکا به تگ متنی «CRM #n»
  let targetLeadId: number | null = null;
  if (req.body.crmLeadId !== undefined && req.body.crmLeadId !== null && String(req.body.crmLeadId).trim() !== '') {
    const parsed = Number(req.body.crmLeadId);
    if (!isNaN(parsed) && parsed > 0) {
      targetLeadId = parsed;
    } else {
      throw new ValidationError(`شناسه پرونده فروش (crmLeadId) نامعتبر است: ${req.body.crmLeadId}`);
    }
  }

  const isProforma = req.body.status === 'proforma' || req.body.docType === 'proforma';

  // V6 Sub-phase 2.4 (TD-139): اعتبارسنجی سقف رزرو کالا اکنون به شکل متمرکز و اتمیک با قفل سطری درون DocumentService.createDocument انجام می‌گیرد.

  // v7.0.102 (TD-233): رزرو پروژه حواله خروج داخل همان تراکنش ثبت سند کم می‌شود (پیش‌تر بعد از ثبت، بیرون از تراکنش و با بلعیدن خطا)
  // v8.0.4 (TD-257): سند انبار با تاریخ پیش از آخرین گردش کالا فقط با مجوز «ثبت سند انبار با تاریخ گذشته»
  const allowBackdate = await userHasRoleOrPermission(req.user, BACKDATE_PERMISSION);
  // v9.0.13 (TD-424): «یک پیش‌فاکتور برای هر پرونده» زیر قفل ردیف پرونده و پیوند و علامت پرونده در همان تراکنش سند
  // (پیش‌تر بررسی بی قفل پیش از تراکنش و علامت‌گذاری پس از commit؛ پیش‌فاکتورهای هم‌زمان همه ثبت می‌شدند)
  const { docId: newDocId, projectReservation } = await orm.transaction(async (tx) => {
    const lead = isProforma && targetLeadId ? await lockLeadForNewProforma(tx, targetLeadId) : null;
    const created = await DocumentService.createDocumentWithDetails({ ...req.body, user: sessionUserLabel(req.user), externalTx: tx }, { userId: req.user?.id, allowBackdate });
    // V10-4.3: لینک رسمی سند به پرونده CRM (صدور خودکار و دستی، هر دو مسیر از همین نقطه ست می‌کنند)
    if (targetLeadId) await tx.update(documents).set({ crmLeadId: targetLeadId }).where(eq(documents.id, created.docId));
    if (lead) await markLeadProforma(tx, lead, created.docId, req.user?.full_name || 'سیستم');
    // v9.0.39 (TD-446، ت۴): فقط سند فروش پیش‌نویس یا پیش‌فاکتور، در همین تراکنش، وارد گردش کار تأیید می‌شود و خطای شروع
    // ثبت سند را رد می‌کند. پیش‌تر هر سند، حتی رسید و فاکتور قطعی، پس از commit و با خطای بلعیده فرایند می‌گرفت
    if (await needsApprovalWorkflow(tx, created.docId)) {
      await WorkflowEngineService.maybeStartWorkflow({
        entityType: 'document',
        entityId: created.docId,
        userId: req.user?.id,
        userName: req.user?.full_name || req.user?.username || 'فروشنده',
        tx,
      });
    }
    return created;
  });
  const title = docTypeTitles[req.body.docType] || 'سند انبار';

  const hasDiscounts = (req.body.items || []).some((i: { discount?: unknown }) => Number(i.discount || 0) > 0);
  const totalLines = (req.body.items || []).length;
  const totalQty = (req.body.items || []).reduce((acc: number, cur: { quantity?: unknown }) => acc + (Number(cur.quantity || 0)), 0);

  // V10-2.2 (TD-020): همگام‌سازی سند حسابداری به صورت اتمیک درون تراکنش DocumentService.createDocument انجام شده است

  await logActivity({
    req,
    action: 'CREATE',
    entity: title,
    entityId: newDocId,
    description: `ثبت ${title} جدید به شماره "${req.body.refNumber}" (${totalLines} قلم کالا${hasDiscounts ? ' همراه با تخفیف ویژه' : ''})`,
    details: {
      after: {
        docId: newDocId,
        docType: req.body.docType,
        refNumber: req.body.refNumber,
        date: req.body.date,
        status: req.body.status || 'draft',
        buyerName: req.body.buyer_name,
        buyerPhone: req.body.buyer_phone,
        currency: req.body.currency || 'IRR',
        notes: req.body.notes,
        totalLines,
        totalQty,
        hasDiscounts,
        items: req.body.items
      }
    }
  });

  res.json({ success: true, docId: newDocId, projectReservation });
}));

// v9.0.140 (TD-890، ت۱۰ الف): فهرست کامل با مجوز بخش اسناد؛ مجوز انبارگردانی فقط فهرست سندهای شمارش و انتقال
router.get('/documents', authorizePermission(...READ_PERMISSIONS.documents, ...READ_PERMISSIONS.stockCountDocuments), validate(documentsQuerySchema), asyncHandler(async (req, res) => {
  const type = req.query.type as string;
  assertDocumentTypeReadable(await readableDocumentTypes(req.user, READ_PERMISSIONS.documents), type);
  const status = req.query.status as string;
  const search = req.query.search as string;
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;
  // V3.1.46 (TD-070): فیلتر پروژه‌محور اسناد
  // V9-1.3: صفحه‌بندی NaN-safe با سقف — جلوگیری از dump کل جدول با limit نامعتبر/عظیم
  const isPaginated = req.query.page !== undefined || req.query.limit !== undefined;
  const { page, limit } = parsePagination(req.query as Record<string, unknown>, { page: 1, limit: 50 });
  const isExport = String(req.query.export) === 'true';

  const result = await DocumentService.getDocuments({
    type,
    status,
    search,
    startDate,
    endDate,
    projectId: req.query.projectId as string | undefined,
    page: isPaginated ? page : undefined,
    limit: isPaginated ? limit : undefined,
    isExport
  });

  res.json(result);
}));

router.get('/documents/by-ref/:ref', authorizePermission(...READ_PERMISSIONS.documentRecord, ...READ_PERMISSIONS.stockCountDocuments), validate(paramsRefSchema), asyncHandler(async (req, res) => {
  const type = req.query.type as string;
  const readable = await readableDocumentTypes(req.user, READ_PERMISSIONS.documentRecord);
  assertDocumentTypeReadable(readable, type);
  const ref = req.params.ref;
  const docsResult = await DocumentService.getDocuments(type);
  const docList = Array.isArray(docsResult) ? docsResult : (docsResult?.data || []);
  const docSummary = docList.find((d: { ref_number?: string; id?: number }) => d.ref_number === ref);
  if (!docSummary) {
    throw new NotFoundError('سند یافت نشد');
  }
  const doc = await DocumentService.getDocumentById(docSummary.id);
  assertDocumentTypeReadable(readable, doc?.type);
  res.json(doc);
}));

router.get('/documents/audit-items', authorizePermission(...READ_PERMISSIONS.stockCountSheet), validate(auditItemsQuerySchema), asyncHandler(async (req, res) => {
  // v9.0.55 (TD-480): موقعیت با کد یا نام انبار (خالی = انبار پیش‌فرض)؛ موقعیت ناشناخته ۴۲۲. پیش‌تر موجودی با کلید خام
  // خوانده می‌شد و نام انبار (که برگه می‌فرستاد) ستون موجودی را برای همه کالاها ۰ می‌کرد
  res.json(await getStockCountSheetItems(orm, req.query.location));
}));

router.get('/documents/:id', authorizePermission(...READ_PERMISSIONS.documentRecord, ...READ_PERMISSIONS.stockCountDocuments), validate(paramsDocIdOrRefSchema), asyncHandler(async (req, res) => {
  const rawId = req.params.id;
  const readable = await readableDocumentTypes(req.user, READ_PERMISSIONS.documentRecord);
  const doc = await DocumentService.getDocumentByIdOrRef(rawId);
  if (!doc) throw new NotFoundError(`سند با شناسه یا عطف ${rawId} یافت نشد`);
  assertDocumentTypeReadable(readable, doc.type);
  res.json(doc);
}));

// v9.0.125 (TD-541 / TD-771): نهایی‌سازی همان مجوز ثبت قطعی همان نوع سند را می‌خواهد (پیش‌تر «ویرایش فاکتورها» بس بود و
// فروشنده پیش‌فاکتوری را که خودش قطعی نمی‌توانست ثبت کند از این مسیر قطعی می‌کرد)
router.put('/documents/:id/finalize', authorizePermission('documents.finalize', 'warehouse.in', 'warehouse.out'), idempotency({ scope: 'documents' }), validate(finalizeDocumentSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  const { vatAmount, vatPercent, exchangeRate } = req.body || {};
  const user = sessionUserLabel(req.user);
  const beforeDoc = await DocumentService.getDocumentById(docId);
  if (!beforeDoc) {
    throw new NotFoundError('سند مورد نظر یافت نشد.');
  }
  // نوع سند پس از ثبت عوض نمی‌شود، پس مجوز پیش از تراکنش سنجیده می‌شود
  const storedType = String(beforeDoc.type ?? '');
  await assertMayRecordDocument(req.user, permissionToFinalizeDocument(storedType), `قطعی کردن ${docTypeTitles[storedType] ?? 'سند'}`);

  const parsedVatAmount = vatAmount !== undefined && vatAmount !== null ? Number(vatAmount) : undefined;
  const parsedVatPercent = vatPercent !== undefined && vatPercent !== null ? Number(vatPercent) : undefined;

  const allowBackdate = await userHasRoleOrPermission(req.user, BACKDATE_PERMISSION);
  // v9.0.39 (TD-446، ت۴): سندی که بیرون از گردش کار قطعی می‌شود، فرایند تأیید در جریانش در همان تراکنش بسته می‌شود
  // (پیش‌تر ویجت سندِ قطعی «پیش‌نویس اولیه» نشان می‌داد و کارهایش در کارتابل می‌ماند)
  await orm.transaction(async (tx) => {
    await DocumentService.finalizeDocument(docId, user, tx, {
      vatAmount: !isNaN(Number(parsedVatAmount)) ? parsedVatAmount : undefined,
      vatPercent: !isNaN(Number(parsedVatPercent)) ? parsedVatPercent : undefined,
      exchangeRate: exchangeRate !== undefined && exchangeRate !== null ? Number(exchangeRate) : undefined,
      // v8.0.4 (TD-257): نهایی‌سازی پیش‌نویسِ با تاریخ پیش از آخرین گردش کالا فقط با مجوز
      allowBackdate,
    });
    await terminateOpenWorkflows(tx, {
      entityType: 'document', entityId: docId, actionKey: 'terminate', actionTitle: 'بستن فرایند سند قطعی',
      comment: 'سند بیرون از گردش کار قطعی شد', userId: req.user?.id, userName: req.user?.full_name || req.user?.username,
    });
  });

  // V10-2.2 (TD-020): سند دوبل حسابداری به صورت اتمیک درون تراکنش DocumentService.finalizeDocument صادر/به‌روزرسانی می‌شود
  
  await logActivity({
    req,
    action: 'UPDATE',
    entity: 'اسناد انبار',
    entityId: docId,
    description: `نهایی‌سازی و تایید قطعی سند شماره "${beforeDoc.ref_number || docId}" (${beforeDoc.type || ''})`,
    details: {
      docId,
      refNumber: beforeDoc.ref_number,
      docType: beforeDoc.type,
      beforeStatus: beforeDoc.status,
      afterStatus: 'final',
      itemsCount: beforeDoc.items?.length || 0,
      buyerName: beforeDoc.buyer_name
    }
  });

  res.json({ success: true });
}));

router.put('/documents/:id', authorizePermission('documents.edit'), validate(documentUpdateSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  await DocumentService.updateDocument(docId, { ...req.body, user: sessionUserLabel(req.user) });

  // V10-4.3: امکان ست/به‌روزرسانی لینک CRM هنگام ویرایش (null = قطع لینک)
  if ('crmLeadId' in req.body) {
    const parsedLead = req.body.crmLeadId === null || String(req.body.crmLeadId).trim() === '' ? null : Number(req.body.crmLeadId);
    if (!Number.isNaN(parsedLead)) {
      await orm.update(documents).set({ crmLeadId: parsedLead }).where(eq(documents.id, docId));
    }
  }

  await logActivity({
    req,
    action: 'UPDATE',
    entity: 'اسناد انبار / پیش‌فاکتور',
    entityId: docId,
    description: `ویرایش پیش‌فاکتور/سند شماره "${req.body.refNumber || docId}"`,
    details: {
      docId,
      refNumber: req.body.refNumber,
      buyerName: req.body.buyer_name,
      notes: req.body.notes,
      itemsCount: req.body.items?.length || 0
    }
  });

  res.json({ success: true, docId });
}));

router.put('/documents/:id/notes', authorizePermission('documents.edit'), validate(updateDocumentNotesSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  const { notes } = req.body;
  await DocumentService.updateDocumentNotes(docId, notes);
  res.json({ success: true });
}));

// V10-5.1: enforce documents.delete — مطابق ماتریس سید‌شده (admin همیشه عبور می‌کند)
router.delete('/documents/:id', authorizePermission('documents.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  const beforeDoc = await DocumentService.getDocumentById(docId);
  if (!beforeDoc) {
    throw new NotFoundError('سند یافت نشد.');
  }

  // فیلد قدیمی `name` در payload توکن‌های فعلی وجود ندارد؛ برای حفظ رفتار fallback نگه داشته شده است
  const sessionUser: (AuthUserPayload & { name?: string }) | undefined = req.user;
  const currentUser = sessionUser?.username || sessionUser?.name || 'system';
  // v9.0.12 (TD-423): پرونده فروش سند در همان تراکنش ابطال، پیش از قفل کالاها و سند، آزاد می‌شود و «فروش موفق» برمی‌گردد
  const released = await orm.transaction(async (tx) => {
    const lead = await releaseLeadOfVoidedDocument(tx, { id: docId, refNumber: beforeDoc.ref_number ?? null }, req.user?.full_name || req.user?.username || 'سیستم');
    await DocumentService.deleteDocument(docId, currentUser, tx);
    return lead;
  });

  await logActivity({
    req,
    action: 'DELETE',
    entity: 'اسناد انبار',
    entityId: docId,
    description: `حذف سند انبار شماره "${beforeDoc.ref_number || docId}" (نوع: ${beforeDoc.type || ''}، خریدار: ${beforeDoc.buyer_name || '—'})${released ? ` — پرونده فروش #${released.leadId} برای پیش‌فاکتور تازه باز شد${released.reopenedFromWon ? ' و از «فروش موفق» برگشت' : ''}` : ''}`,
    details: {
      before: {
        id: beforeDoc.id,
        refNumber: beforeDoc.ref_number,
        docType: beforeDoc.type,
        date: beforeDoc.date,
        status: beforeDoc.status,
        buyerName: beforeDoc.buyer_name,
        buyerPhone: beforeDoc.buyer_phone,
        notes: beforeDoc.notes,
        items: (beforeDoc.items || []).map((i) => ({
          itemId: i.item_id,
          name: i.name,
          code: i.code,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          discount: i.discount
        }))
      },
      deletedAt: new Date().toISOString()
    }
  });

  res.json({ success: true });
}));

export default router;
