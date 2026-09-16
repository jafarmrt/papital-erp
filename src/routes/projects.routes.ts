import { Router } from 'express';
import { eq, desc, and, sql, asc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { productionProjects, projectStages, items, customers, projectProductStageProgress } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { authorizePermission } from '../middleware/authorize.js';
import { logActivity } from '../lib/auditLogger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { validateLockOrder, sortIdsForLocking, LockHierarchyLevel, LockableResource, withOrderedLocks } from '../lib/lockOrder.js';
import { businessNowIsoDateTime } from '../lib/businessClock.js';
import { DocumentService } from '../services/document.service.js';
import { NotFoundError, ValidationError } from '../errors/customErrors.js';
import { inArray } from 'drizzle-orm';

const router = Router();
router.use(authenticateToken);

const deleteProjectStageSchema = z.object({
  params: z.object({
    id: numericIdString,
    stageId: numericIdString,
  })
});

const createProjectSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان پروژه الزامی است'),
    project_code: z.string().optional(),
    customer_id: z.union([z.number(), z.string(), z.null()]).optional(),
    customer_name: z.string().optional(),
    item_id: z.union([z.number(), z.string(), z.null()]).optional(),
    item_code: z.string().optional(),
    item_name: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    priority: z.string().optional(),
    description: z.string().optional(),
    initial_stages: z.array(z.record(z.string(), z.unknown())).optional(),
    products: z.array(z.unknown()).optional(),
    inventory_control: z.unknown().optional(),
    inventoryControl: z.unknown().optional(),
    stage_schedules: z.unknown().optional(),
    stageSchedules: z.unknown().optional(),
    custom_stages: z.array(z.unknown()).optional(),
    customStages: z.array(z.unknown()).optional(),
    attachments: z.array(z.unknown()).optional(),
  })
});

const updateProjectSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    project_code: z.string().optional(),
    customer_id: z.union([z.number(), z.string(), z.null()]).optional(),
    customer_name: z.string().optional(),
    item_id: z.union([z.number(), z.string(), z.null()]).optional(),
    item_code: z.string().optional(),
    item_name: z.string().optional(),
    quantity: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    description: z.string().optional(),
    products: z.array(z.unknown()).optional(),
    inventory_control: z.unknown().optional(),
    inventoryControl: z.unknown().optional(),
    stage_schedules: z.unknown().optional(),
    stageSchedules: z.unknown().optional(),
    custom_stages: z.array(z.unknown()).optional(),
    customStages: z.array(z.unknown()).optional(),
    attachments: z.array(z.unknown()).optional(),
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

const addProjectToInventorySchema = z.object({
  body: z.preprocess((val: unknown) => {
    if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>;
        if (!v.itemsToAdd && (v.itemId || v.item_id)) {
        return {
          itemsToAdd: [{
            itemId: v.itemId || v.item_id,
            quantity: v.quantity,
            location: v.location,
            notes: v.description || v.notes,
            unitPrice: v.unitPrice || v.unit_price
          }],
          markCompleted: Boolean(v.markCompleted)
        };
      }
    }
    return val;
  }, z.object({
    itemsToAdd: z.array(z.object({
      itemId: z.union([z.number(), z.string()]),
      quantity: z.union([z.number(), z.string()]),
      location: z.string().optional(),
      notes: z.string().optional(),
      unitPrice: z.union([z.number(), z.string()]).optional()
    })).min(1, 'حداقل یک محصول برای ورود به انبار الزامی است'),
    markCompleted: z.boolean().optional()
  })),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

const createProjectStageSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'عنوان مرحله الزامی است'),
    status: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    assigned_personnel: z.array(z.unknown()).optional(),
    required_resources: z.array(z.unknown()).optional(),
    notes: z.string().optional()
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است')
  })
});

const updateProjectStageSchema = z.object({
  body: z.object({
    title: z.string().optional(),
    stage_order: z.union([z.number(), z.string()]).optional(),
    status: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    assigned_personnel: z.array(z.unknown()).optional(),
    required_resources: z.array(z.unknown()).optional(),
    progress_percent: z.union([z.number(), z.string()]).optional(),
    notes: z.string().optional()
  }),
  params: z.object({
    id: z.string().regex(/^\d+$/, 'شناسه پروژه نامعتبر است'),
    stageId: z.string().regex(/^\d+$/, 'شناسه مرحله نامعتبر است')
  })
});

export interface FormattedStage {
  id?: number;
  project_id: number;
  projectId: number;
  stage_order: number;
  stageOrder: number;
  title: string;
  status: string;
  start_date: string;
  startDate: string;
  end_date: string;
  endDate: string;
  assigned_personnel: unknown[];
  assignedPersonnel: unknown[];
  required_resources: unknown[];
  requiredResources: unknown[];
  progress_percent: number;
  progressPercent: number;
  notes: string;
  completed_at: string;
  completedAt: string;
  is_deleted: number;
  completed_skus_count?: number;
  completedSkusCount?: number;
  applicable_skus_count?: number;
  applicableSkusCount?: number;
}

export interface StageLike {
  id?: number;
  projectId?: number | null;
  project_id?: number | null;
  stageOrder?: number | null;
  stage_order?: number | null;
  title?: string | null;
  status?: string | null;
  startDate?: string | null;
  start_date?: string | null;
  endDate?: string | null;
  end_date?: string | null;
  assignedPersonnel?: unknown;
  assigned_personnel?: unknown;
  requiredResources?: unknown;
  required_resources?: unknown;
  progressPercent?: number | null;
  progress_percent?: number | null;
  notes?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  isDeleted?: number | null;
  is_deleted?: number | null;
  completedSkusCount?: number | null;
  completed_skus_count?: number | null;
  applicableSkusCount?: number | null;
  applicable_skus_count?: number | null;
}

function formatStage(s: StageLike | null | undefined): FormattedStage | null {
  if (!s) return null;
  const pId = Number(s.projectId ?? s.project_id ?? 0);
  const sOrder = Number(s.stageOrder ?? s.stage_order ?? 1);
  const sDate = String(s.startDate ?? s.start_date ?? '');
  const eDate = String(s.endDate ?? s.end_date ?? '');
  const cAt = String(s.completedAt ?? s.completed_at ?? '');
  const assigned = Array.isArray(s.assignedPersonnel) 
    ? s.assignedPersonnel 
    : (Array.isArray(s.assigned_personnel) ? s.assigned_personnel : []);
  const resources = Array.isArray(s.requiredResources) 
    ? s.requiredResources 
    : (Array.isArray(s.required_resources) ? s.required_resources : []);
  const prog = Number(s.progressPercent ?? s.progress_percent ?? 0);
  const compSkus = s.completedSkusCount ?? s.completed_skus_count;
  const appSkus = s.applicableSkusCount ?? s.applicable_skus_count;

  return {
    id: s.id,
    project_id: pId,
    projectId: pId,
    stage_order: sOrder,
    stageOrder: sOrder,
    title: s.title || '',
    status: s.status || 'pending',
    start_date: sDate,
    startDate: sDate,
    end_date: eDate,
    endDate: eDate,
    assigned_personnel: assigned,
    assignedPersonnel: assigned,
    required_resources: resources,
    requiredResources: resources,
    progress_percent: prog,
    progressPercent: prog,
    notes: s.notes || '',
    completed_at: cAt,
    completedAt: cAt,
    is_deleted: Number(s.isDeleted ?? s.is_deleted ?? 0),
    completed_skus_count: compSkus !== undefined && compSkus !== null ? Number(compSkus) : undefined,
    completedSkusCount: compSkus !== undefined && compSkus !== null ? Number(compSkus) : undefined,
    applicable_skus_count: appSkus !== undefined && appSkus !== null ? Number(appSkus) : undefined,
    applicableSkusCount: appSkus !== undefined && appSkus !== null ? Number(appSkus) : undefined
  };
}

export interface ProjectLike {
  id: number;
  projectCode?: string | null;
  project_code?: string | null;
  title?: string | null;
  customerId?: number | null;
  customer_id?: number | null;
  customerName?: string | null;
  customer_name?: string | null;
  itemId?: number | null;
  item_id?: number | null;
  itemCode?: string | null;
  item_code?: string | null;
  itemName?: string | null;
  item_name?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  startDate?: string | null;
  start_date?: string | null;
  endDate?: string | null;
  end_date?: string | null;
  status?: string | null;
  priority?: string | null;
  description?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  createdBy?: string | null;
  created_by?: string | null;
  products?: unknown;
  inventoryControl?: unknown;
  inventory_control?: unknown;
  stageSchedules?: unknown;
  stage_schedules?: unknown;
  customStages?: unknown;
  custom_stages?: unknown;
  attachments?: unknown;
  isDeleted?: number | null;
  is_deleted?: number | null;
  itemImage?: string | null;
  itemThumbnail?: string | null;
  item_image?: string | null;
}

function formatProject(p: ProjectLike | null | undefined, rawStages: StageLike[] = [], extra: { itemImage?: string | null; itemThumbnail?: string | null; item_image?: string | null } = {}) {
  if (!p) return null;
  const stages = (rawStages || []).map(formatStage).filter((s): s is FormattedStage => s !== null);
  const totalStages = stages.length;
  const completedStages = stages.filter((s) => s.status === 'completed').length;
  
  let overallProgress = 0;
  if (totalStages > 0) {
    const sumProgress = stages.reduce((acc: number, s) => acc + (s.progress_percent || (s.status === 'completed' ? 100 : 0)), 0);
    overallProgress = Math.round(sumProgress / totalStages);
  }

  const projCode = p.projectCode ?? p.project_code ?? '';
  const custName = p.customerName ?? p.customer_name ?? '';
  const itemName = p.itemName ?? p.item_name ?? '';
  const itemCode = p.itemCode ?? p.item_code ?? '';

  const products = Array.isArray(p.products) ? p.products : [];
  const inventoryControl = p.inventoryControl ?? p.inventory_control ?? {};
  const stageSchedules = p.stageSchedules ?? p.stage_schedules ?? {};
  const customStages = Array.isArray(p.customStages) ? p.customStages : (Array.isArray(p.custom_stages) ? p.custom_stages : []);

  return {
    id: p.id,
    project_code: projCode,
    projectCode: projCode,
    title: p.title || '',
    customer_id: p.customerId ?? p.customer_id ?? null,
    customerId: p.customerId ?? p.customer_id ?? null,
    customer_name: custName,
    customerName: custName,
    item_id: p.itemId ?? p.item_id ?? null,
    itemId: p.itemId ?? p.item_id ?? null,
    item_code: itemCode,
    itemCode: itemCode,
    item_name: itemName,
    itemName: itemName,
    quantity: typeof p.quantity === 'number' ? p.quantity : (Number(p.quantity) || 1),
    unit: p.unit || 'عدد',
    start_date: p.startDate ?? p.start_date ?? '',
    startDate: p.startDate ?? p.start_date ?? '',
    end_date: p.endDate ?? p.end_date ?? '',
    endDate: p.endDate ?? p.end_date ?? '',
    status: p.status || 'planned',
    priority: p.priority || 'medium',
    description: p.description || '',
    created_at: p.createdAt ?? p.created_at ?? '',
    createdAt: p.createdAt ?? p.created_at ?? '',
    created_by: p.createdBy ?? p.created_by ?? '',
    createdBy: p.createdBy ?? p.created_by ?? '',
    products,
    inventory_control: inventoryControl,
    inventoryControl: inventoryControl,
    stage_schedules: stageSchedules,
    stageSchedules: stageSchedules,
    custom_stages: customStages,
    customStages: customStages,
    attachments: Array.isArray(p.attachments) ? p.attachments : [],
    is_deleted: p.isDeleted ?? p.is_deleted ?? 0,
    item_image: extra.item_image || extra.itemThumbnail || extra.itemImage || p.item_image || p.itemThumbnail || p.itemImage || '',
    stages,
    total_stages: totalStages,
    totalStages: totalStages,
    completed_stages: completedStages,
    completedStages: completedStages,
    progress_percent: overallProgress,
    progressPercent: overallProgress
  };
}

// ============================================================================
// V3.1.0 / V3.1.16 — پیشرفت ماتریسی SKU × مرحله و اعتبارسنجی تکمیل پروژه
// ============================================================================

export const PRODUCT_PROGRESS_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const;
export type ProductProgressStatus = typeof PRODUCT_PROGRESS_STATUSES[number];

export interface ProjectProductRow {
  item_id?: number | null;
  item_id_raw?: number | null;
  itemId?: number | null;
  item_code?: string;
  itemCode?: string;
  item_name?: string;
  itemName?: string;
  quantity?: number | string;
  unit?: string;
  selected_optional_stages?: string[];
}

export function resolveProductItemId(p: ProjectProductRow): number | null {
  const raw = p.item_id ?? p.itemId ?? (p as unknown as { item_id_raw?: number }).item_id_raw;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// محاسبه مراحل اعمال‌شده برای هر SKU:
// عنوان‌هایی که در انتخاب‌های اختیاریِ «حداقل یک» محصول آمده‌اند = مراحل اختیاری؛
// برای SKU فقط آن‌هایی اعمال می‌شوند که خودش انتخاب کرده است.
export function computeApplicableStageOrders(product: ProjectProductRow, optionalTitles: Set<string>, allStages: { stageOrder: number; title: string }[]): number[] {
  const selected = new Set((product.selected_optional_stages || []).map(t => String(t).trim()));
  return allStages
    .filter(s => !optionalTitles.has(s.title) || selected.has(s.title))
    .map(s => s.stageOrder);
}

export interface ProjectProgressMatrixStatus {
  allMatrixCompleted: boolean;
  totalMatrixCells: number;
  completedMatrixCells: number;
  missingMatrixCells: number;
  reason?: string;
}

// بررسی جامع وضعیت گزینه‌های ماتریس پیشرفت فیزیکی محصولات
// تنها در صورتی true برمی‌گرداند که تمام گزینه‌های اعمال‌شده برای تمام SKUها تیک خورده باشند
export async function getProjectProgressMatrixStatus(
  projectId: number,
  dbInstance: any = orm
): Promise<ProjectProgressMatrixStatus> {
  const [project] = await dbInstance
    .select()
    .from(productionProjects)
    .where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));

  if (!project) {
    return {
      allMatrixCompleted: false,
      totalMatrixCells: 0,
      completedMatrixCells: 0,
      missingMatrixCells: 0,
      reason: 'پروژه یافت نشد'
    };
  }

  const rawStages = await dbInstance
    .select()
    .from(projectStages)
    .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)))
    .orderBy(asc(projectStages.stageOrder));

  if (rawStages.length === 0) {
    return {
      allMatrixCompleted: false,
      totalMatrixCells: 0,
      completedMatrixCells: 0,
      missingMatrixCells: 0,
      reason: 'هیچ مرحله‌ای برای پروژه تعریف نشده است'
    };
  }

  let products = (Array.isArray(project.products) && project.products.length > 0 ? project.products : []) as ProjectProductRow[];
  if (products.length === 0 && project.itemId) {
    products = [{
      item_id: project.itemId,
      item_code: project.itemCode || '',
      item_name: project.itemName || '',
      quantity: project.quantity || 1,
      unit: project.unit || 'عدد'
    }];
  }

  if (products.length === 0) {
    return {
      allMatrixCompleted: false,
      totalMatrixCells: 0,
      completedMatrixCells: 0,
      missingMatrixCells: 0,
      reason: 'هیچ کد کالایی برای پروژه تعریف نشده است'
    };
  }

  const progressRows = await dbInstance
    .select()
    .from(projectProductStageProgress)
    .where(and(eq(projectProductStageProgress.projectId, projectId), eq(projectProductStageProgress.isDeleted, 0)));

  const progressMap = new Map<string, typeof progressRows[number]>();
  for (const row of progressRows) {
    progressMap.set(`${row.itemId}|${row.stageOrder}`, row);
  }

  const optionalTitles = new Set(products.flatMap(p => (p.selected_optional_stages || []).map(t => String(t).trim())));
  const stagesForCompute = rawStages.map(s => ({ stageOrder: s.stageOrder, title: s.title }));

  let totalMatrixCells = 0;
  let completedMatrixCells = 0;

  for (const p of products) {
    const itemId = resolveProductItemId(p);
    if (!itemId) continue;
    const applicableOrders = computeApplicableStageOrders(p, optionalTitles, stagesForCompute);
    for (const order of applicableOrders) {
      totalMatrixCells++;
      const key = `${itemId}|${order}`;
      const row = progressMap.get(key);
      if (row?.status === 'completed') {
        completedMatrixCells++;
      }
    }
  }

  const allMatrixCompleted = totalMatrixCells > 0 && completedMatrixCells === totalMatrixCells;
  return {
    allMatrixCompleted,
    totalMatrixCells,
    completedMatrixCells,
    missingMatrixCells: Math.max(0, totalMatrixCells - completedMatrixCells)
  };
}

// GET /api/projects - List all production projects with summary progress
router.get('/projects', authorizePermission('projects.view', 'projects.create', 'projects.edit', 'documents.view', 'documents.create', 'warehouse.in', 'warehouse.out', 'warehouse.view'), async (req, res) => {
  try {
    const { status, priority, search } = req.query;

    const allProjects = await orm
      .select({
        project: productionProjects,
        itemImage: items.image,
        itemThumbnail: items.thumbnail,
      })
      .from(productionProjects)
      .leftJoin(items, eq(productionProjects.itemId, items.id))
      .where(eq(productionProjects.isDeleted, 0))
      .orderBy(desc(productionProjects.createdAt));

    // Fetch all active stages to calculate progress
    const allStages = await orm
      .select()
      .from(projectStages)
      .where(eq(projectStages.isDeleted, 0))
      .orderBy(asc(projectStages.stageOrder));

    // Map stages to projects
    const stagesByProjectMap = new Map<number, StageLike[]>();
    for (const stage of allStages) {
      if (!stagesByProjectMap.has(stage.projectId)) {
        stagesByProjectMap.set(stage.projectId, []);
      }
      stagesByProjectMap.get(stage.projectId)!.push(stage);
    }

    const result = allProjects.map(({ project, itemImage, itemThumbnail }) => {
      const rawStages = stagesByProjectMap.get(project.id) || [];
      return formatProject(project, rawStages, { itemImage, itemThumbnail });
    });

    // Apply optional client filters
    let filtered = result;

    if (status && typeof status === 'string' && status !== 'all') {
      filtered = filtered.filter(p => p.status === status);
    }

    if (priority && typeof priority === 'string' && priority !== 'all') {
      filtered = filtered.filter(p => p.priority === priority);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(p => 
        (p.project_code && p.project_code.toLowerCase().includes(q)) ||
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.customer_name && p.customer_name.toLowerCase().includes(q)) ||
        (p.item_name && p.item_name.toLowerCase().includes(q)) ||
        (p.item_code && p.item_code.toLowerCase().includes(q))
      );
    }

    res.json(filtered);
  } catch (err) {
    throw err;
  }
});

// GET /api/projects/:id - Get single project details with stages
router.get('/projects/:id', authorizePermission('projects.view', 'projects.create', 'projects.edit', 'documents.view', 'documents.create', 'warehouse.in', 'warehouse.out', 'warehouse.view'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    // همگام‌سازی اتوماتیک مراحل و وضعیت پروژه با پیشرفت SKUها
    await syncProjectStagesAndStatusFromProductProgress(id);

    const [projData] = await orm
      .select({
        project: productionProjects,
        itemImage: items.image,
        itemThumbnail: items.thumbnail,
      })
      .from(productionProjects)
      .leftJoin(items, eq(productionProjects.itemId, items.id))
      .where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));

    if (!projData) return res.status(404).json({ error: 'پروژه مورد نظر یافت نشد' });

    const rawStages = await orm
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, id), eq(projectStages.isDeleted, 0)))
      .orderBy(asc(projectStages.stageOrder));

    const formatted = formatProject(projData.project, rawStages, {
      itemImage: projData.itemImage,
      itemThumbnail: projData.itemThumbnail
    });

    res.json(formatted);
  } catch (err) {
    throw err;
  }
});

// POST /api/projects - Create a new production project with stages
router.post('/projects', authorizePermission('projects.create'), validate(createProjectSchema), async (req, res) => {
  try {
    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, priority, description, initial_stages,
      products, inventory_control, inventoryControl, stage_schedules, stageSchedules,
      custom_stages, customStages, attachments
    } = req.body;

    // Auto generate or uniquify project code
    let projectCode = '';
    if (req.body.project_code !== undefined && req.body.project_code !== null) {
      projectCode = String(req.body.project_code).trim();
    }

    if (!projectCode) {
      const countRes = await orm.select({ count: sql<number>`count(*)` }).from(productionProjects);
      const totalNum = Number(countRes[0]?.count || 0) + 1;
      const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
      const rawYear = new Date().toLocaleDateString('fa-IR-u-ca-persian', { year: 'numeric' });
      const jalaliYear = rawYear.replace(/[۰-۹]/g, d => String(faDigits.indexOf(d))) || '1405';
      projectCode = `PRJ-${jalaliYear}-${totalNum.toString().padStart(3, '0')}`;
    }

    // Ensure projectCode is strictly unique in DB using explicit text casting
    let uniqueCode = String(projectCode);
    let codeCounter = 1;
    while (true) {
      const existing = await orm
        .select({ id: productionProjects.id })
        .from(productionProjects)
        .where(sql`${productionProjects.projectCode} = ${String(uniqueCode)}::text`);
      if (existing.length === 0) break;
      uniqueCode = `${projectCode}-${codeCounter++}`;
    }
    projectCode = String(uniqueCode);

    // Validate FKs
    let validCustomerId: number | null = null;
    if (customer_id && !isNaN(Number(customer_id))) {
      const foundCust = await orm.select({ id: customers.id }).from(customers).where(eq(customers.id, Number(customer_id)));
      if (foundCust.length > 0) validCustomerId = Number(customer_id);
    }

    let validItemId: number | null = null;
    if (item_id && !isNaN(Number(item_id))) {
      const foundItem = await orm.select({ id: items.id }).from(items).where(eq(items.id, Number(item_id)));
      if (foundItem.length > 0) validItemId = Number(item_id);
    }

    const currentUser = req.user?.username || 'سیستم';

    const [newProject] = await orm.insert(productionProjects).values({
      projectCode,
      title: title.trim(),
      customerId: validCustomerId,
      customerName: customer_name || '',
      itemId: validItemId,
      itemCode: item_code || '',
      itemName: item_name || '',
      quantity: quantity ? Number(quantity) : 1,
      unit: unit || 'عدد',
      startDate: start_date || '',
      endDate: end_date || '',
      status: 'planned',
      priority: priority || 'medium',
      description: description || '',
      createdBy: currentUser,
      products: Array.isArray(products) ? products : [],
      inventoryControl: inventoryControl || inventory_control || {},
      stageSchedules: stageSchedules || stage_schedules || {},
      customStages: customStages || custom_stages || [],
      attachments: Array.isArray(attachments) ? attachments : [],
    }).returning();

    // Insert initial stages if provided
    let createdStages: StageLike[] = [];
    if (Array.isArray(initial_stages) && initial_stages.length > 0) {
      const stageValues = initial_stages.map((stg: Record<string, unknown>, index: number) => ({
        projectId: newProject.id,
        stageOrder: index + 1,
        title: typeof stg.title === 'string' && stg.title.trim() ? stg.title.trim() : `مرحله ${index + 1}`,
        status: typeof stg.status === 'string' ? stg.status : 'pending',
        startDate: typeof stg.start_date === 'string' ? stg.start_date : (start_date || ''),
        endDate: typeof stg.end_date === 'string' ? stg.end_date : (end_date || ''),
        assignedPersonnel: Array.isArray(stg.assigned_personnel) ? stg.assigned_personnel : [],
        requiredResources: Array.isArray(stg.required_resources) ? stg.required_resources : [],
        progressPercent: typeof stg.progress_percent === 'number' ? stg.progress_percent : 0,
        notes: typeof stg.notes === 'string' ? stg.notes : ''
      }));

      createdStages = await orm.insert(projectStages).values(stageValues).returning();
    }

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'CREATE',
      entity: 'پروژه تولید',
      entityId: String(newProject.id),
      description: `تعریف پروژه تولید جدید با کد ${newProject.projectCode} (${newProject.title})`
    });

    const formattedNew = formatProject(newProject, createdStages);
    res.status(201).json(formattedNew);
  } catch (err) {
    throw err;
  }
});

// PUT /api/projects/:id - Edit project details
router.put('/projects/:id', authorizePermission('projects.edit'), validate(updateProjectSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const [existing] = await orm.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
    if (!existing) return res.status(404).json({ error: 'پروژه یافت نشد' });

    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, status, priority, description 
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    
    if (req.body.project_code !== undefined && req.body.project_code !== null && String(req.body.project_code).trim()) {
      let requestedCode = String(req.body.project_code).trim();
      let uniqueCode = requestedCode;
      let codeCounter = 1;
      while (true) {
        const existingCode = await orm
          .select({ id: productionProjects.id })
          .from(productionProjects)
          .where(sql`${productionProjects.projectCode} = ${String(uniqueCode)}::text`);
        if (existingCode.length === 0 || existingCode[0].id === id) break;
        uniqueCode = `${requestedCode}-${codeCounter++}`;
      }
      updateData.projectCode = String(uniqueCode);
    }

    if (customer_id !== undefined) {
      if (customer_id && !isNaN(Number(customer_id))) {
        const foundCust = await orm.select({ id: customers.id }).from(customers).where(eq(customers.id, Number(customer_id)));
        updateData.customerId = foundCust.length > 0 ? Number(customer_id) : null;
      } else {
        updateData.customerId = null;
      }
    }

    if (customer_name !== undefined) updateData.customerName = customer_name;

    if (item_id !== undefined) {
      if (item_id && !isNaN(Number(item_id))) {
        const foundItem = await orm.select({ id: items.id }).from(items).where(eq(items.id, Number(item_id)));
        updateData.itemId = foundItem.length > 0 ? Number(item_id) : null;
      } else {
        updateData.itemId = null;
      }
    }
    if (item_code !== undefined) updateData.itemCode = item_code;
    if (item_name !== undefined) updateData.itemName = item_name;
    if (quantity !== undefined) updateData.quantity = Number(quantity);
    if (unit !== undefined) updateData.unit = unit;
    if (start_date !== undefined) updateData.startDate = start_date;
    if (end_date !== undefined) updateData.endDate = end_date;
    if (status !== undefined) {
      if (status === 'completed') {
        const matrixCheck = await getProjectProgressMatrixStatus(id, orm);
        if (!matrixCheck.allMatrixCompleted) {
          return res.status(400).json({
            error: `امکان تغییر وضعیت پروژه به تکمیل‌شده وجود ندارد؛ هنوز تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات در بخش «پیشرفت به تفکیک کد کالا» تیک نخورده‌اند (${matrixCheck.completedMatrixCells} از ${matrixCheck.totalMatrixCells} مورد تکمیل شده است).`
          });
        }
      }
      updateData.status = status;
    }
    if (priority !== undefined) updateData.priority = priority;
    if (description !== undefined) updateData.description = description;

    if (req.body.products !== undefined) updateData.products = Array.isArray(req.body.products) ? req.body.products : [];
    if (req.body.inventory_control !== undefined || req.body.inventoryControl !== undefined) {
      updateData.inventoryControl = req.body.inventoryControl ?? req.body.inventory_control ?? {};
    }
    if (req.body.stage_schedules !== undefined || req.body.stageSchedules !== undefined) {
      updateData.stageSchedules = req.body.stageSchedules ?? req.body.stage_schedules ?? {};
    }
    if (req.body.custom_stages !== undefined || req.body.customStages !== undefined) {
      updateData.customStages = req.body.customStages ?? req.body.custom_stages ?? [];
    }
    if (req.body.attachments !== undefined) {
      updateData.attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    }

    await orm.update(productionProjects).set(updateData).where(eq(productionProjects.id, id));

    const [updated] = await orm.select().from(productionProjects).where(eq(productionProjects.id, id));
    const rawStages = await orm.select().from(projectStages).where(and(eq(projectStages.projectId, id), eq(projectStages.isDeleted, 0))).orderBy(asc(projectStages.stageOrder));

    const currentUser = req.user?.username || 'سیستم';
    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'UPDATE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `بروزرسانی مشخصات پروژه تولید ${updated.projectCode} (${updated.title})`
    });

    res.json(formatProject(updated, rawStages));
  } catch (err) {
    throw err;
  }
});

// POST /api/projects/:id/add-to-inventory - Add produced project products to warehouse stock
router.post('/projects/:id/add-to-inventory', authorizePermission('projects.edit'), validate(addProjectToInventorySchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { itemsToAdd, markCompleted } = req.body; // array of { itemId: number, quantity: number, notes?: string }
    const currentUser = req.user?.username || 'سیستم';

    const result = await orm.transaction(async (tx) => {
      // Observe Lock Hierarchy using withOrderedLocks: Items (Level 40) -> Production (Level 50)
      const targetItemIds = (itemsToAdd || []).map((e: { itemId: number | string }) => Number(e.itemId)).filter(Boolean);
      await withOrderedLocks(tx, [
        { table: items, ids: targetItemIds, name: 'items' },
        { table: productionProjects, id, name: 'productionProjects' }
      ], async () => true);

      // Read production project
      const [proj] = await tx.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
      if (!proj) {
        throw new NotFoundError('پروژه یافت نشد');
      }

      let addedCount = 0;

      for (const entry of itemsToAdd) {
        const targetItemId = Number(entry.itemId);
        const qtyToAdd = Number(entry.quantity);
        if (!targetItemId || isNaN(targetItemId) || !qtyToAdd || qtyToAdd <= 0) continue;

        const [targetItem] = await tx.select({
          weightedAverageCost: items.weightedAverageCost
        }).from(items).where(eq(items.id, targetItemId)).for('update');

        if (!targetItem) continue;

        // V3.0.7 (TD-054) + V3.1.45 (TD-074): مسیر واحد حرکت انبار (applyStockMovement)؛
        // مبنای قیمت: unitPrice اختیاری ورودی و در نبود آن WAC فعلی کالا
        // (ارزش‌گذاری محافظه‌کارانه محصول تولیدی به قیمت تمام‌شده جاری).
        const oldWac = Number(targetItem.weightedAverageCost || 0);
        const costBasis = Number(entry.unitPrice);
        const unitPrice = !isNaN(costBasis) && costBasis > 0 ? costBasis : oldWac;

        await DocumentService.applyStockMovement(tx, {
          itemId: targetItemId,
          inOut: 'in',
          quantity: qtyToAdd,
          price: unitPrice,
          date: await businessNowIsoDateTime(),
          documentType: 'پروژه تولید',
          documentRef: proj.projectCode,
          user: currentUser,
          targetLoc: entry.location ? String(entry.location).trim() : '',
          notes: entry.notes || `ورود حاصل از تکمیل پروژه ${proj.title} (${proj.projectCode})`
        });

        addedCount++;
      }

      // Mark project as completed if requested
      if (markCompleted) {
        const matrixCheck = await getProjectProgressMatrixStatus(id, tx);
        if (!matrixCheck.allMatrixCompleted) {
          throw new ValidationError(`امکان تغییر وضعیت پروژه به تکمیل‌شده وجود ندارد؛ هنوز تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات در بخش «پیشرفت به تفکیک کد کالا» تیک نخورده‌اند (${matrixCheck.completedMatrixCells} از ${matrixCheck.totalMatrixCells} مورد تکمیل شده است).`);
        }
        await tx.update(productionProjects).set({ status: 'completed' }).where(eq(productionProjects.id, id));
      }

      return { addedCount, projectCode: proj.projectCode };
    });

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'UPDATE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `افزایش موجودی انبار بابت تحویل ${result.addedCount} قلم محصول از پروژه ${result.projectCode}`
    });

    res.json({
      success: true,
      message: 'محصولات با موفقیت به موجودی انبار افزوده شدند',
      addedCount: result.addedCount
    });
  } catch (err) {
    throw err;
  }
});

// DELETE /api/projects/:id - Soft delete project and stages
router.delete('/projects/:id', authorizePermission('projects.delete'), validate(paramsIdSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const [existing] = await orm.select().from(productionProjects).where(and(eq(productionProjects.id, id), eq(productionProjects.isDeleted, 0)));
    if (!existing) return res.status(404).json({ error: 'پروژه یافت نشد' });

    await orm.update(productionProjects).set({ isDeleted: 1 }).where(eq(productionProjects.id, id));
    await orm.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.projectId, id));

    const currentUser = req.user?.username || 'سیستم';
    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'DELETE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `حذف پروژه تولید ${existing.projectCode} (${existing.title})`
    });

    res.json({ success: true, message: 'پروژه با موفقیت حذف گردید' });
  } catch (err) {
    throw err;
  }
});

// POST /api/projects/:id/stages - Add a stage to project
router.post('/projects/:id/stages', authorizePermission('projects.edit'), validate(createProjectStageSchema), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const { title, status, start_date, end_date, assigned_personnel, required_resources, notes } = req.body;

    // Get max order
    const existingStages = await orm
      .select()
      .from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));

    const nextOrder = existingStages.length + 1;

    const [newStage] = await orm.insert(projectStages).values({
      projectId,
      stageOrder: nextOrder,
      title: title.trim(),
      status: status || 'pending',
      startDate: start_date || '',
      endDate: end_date || '',
      assignedPersonnel: Array.isArray(assigned_personnel) ? assigned_personnel : [],
      requiredResources: Array.isArray(required_resources) ? required_resources : [],
      progressPercent: status === 'completed' ? 100 : 0,
      notes: notes || '',
    }).returning();

    res.status(201).json(formatStage(newStage));
  } catch (err) {
    throw err;
  }
});

// PUT /api/projects/:id/stages/:stageId - Update a stage
router.put('/projects/:id/stages/:stageId', authorizePermission('projects.edit'), validate(updateProjectStageSchema), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);
    if (isNaN(projectId) || isNaN(stageId)) {
      return res.status(400).json({ error: 'شناسه‌ها نامعتبر هستند' });
    }

    const [existing] = await orm.select().from(projectStages).where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)));
    if (!existing) return res.status(404).json({ error: 'مرحله یافت نشد' });

    const { 
      title, stage_order, status, start_date, end_date, 
      assigned_personnel, required_resources, progress_percent, notes 
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (stage_order !== undefined) updateData.stageOrder = Number(stage_order);
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'completed') {
        updateData.progressPercent = 100;
        updateData.completedAt = new Date().toISOString();
      }
    }
    if (start_date !== undefined) updateData.startDate = start_date;
    if (end_date !== undefined) updateData.endDate = end_date;
    if (assigned_personnel !== undefined) updateData.assignedPersonnel = Array.isArray(assigned_personnel) ? assigned_personnel : [];
    if (required_resources !== undefined) updateData.requiredResources = Array.isArray(required_resources) ? required_resources : [];
    if (progress_percent !== undefined) {
      const p = Math.min(100, Math.max(0, Number(progress_percent)));
      updateData.progressPercent = p;
      if (p === 100 && existing.status !== 'completed') {
        updateData.status = 'completed';
        updateData.completedAt = new Date().toISOString();
      } else if (p > 0 && p < 100 && existing.status === 'pending') {
        updateData.status = 'in_progress';
      }
    }
    if (notes !== undefined) updateData.notes = notes;

    await orm.update(projectStages).set(updateData).where(eq(projectStages.id, stageId));

    // همگام‌سازی مجدد و خودکار مراحل و وضعیت پروژه بر اساس پیشرفت SKUها
    const syncRes = await syncProjectStagesAndStatusFromProductProgress(projectId);
    const targetStage = syncRes?.stages?.find(s => s.id === stageId);
    const [updatedStage] = targetStage 
      ? [targetStage] 
      : await orm.select().from(projectStages).where(eq(projectStages.id, stageId));

    res.json(formatStage(updatedStage));
  } catch (err) {
    throw err;
  }
});

// DELETE /api/projects/:id/stages/:stageId - Delete a stage
router.delete('/projects/:id/stages/:stageId', authorizePermission('projects.edit'), validate(deleteProjectStageSchema), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);

    const [existing] = await orm.select().from(projectStages).where(and(eq(projectStages.id, stageId), eq(projectStages.projectId, projectId)));
    if (!existing) return res.status(404).json({ error: 'مرحله یافت نشد' });

    await orm.update(projectStages).set({ isDeleted: 1 }).where(eq(projectStages.id, stageId));

    res.json({ success: true, message: 'مرحله با موفقیت حذف شد' });
  } catch (err) {
    throw err;
  }
});

// همگام‌سازی خودکار درصد پیشرفت و وضعیت هر مرحله و کل پروژه بر اساس ماتریس SKUها
export async function syncProjectStagesAndStatusFromProductProgress(projectId: number) {
  const [project] = await orm.select().from(productionProjects).where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
  if (!project) return null;

  const rawStages = await orm.select().from(projectStages)
    .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)))
    .orderBy(asc(projectStages.stageOrder));

  const products = (Array.isArray(project.products) ? project.products : []) as ProjectProductRow[];

  if (rawStages.length === 0) return { project, stages: [] };

  const progressRows = await orm.select().from(projectProductStageProgress)
    .where(and(eq(projectProductStageProgress.projectId, projectId), eq(projectProductStageProgress.isDeleted, 0)));

  const progressMap = new Map<string, typeof progressRows[number]>();
  for (const row of progressRows) {
    progressMap.set(`${row.itemId}|${row.stageOrder}`, row);
  }

  const optionalTitles = new Set(products.flatMap(p => (p.selected_optional_stages || []).map(t => String(t).trim())));
  const stagesForCompute = rawStages.map(s => ({ stageOrder: s.stageOrder, title: s.title }));

  const productRows = products.map(p => {
    const itemId = resolveProductItemId(p);
    const applicableOrders = itemId ? computeApplicableStageOrders(p, optionalTitles, stagesForCompute) : [];
    let completedCount = 0;
    for (const order of applicableOrders) {
      const key = `${itemId}|${order}`;
      const row = progressMap.get(key);
      if (row?.status === 'completed') completedCount++;
    }
    const percent = applicableOrders.length > 0 ? Math.round((completedCount / applicableOrders.length) * 100) : 0;
    return {
      itemId,
      quantity: Number(p.quantity) || 0,
      applicableOrders,
      completedCount,
      percent
    };
  });

  const bizNow = await businessNowIsoDateTime();

  let anyProgressDetected = false;
  let allStagesCompleted = rawStages.length > 0;
  const updatedStages: (typeof rawStages[number] & { completedSkusCount?: number; applicableSkusCount?: number })[] = [];

  for (const stg of rawStages) {
    const applicableProducts = productRows.filter(p => p.itemId && p.applicableOrders.includes(stg.stageOrder));
    const applicableCount = applicableProducts.length;
    let completedCount = 0;
    for (const p of applicableProducts) {
      const key = `${p.itemId}|${stg.stageOrder}`;
      const row = progressMap.get(key);
      if (row?.status === 'completed') completedCount++;
    }

    let calculatedPercent = 0;
    let calculatedStatus = 'pending';

    if (applicableCount > 0) {
      calculatedPercent = Math.round((completedCount / applicableCount) * 100);
      if (completedCount === applicableCount) {
        calculatedStatus = 'completed';
      } else if (completedCount > 0) {
        calculatedStatus = 'in_progress';
      } else {
        calculatedStatus = stg.status === 'blocked' ? 'blocked' : 'pending';
      }
    } else {
      calculatedPercent = Number(stg.progressPercent || 0);
      calculatedStatus = stg.status || 'pending';
    }

    if (completedCount > 0 || calculatedPercent > 0) {
      anyProgressDetected = true;
    }
    if (calculatedStatus !== 'completed') {
      allStagesCompleted = false;
    }

    const completedAt = calculatedStatus === 'completed' ? (stg.completedAt || bizNow) : null;

    if (stg.progressPercent !== calculatedPercent || stg.status !== calculatedStatus) {
      await orm.update(projectStages).set({
        progressPercent: calculatedPercent,
        status: calculatedStatus,
        completedAt
      }).where(eq(projectStages.id, stg.id));
    }

    updatedStages.push({
      ...stg,
      progressPercent: calculatedPercent,
      status: calculatedStatus,
      completedAt,
      completedSkusCount: completedCount,
      applicableSkusCount: applicableCount
    });
  }

  // وضعیت کل پروژه:
  // ۱) اگر تمام موارد سفارش به انبار ارسال شده و همه مراحل برای تمام کالاها تکمیل شده است -> completed
  // ۲) اگر هرگونه پیشرفتی در هر SKU یا مرحله‌ای انجام شده است -> از planned به in_progress تغییر می‌یابد
  const totalQty = productRows.reduce((acc, p) => acc + p.quantity, 0);
  const weightedProgress = totalQty > 0
    ? Math.round(productRows.reduce((acc, p) => acc + (p.percent * p.quantity), 0) / totalQty)
    : 0;

  const allProductsDone = productRows.length > 0 && productRows.every(p => p.applicableOrders.length > 0 && p.completedCount === p.applicableOrders.length);
  const isOverallCompleted = allProductsDone || (allStagesCompleted && rawStages.length > 0);

  let newProjectStatus = project.status;
  if (isOverallCompleted) {
    newProjectStatus = 'completed';
  } else if (anyProgressDetected || weightedProgress > 0) {
    if (project.status === 'planned' || project.status === 'completed') {
      newProjectStatus = 'in_progress';
    }
  } else if (!anyProgressDetected && weightedProgress === 0 && project.status === 'completed') {
    newProjectStatus = 'in_progress';
  }

  if (newProjectStatus !== project.status) {
    await orm.update(productionProjects).set({ status: newProjectStatus }).where(eq(productionProjects.id, projectId));
    project.status = newProjectStatus;
  }

  return {
    project,
    stages: updatedStages,
    weightedProgress
  };
}

// GET /api/projects/:id/product-progress — ماتریس کامل پیشرفت SKUها
router.get('/projects/:id/product-progress', authorizePermission('projects.view', 'projects.edit', 'projects.create', 'warehouse.view', 'documents.view'), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    // همگام‌سازی پیش از پاسخ
    await syncProjectStagesAndStatusFromProductProgress(projectId);

    const [project] = await orm.select().from(productionProjects).where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0)));
    if (!project) return res.status(404).json({ error: 'پروژه یافت نشد' });

    const stages = await orm.select().from(projectStages)
      .where(and(eq(projectStages.projectId, projectId), eq(projectStages.isDeleted, 0)))
      .orderBy(asc(projectStages.stageOrder));

    const products = (Array.isArray(project.products) ? project.products : []) as ProjectProductRow[];

    const progressRows = await orm.select().from(projectProductStageProgress)
      .where(and(eq(projectProductStageProgress.projectId, projectId), eq(projectProductStageProgress.isDeleted, 0)));

    const progressMap = new Map<string, typeof progressRows[number]>();
    for (const row of progressRows) {
      progressMap.set(`${row.itemId}|${row.stageOrder}`, row);
    }

    const optionalTitles = new Set(products.flatMap(p => (p.selected_optional_stages || []).map(t => String(t).trim())));

    const stageMeta = stages.map(s => ({ stage_order: s.stageOrder, title: s.title, status: s.status }));
    const stagesForCompute = stages.map(s => ({ stageOrder: s.stageOrder, title: s.title }));
    const allStageOrders = stages.map(s => s.stageOrder);

    const productRows = products.map(p => {
      const itemId = resolveProductItemId(p);
      const applicableOrders = itemId
        ? computeApplicableStageOrders(p, optionalTitles, stagesForCompute)
        : [];
      const qty = Number(p.quantity) || 0;
      const code = p.item_code ?? p.itemCode ?? '';
      const name = p.item_name ?? p.itemName ?? '';

      let completedCount = 0;
      const progress = applicableOrders.map(order => {
        const stageInfo = stageMeta.find(s => s.stage_order === order);
        const key = `${itemId}|${order}`;
        const row = progressMap.get(key);
        const status = row?.status || 'pending';
        if (status === 'completed') completedCount++;
        return {
          stage_order: order,
          stage_title: row?.stageTitle || stageInfo?.title || '',
          status,
          updated_at: row?.updatedAt || '',
          updated_by_name: row?.updatedByName || ''
        };
      });
      // مراحل پروژه که برای این SKU اعمال نمی‌شوند (اختیاری انتخاب‌نشده)
      const excludedOrders = allStageOrders.filter(o => !applicableOrders.includes(o));
      const percent = applicableOrders.length > 0 ? Math.round((completedCount / applicableOrders.length) * 100) : 0;

      return {
        item_id: itemId,
        item_code: code,
        item_name: name,
        quantity: qty,
        unit: p.unit || 'عدد',
        applicable_stage_orders: applicableOrders,
        excluded_stage_orders: excludedOrders,
        progress,
        completed_count: completedCount,
        applicable_count: applicableOrders.length,
        progress_percent: percent
      };
    });

    // رول‌آپ وزن‌دار کل پروژه
    const totalQty = productRows.reduce((acc, p) => acc + (Number(p.quantity) || 0), 0);
    const weightedProgress = totalQty > 0
      ? Math.round(productRows.reduce((acc, p) => acc + (p.progress_percent * (Number(p.quantity) || 0)), 0) / totalQty)
      : 0;
    const fullyCompletedSkus = productRows.filter(p => p.applicable_count > 0 && p.completed_count === p.applicable_count).length;

    const totalMatrixCells = productRows.reduce((acc, p) => acc + (p.applicable_count || 0), 0);
    const completedMatrixCells = productRows.reduce((acc, p) => acc + (p.completed_count || 0), 0);
    const allMatrixCompleted = totalMatrixCells > 0 && completedMatrixCells === totalMatrixCells;

    const perStageCounts = stageMeta.map(s => ({
      stage_order: s.stage_order,
      title: s.title,
      completed_count: productRows.filter(p => p.applicable_stage_orders.includes(s.stage_order) && p.progress.some(pr => pr.stage_order === s.stage_order && pr.status === 'completed')).length,
      applicable_skus: productRows.filter(p => p.applicable_stage_orders.includes(s.stage_order)).length
    }));

    res.json({
      success: true,
      data: {
        stages: stageMeta,
        products: productRows,
        summary: {
          total_skus: productRows.length,
          total_quantity: totalQty,
          weighted_progress_percent: weightedProgress,
          fully_completed_skus: fullyCompletedSkus,
          per_stage_counts: perStageCounts,
          total_matrix_cells: totalMatrixCells,
          completed_matrix_cells: completedMatrixCells,
          all_matrix_completed: allMatrixCompleted,
          missing_matrix_cells: Math.max(0, totalMatrixCells - completedMatrixCells)
        }
      }
    });
  } catch (err) {
    throw err;
  }
});

// PUT /api/projects/:id/product-progress — بولک آپسِرت وضعیت دودویی هر SKU در هر مرحله
const updateProductProgressSchema = z.object({
  body: z.object({
    items: z.array(z.object({
      item_id: z.union([z.number(), z.string()]),
      item_code: z.string().optional(),
      item_name: z.string().optional(),
      quantity: z.union([z.number(), z.string()]).optional(),
      stage_order: z.union([z.number(), z.string()]),
      stage_title: z.string().optional(),
      status: z.enum(PRODUCT_PROGRESS_STATUSES)
    })).min(1, 'حداقل یک تغییر وضعیت الزامی است')
  })
});

router.put('/projects/:id/product-progress', authorizePermission('projects.edit'), validate(updateProductProgressSchema), async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const [project] = await orm.select().from(productionProjects).where(and(eq(productionProjects.id, projectId), eq(productionProjects.isDeleted, 0))).for('update');
    if (!project) return res.status(404).json({ error: 'پروژه یافت نشد' });

    const products = (Array.isArray(project.products) ? project.products : []) as ProjectProductRow[];
    const productByItemId = new Map<number, ProjectProductRow>();
    for (const p of products) {
      const id = resolveProductItemId(p);
      if (id) productByItemId.set(id, p);
    }

    const bizNow = await businessNowIsoDateTime();
    const currentUser = req.user?.username || 'سیستم';
    const updates = req.body.items as Array<{ item_id: number | string; stage_order: number | string; stage_title?: string; status: ProductProgressStatus }>;

    let applied = 0;
    let skippedInvalid = 0;
    await orm.transaction(async (tx) => {
      for (const u of updates) {
        const itemId = Number(u.item_id);
        const stageOrder = Number(u.stage_order);
        if (!Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(stageOrder) || stageOrder <= 0 || !PRODUCT_PROGRESS_STATUSES.includes(u.status)) {
          skippedInvalid++;
          continue;
        }
        const product = productByItemId.get(itemId);
        if (!product) {
          // SKU باید جزو products تعریف‌شده پروژه باشد
          skippedInvalid++;
          continue;
        }

        const stageRow = await tx.select({ id: projectStages.id, title: projectStages.title }).from(projectStages)
          .where(and(eq(projectStages.projectId, projectId), eq(projectStages.stageOrder, stageOrder), eq(projectStages.isDeleted, 0)))
          .limit(1);
        const stageTitle = stageRow[0]?.title || String(u.stage_title || '').trim() || `مرحله ${stageOrder}`;

        await tx.insert(projectProductStageProgress).values({
          projectId,
          itemId,
          itemCode: product.item_code ?? product.itemCode ?? '',
          itemName: product.item_name ?? product.itemName ?? '',
          quantity: Number(product.quantity) || 0,
          stageOrder,
          stageTitle,
          status: u.status,
          updatedAt: bizNow,
          updatedByName: currentUser,
          isDeleted: 0
        }).onConflictDoUpdate({
          target: [projectProductStageProgress.projectId, projectProductStageProgress.itemId, projectProductStageProgress.stageOrder],
          set: {
            status: u.status,
            stageTitle,
            quantity: Number(product.quantity) || 0,
            updatedAt: bizNow,
            updatedByName: currentUser
          }
        });
        applied++;
      }
    });

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: 'پیشرفت به تفکیک کد کالا',
      entityId: String(projectId),
      description: `بروزرسانی پیشرفت ماتریسی SKU×مرحله پروژه ${project.projectCode}: ${applied} تغییر اعمال شد`
    });

    // همگام‌سازی اتوماتیک مراحل و وضعیت پروژه
    const syncResult = await syncProjectStagesAndStatusFromProductProgress(projectId);

    res.json({ 
      success: true, 
      applied, 
      skipped_invalid: skippedInvalid,
      project_status: syncResult?.project?.status || project.status,
      weighted_progress_percent: syncResult?.weightedProgress || 0
    });
  } catch (err) {
    throw err;
  }
});

export default router;
