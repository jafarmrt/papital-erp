import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authorize, authorizePermission } from '../middleware/authorize.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { idempotency } from '../middleware/idempotency.js';
import { DocumentService } from '../services/document.service.js';
import { AccountingService } from '../services/accounting.service.js';
import { WorkflowEngineService } from '../services/workflow/workflowEngineService.js';
import { ItemStockReservationService } from '../services/items/itemStockReservation.service.js';
import { logger } from '../middleware/logger.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../errors/customErrors.js';
import { logActivity } from '../lib/auditLogger.js';
import { orm } from '../db/drizzle.js';
import { crmLeads, crmActivities, productionProjects, items, customers, documents } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { getTodayJalaliDate } from '../utils.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { parsePagination } from '../lib/pagination.js';

const router = Router();
router.use(authenticateToken);

const nonNegativeMoney = (label: string) => (val: unknown): boolean =>
  val === undefined || val === null || (Number.isFinite(Number(val)) && Number(val) >= 0);

export const documentItemInputSchema = z.object({
  itemId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)]).transform(v => Number(v)),
  quantity: z.union([z.number(), z.string()]).optional(),
  unit_price: z.union([z.number(), z.string()]).optional(),
  unitPrice: z.union([z.number(), z.string()]).optional(),
  price: z.union([z.number(), z.string()]).optional(),
  discount: z.union([z.number(), z.string()]).optional(),
  system_stock: z.union([z.number(), z.string()]).optional(),
  physical_stock: z.union([z.number(), z.string()]).optional(),
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

export const documentCreateSchema = z.object({
  body: z.object({
    docType: z.enum(['receipt', 'production_receipt', 'invoice', 'proforma', 'return', 'audit', 'transfer', 'remittance', 'waste'], {
      message: 'نوع سند نامعتبر است'
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
    vatPercent: z.union([z.number().min(0).max(100), z.string(), z.null()]).optional(),
    vatAmount: z.union([z.number().min(0), z.string(), z.null()]).optional(),
    attachments: z.array(z.any()).optional()
  }).superRefine((body, ctx) => {
    // اسناد انبارگردانی از physical_stock استفاده می‌کنند و مقدار صفر در آن‌ها مجاز است
    refineDocumentItems(ctx, body.items as unknown as Array<Record<string, unknown>>, body.docType === 'audit');
  })
});

export const finalizeDocumentSchema = z.object({
  body: z.object({
    user: z.string().max(100).optional()
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
    location: z.string().max(100).nullable().optional(),
    // V10-4.3: پذیرش لینک رسمی CRM در ویرایش سند
    crmLeadId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/), z.null()]).optional(),
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
    startDate: z.string().max(30).optional(),
    endDate: z.string().max(30).optional(),
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

export const reconcileStockSchema = z.object({
  body: z.object({
    itemId: z.union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/), z.null()]).optional()
  }).optional()
});

// V9-1.2: نگاه غیرمخرب (Peek) — شماره بعدی را بدون افزایش شمارنده برمی‌گرداند تا
// بارگذاری فرم‌ها و فرم‌های رهاشده هرگز شماره سند نسوزانند.
router.get('/documents/next-ref', validate(nextRefQuerySchema), asyncHandler(async (req, res) => {
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

router.post('/documents', authorize('admin', 'manager', 'sales_manager', 'accountant', 'warehouse_keeper', 'documents.create', 'warehouse.in', 'warehouse.out'), idempotency({ scope: 'documents' }), validate(documentCreateSchema), asyncHandler(async (req, res) => {
  const userRole = req.user?.role;
  const isSalesUser = userRole === 'sales_manager' || (userRole !== 'admin' && userRole !== 'manager' && userRole !== 'warehouse_keeper' && userRole !== 'accountant');
  
  if (isSalesUser && req.body.status === 'final') {
    throw new ForbiddenError('کاربران فروش فقط مجاز به صدور پیش‌فاکتور می‌باشند. ثبت فاکتور نهایی و کسر از انبار باید توسط انباردار یا مدیر تایید گردد.');
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

  // REQUIREMENT 4: Check if a proforma already exists for this lead
  if (isProforma && targetLeadId) {
    const [existingLead] = await orm.select().from(crmLeads).where(and(eq(crmLeads.id, targetLeadId), eq(crmLeads.isDeleted, 0)));
    if (existingLead && existingLead.hasProforma === 1) {
      throw new ValidationError(`برای پرونده فروش «${existingLead.title}» قبلاً پیش‌فاکتور صادر شده است. هر پرونده فروش تنها مجاز به داشتن یک پیش‌فاکتور می‌باشد.`);
    }
  }

  // Validate stock reservations on exit remittance (inOut === 'out')
  if (req.body.inOut === 'out') {
    const reservationReport = await ItemStockReservationService.getReservedStockDetails();
    const targetProjId = req.body.projectId ? Number(req.body.projectId) : null;

    for (const docLine of req.body.items || []) {
      const itId = Number(docLine.itemId);
      const reqQty = Number(docLine.quantity || 0);
      if (reqQty <= 0) continue;

      const summary = reservationReport.itemSummaries.find(s => s.itemId === itId);
      if (summary && summary.totalReservedQty > 0) {
        let reservedForSelectedProject = 0;
        if (targetProjId) {
          const projReservations = summary.reservations.filter(
            r => r.sourceType === 'project' && Number(r.sourceId) === targetProjId
          );
          reservedForSelectedProject = projReservations.reduce((acc, r) => acc + r.reservedQty, 0);
        }

        const reservedForOther = summary.totalReservedQty - reservedForSelectedProject;
        const maxAllowed = Math.max(0, summary.currentStock - reservedForOther);

        if (reqQty > maxAllowed) {
          const otherNames = summary.reservations
            .filter(r => !(targetProjId && r.sourceType === 'project' && Number(r.sourceId) === targetProjId))
            .map(r => `«${r.sourceRef || r.sourceTitle}» (${r.reservedQty} ${r.unit})`)
            .join('، ');

          throw new ValidationError(
            `امکان خروج بیش از ${maxAllowed} ${summary.unit} برای کالا «${summary.itemName}» وجود ندارد. تعداد ${reservedForOther} ${summary.unit} برای سایر مصارف (${otherNames}) رزرو شده است.`
          );
        }
      }
    }
  }

  const newDocId = await DocumentService.createDocument(req.body);
  const title = docTypeTitles[req.body.docType] || 'سند انبار';

  // V10-4.3: لینک رسمی سند به پرونده CRM (صدور خودکار و دستی، هر دو مسیر از همین نقطه ست می‌کنند)
  if (targetLeadId) {
    await orm.update(documents).set({ crmLeadId: targetLeadId }).where(eq(documents.id, newDocId));
  }

  // If exit remittance document for a project, deduct/clear reserved items from project inventory control
  if (req.body.inOut === 'out' && req.body.projectId) {
    try {
      const targetProjId = Number(req.body.projectId);
      if (targetProjId && !isNaN(targetProjId)) {
        const [targetProj] = await orm
          .select()
          .from(productionProjects)
          .where(and(eq(productionProjects.id, targetProjId), eq(productionProjects.isDeleted, 0)));

        if (targetProj) {
          const invControl = (targetProj.inventoryControl as any) || {};
          let reservedList = Array.isArray(invControl.reservedItems) && invControl.reservedItems.length > 0
            ? [...invControl.reservedItems]
            : await ItemStockReservationService.getProjectReservedItems(targetProj);
          let changed = false;

          for (const docLine of req.body.items || []) {
            const lineQty = Number(docLine.quantity || 0);
            if (lineQty <= 0) continue;

            const [itemData] = await orm.select().from(items).where(eq(items.id, Number(docLine.itemId)));
            if (!itemData) continue;

            const resIdx = reservedList.findIndex((r: { itemId?: unknown; itemCode?: unknown; itemName?: unknown }) =>
              (r.itemId && itemData.id && Number(r.itemId) === Number(itemData.id)) ||
              (r.itemCode && itemData.code && String(r.itemCode).trim().toLowerCase() === String(itemData.code).trim().toLowerCase()) ||
              (r.itemName && itemData.name && String(r.itemName).trim().toLowerCase() === String(itemData.name).trim().toLowerCase())
            );

            if (resIdx !== -1) {
              changed = true;
              const currentResQty = Number(reservedList[resIdx].reservedQty || 0);
              const newResQty = Math.max(0, currentResQty - lineQty);
              if (newResQty > 0) {
                reservedList[resIdx] = {
                  ...reservedList[resIdx],
                  reservedQty: newResQty
                };
              } else {
                reservedList.splice(resIdx, 1);
              }
            }
          }

          if (changed) {
            const updatedInvControl = {
              ...invControl,
              reservedItems: reservedList,
              isReserved: reservedList.length > 0,
              lastUpdated: new Date().toISOString()
            };

            await orm.update(productionProjects).set({
              inventoryControl: updatedInvControl
            }).where(eq(productionProjects.id, targetProjId));
          }
        }
      }
    } catch (projDeductErr) {
      logger.error({ message: 'Error deducting project reservation on document create', error: projDeductErr });
    }
  }

  // If proforma issued for a lead, mark lead as having proforma and update stage
  if (isProforma && targetLeadId) {
    const nowIso = new Date().toISOString();
    await orm.update(crmLeads).set({
      hasProforma: 1,
      proformaId: newDocId,
      stage: 'proposal',
      status: 'active',
      updatedAt: nowIso
    }).where(eq(crmLeads.id, targetLeadId));

    await orm.insert(crmActivities).values({
      leadId: targetLeadId,
      type: 'quote',
      title: `صدور پیش‌فاکتور شماره ${req.body.refNumber}`,
      description: `پیش‌فاکتور رسمی به شماره ${req.body.refNumber} در سیستم ثبت گردید.`,
      loggedBy: req.user?.full_name || 'سیستم',
      assignedTo: req.user?.full_name || '',
      activityDate: new Date().toLocaleDateString('fa-IR')
    });
  }

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

  // Automatically start/attach DOC_APPROVAL_WORKFLOW for documents
  try {
    await WorkflowEngineService.startWorkflow({
      workflowCode: 'DOC_APPROVAL_WORKFLOW',
      entityType: 'document',
      entityId: String(newDocId),
      userId: req.user?.id,
      userName: req.user?.fullName || req.user?.username || 'فروشنده'
    });
  } catch (wfErr) {
    const errMsg = wfErr instanceof Error ? wfErr.message : String(wfErr);
    logger.warn(`[DocumentRoute] Workflow auto-start for doc ${newDocId}: ${errMsg}`);
  }

  res.json({ success: true, docId: newDocId });
}));

router.get('/documents', validate(documentsQuerySchema), asyncHandler(async (req, res) => {
  const type = req.query.type as string;
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

router.get('/documents/by-ref/:ref', validate(paramsRefSchema), asyncHandler(async (req, res) => {
  const type = req.query.type as string;
  const ref = req.params.ref;
  const docsResult = await DocumentService.getDocuments(type);
  const docList = Array.isArray(docsResult) ? docsResult : (docsResult?.data || []);
  const docSummary = docList.find((d: { ref_number?: string; id?: number }) => d.ref_number === ref);
  if (!docSummary) {
    throw new NotFoundError('سند یافت نشد');
  }
  const doc = await DocumentService.getDocumentById(docSummary.id);
  res.json(doc);
}));

router.get('/documents/audit-items', validate(auditItemsQuerySchema), asyncHandler(async (req, res) => {
  const location = (req.query.location as string) || 'main';
  const allItems = await orm
    .select()
    .from(items)
    .where(eq(items.isDeleted, 0))
    .orderBy(items.code);

  const formatted = allItems.map((item) => {
    const stocksObj = (item.stocks as Record<string, number>) || {};
    let locStock = Number(item.currentStock || 0);
    if (location && stocksObj[location] !== undefined) {
      locStock = Number(stocksObj[location]);
    }
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      category: item.category,
      type: item.type,
      system_stock: locStock,
      physical_stock: '',
      location
    };
  });

  res.json(formatted);
}));

router.get('/documents/:id/settlement-status', validate(paramsIdSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  if (isNaN(docId) || docId <= 0) {
    throw new ValidationError('شناسه سند نامعتبر است');
  }
  const status = await DocumentService.getInvoiceSettlementStatus(docId);
  res.json(status);
}));

router.get('/documents/:id', validate(paramsDocIdOrRefSchema), asyncHandler(async (req, res) => {
  const rawId = req.params.id;
  const doc = await DocumentService.getDocumentByIdOrRef(rawId);
  if (!doc) throw new NotFoundError(`سند با شناسه یا عطف ${rawId} یافت نشد`);
  res.json(doc);
}));

router.put('/documents/:id/finalize', authorize('admin', 'manager', 'warehouse_keeper', 'accountant', 'documents.edit', 'warehouse.in', 'warehouse.out'), idempotency({ scope: 'documents' }), validate(finalizeDocumentSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  const { user } = req.body || {};
  const beforeDoc = await DocumentService.getDocumentById(docId);
  if (!beforeDoc) {
    throw new NotFoundError('سند مورد نظر یافت نشد.');
  }

  await DocumentService.finalizeDocument(docId, user);

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

router.put('/documents/:id', authorize('admin', 'manager', 'sales_manager', 'accountant', 'warehouse_keeper', 'documents.edit'), validate(documentUpdateSchema), asyncHandler(async (req, res) => {
  const docId = Number(req.params.id);
  await DocumentService.updateDocument(docId, req.body);

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

router.put('/documents/:id/notes', authorize('admin', 'manager', 'documents.edit'), validate(updateDocumentNotesSchema), asyncHandler(async (req, res) => {
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

  // V10-4.3: حذف پیش‌فاکتور → رفع گره یک‌طرفه از پرونده CRM (hasProforma=0، proformaId=null)
  const wasProforma = beforeDoc.type === 'proforma' || beforeDoc.status === 'proforma';
  let releasedLeadId: number | null = null;
  if (wasProforma) {
    const [linkedLead] = await orm.select().from(crmLeads)
      .where(and(eq(crmLeads.proformaId, docId), eq(crmLeads.hasProforma, 1), eq(crmLeads.isDeleted, 0)));
    if (linkedLead) {
      await orm.update(crmLeads).set({
        hasProforma: 0,
        proformaId: null,
        updatedAt: new Date().toISOString()
      }).where(eq(crmLeads.id, linkedLead.id));
      releasedLeadId = linkedLead.id;

      await orm.insert(crmActivities).values({
        leadId: linkedLead.id,
        customerId: linkedLead.customerId,
        type: 'note',
        title: 'حذف پیش‌فاکتور',
        description: `پیش‌فاکتور شماره "${beforeDoc.ref_number || docId}" حذف شد؛ پرونده فروش جهت صدور مجدد پیش‌فاکتور بازگشایی گردید.`,
        loggedBy: (req as any).user?.full_name || (req as any).user?.username || 'سیستم',
        assignedTo: linkedLead.assignedTo || '',
        activityDate: getTodayJalaliDate(),
        createdAt: new Date().toISOString(),
        isDeleted: 0
      });
    }
  }

  const currentUser = (req as any).user?.username || (req as any).user?.name || 'system';
  await DocumentService.deleteDocument(docId, currentUser);

  await logActivity({
    req,
    action: 'DELETE',
    entity: 'اسناد انبار',
    entityId: docId,
    description: `حذف سند انبار شماره "${beforeDoc.ref_number || docId}" (نوع: ${beforeDoc.type || ''}، خریدار: ${beforeDoc.buyer_name || '—'})${releasedLeadId ? ` — پرونده CRM #${releasedLeadId} از حالت gated خارج شد` : ''}`,
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

router.post('/documents/reconcile-stock', authorize('admin', 'manager', 'warehouse_keeper'), validate(reconcileStockSchema), asyncHandler(async (req, res) => {
  const targetItemId = req.body?.itemId ? Number(req.body.itemId) : undefined;
  const result = await DocumentService.reconcileAndRebuildStock(targetItemId);

  await logActivity({
    req,
    action: 'UPDATE',
    entity: 'انبارداری و موجودی',
    entityId: targetItemId ? String(targetItemId) : 'ALL',
    description: `انبارگردانی و تطبیق ریاضی موجودی کالاها بر پایه کاردکس اسناد (اقلام بررسی‌شده: ${result.reconciledCount}، مغایرت‌های اصلاح‌شده: ${result.discrepanciesFixed})`,
    details: result
  });

  res.json({
    success: true,
    message: `انبارگردانی و تطبیق کاردکس با موفقیت انجام شد. ${result.discrepanciesFixed} مغایرت اصلاح گردید.`,
    ...result
  });
}));

export default router;
