import { Router } from 'express';
import { eq, desc, and, asc } from 'drizzle-orm';
import { orm } from '../db/drizzle.js';
import { productionProjects, projectStages, items, projectProductStageProgress } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authorizePermission } from '../middleware/authorize.js';
import { READ_PERMISSIONS, RECORD_READ_PERMISSIONS } from '../lib/recordReadPermissions.js';
import { parsePickListLimit } from '../lib/pagination.js';
import { listProjectPicks } from '../services/projects/projectPickList.js';
import { logActivity } from '../lib/auditLogger.js';
import { z } from 'zod';
import { validate, paramsIdSchema, numericIdString } from '../middleware/validate.js';
import { ProjectService } from '../services/projects.service.js';
import { idempotency } from '../middleware/idempotency.js';

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
    markCompleted: z.boolean().optional(),
    // v8.0.72 (TD-327): دلیل تحویل بیش از مقدار برنامه‌ریزی‌شده پروژه
    overDeliveryReason: z.string().max(500).optional()
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
  projectId: number;
  stageOrder: number;
  title: string;
  status: string;
  startDate: string;
  endDate: string;
  assignedPersonnel: unknown[];
  requiredResources: unknown[];
  progressPercent: number;
  notes: string;
  completedAt: string;
  isDeleted: number;
  completedSkusCount?: number;
  applicableSkusCount?: number;

  // Compatibility aliases for legacy consumers
  project_id?: number;
  stage_order?: number;
  start_date?: string;
  end_date?: string;
  assigned_personnel?: unknown[];
  required_resources?: unknown[];
  progress_percent?: number;
  completed_at?: string;
  is_deleted?: number;
  completed_skus_count?: number;
  applicable_skus_count?: number;
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

export function formatStage(s: StageLike | null | undefined): FormattedStage | null {
  if (!s) return null;
  const projectId = Number(s.projectId ?? s.project_id ?? 0);
  const stageOrder = Number(s.stageOrder ?? s.stage_order ?? 1);
  const startDate = String(s.startDate ?? s.start_date ?? '');
  const endDate = String(s.endDate ?? s.end_date ?? '');
  const completedAt = String(s.completedAt ?? s.completed_at ?? '');
  const assignedPersonnel = Array.isArray(s.assignedPersonnel) 
    ? s.assignedPersonnel 
    : (Array.isArray(s.assigned_personnel) ? s.assigned_personnel : []);
  const requiredResources = Array.isArray(s.requiredResources) 
    ? s.requiredResources 
    : (Array.isArray(s.required_resources) ? s.required_resources : []);
  const progressPercent = Number(s.progressPercent ?? s.progress_percent ?? 0);
  const compSkus = s.completedSkusCount ?? s.completed_skus_count;
  const appSkus = s.applicableSkusCount ?? s.applicable_skus_count;
  const isDeleted = Number(s.isDeleted ?? s.is_deleted ?? 0);

  return {
    id: s.id,
    projectId,
    stageOrder,
    title: s.title || '',
    status: s.status || 'pending',
    startDate,
    endDate,
    assignedPersonnel,
    requiredResources,
    progressPercent,
    notes: s.notes || '',
    completedAt,
    isDeleted,
    completedSkusCount: compSkus !== undefined && compSkus !== null ? Number(compSkus) : undefined,
    applicableSkusCount: appSkus !== undefined && appSkus !== null ? Number(appSkus) : undefined,

    // Aliases
    project_id: projectId,
    stage_order: stageOrder,
    start_date: startDate,
    end_date: endDate,
    assigned_personnel: assignedPersonnel,
    required_resources: requiredResources,
    progress_percent: progressPercent,
    completed_at: completedAt,
    is_deleted: isDeleted,
    completed_skus_count: compSkus !== undefined && compSkus !== null ? Number(compSkus) : undefined,
    applicable_skus_count: appSkus !== undefined && appSkus !== null ? Number(appSkus) : undefined,
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

export function formatProject(
  p: ProjectLike | null | undefined,
  rawStages: StageLike[] = [],
  extra: { itemImage?: string | null; itemThumbnail?: string | null; item_image?: string | null } = {}
) {
  if (!p) return null;
  const stages = (rawStages || []).map(formatStage).filter((s): s is FormattedStage => s !== null);
  const totalStages = stages.length;
  const completedStages = stages.filter((s) => s.status === 'completed').length;
  
  let overallProgress = 0;
  if (totalStages > 0) {
    const sumProgress = stages.reduce((acc: number, s) => acc + (s.progressPercent || (s.status === 'completed' ? 100 : 0)), 0);
    overallProgress = Math.round(sumProgress / totalStages);
  }

  const projectCode = p.projectCode ?? p.project_code ?? '';
  const customerId = p.customerId ?? p.customer_id ?? null;
  const customerName = p.customerName ?? p.customer_name ?? '';
  const itemId = p.itemId ?? p.item_id ?? null;
  const itemCode = p.itemCode ?? p.item_code ?? '';
  const itemName = p.itemName ?? p.item_name ?? '';
  const quantity = typeof p.quantity === 'number' ? p.quantity : (Number(p.quantity) || 1);
  const unit = p.unit || 'عدد';
  const startDate = p.startDate ?? p.start_date ?? '';
  const endDate = p.endDate ?? p.end_date ?? '';
  const status = p.status || 'planned';
  const priority = p.priority || 'medium';
  const description = p.description || '';
  const createdAt = p.createdAt ?? p.created_at ?? '';
  const createdBy = p.createdBy ?? p.created_by ?? '';
  const products = Array.isArray(p.products) ? p.products : [];
  const inventoryControl = p.inventoryControl ?? p.inventory_control ?? {};
  const stageSchedules = p.stageSchedules ?? p.stage_schedules ?? {};
  const customStages = Array.isArray(p.customStages) ? p.customStages : (Array.isArray(p.custom_stages) ? p.custom_stages : []);
  const attachments = Array.isArray(p.attachments) ? p.attachments : [];
  const isDeleted = p.isDeleted ?? p.is_deleted ?? 0;
  const itemImage = extra.item_image || extra.itemThumbnail || extra.itemImage || p.item_image || p.itemThumbnail || p.itemImage || '';

  return {
    id: p.id,
    projectCode,
    title: p.title || '',
    customerId,
    customerName,
    itemId,
    itemCode,
    itemName,
    quantity,
    unit,
    startDate,
    endDate,
    status,
    priority,
    description,
    createdAt,
    createdBy,
    products,
    inventoryControl,
    stageSchedules,
    customStages,
    attachments,
    isDeleted,
    itemImage,
    stages,
    totalStages,
    completedStages,
    progressPercent: overallProgress,

    // Aliases
    project_code: projectCode,
    customer_id: customerId,
    customer_name: customerName,
    item_id: itemId,
    item_code: itemCode,
    item_name: itemName,
    start_date: startDate,
    end_date: endDate,
    created_at: createdAt,
    created_by: createdBy,
    inventory_control: inventoryControl,
    stage_schedules: stageSchedules,
    custom_stages: customStages,
    is_deleted: isDeleted,
    item_image: itemImage,
    total_stages: totalStages,
    completed_stages: completedStages,
    progress_percent: overallProgress,
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
  const stagesForCompute = rawStages.map((s: any) => ({ stageOrder: s.stageOrder, title: s.title }));

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

const projectPickListValidation = z.object({
  query: z.object({
    status: z.string().max(40).optional(),
    search: z.string().max(200).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
  }).optional(),
});

// v9.0.122 (TD-889، تصمیم ت۱۰ الف): فهرست انتخاب پروژه برای فرم‌های بخش‌های دیگر؛ فهرست کامل پایین فقط با projects.view
router.get('/projects/options', authorizePermission(...READ_PERMISSIONS.projectOptions), validate(projectPickListValidation), asyncHandler(async (req, res) => {
  const query = req.query as { status?: string; search?: string; limit?: string };
  res.json({ success: true, data: await listProjectPicks({ status: query.status, search: query.search, limit: parsePickListLimit(query.limit) }) });
}));

// GET /api/projects - List all production projects with summary progress
router.get('/projects', authorizePermission(...READ_PERMISSIONS.projects), asyncHandler(async (req, res) => {
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
    let filtered = result.filter((p): p is NonNullable<typeof p> => p !== null);

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
}));

// GET /api/projects/:id - Get single project details with stages
router.get('/projects/:id', authorizePermission(...RECORD_READ_PERMISSIONS.production_project), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
}));

// POST /api/projects - Create a new production project with stages
router.post('/projects', authorizePermission('projects.create'), validate(createProjectSchema), asyncHandler(async (req, res) => {
  try {
    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, priority, description, initial_stages,
      products, inventory_control, inventoryControl, stage_schedules, stageSchedules,
      custom_stages, customStages, attachments, project_code
    } = req.body;

    const currentUser = req.user?.username || 'سیستم';

    const { project: newProject, stages: createdStages } = await ProjectService.createProject({
      title,
      projectCode: project_code,
      customerId: customer_id,
      customerName: customer_name,
      itemId: item_id,
      itemCode: item_code,
      itemName: item_name,
      quantity,
      unit,
      startDate: start_date,
      endDate: end_date,
      priority,
      description,
      initialStages: initial_stages,
      products,
      inventoryControl: inventoryControl || inventory_control,
      stageSchedules: stageSchedules || stage_schedules,
      customStages: customStages || custom_stages,
      attachments,
      createdBy: currentUser
    });

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
}));

// PUT /api/projects/:id - Edit project details
router.put('/projects/:id', authorizePermission('projects.edit'), validate(updateProjectSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const { 
      title, customer_id, customer_name, item_id, item_code, item_name, 
      quantity, unit, start_date, end_date, status, priority, description,
      products, inventory_control, inventoryControl, stage_schedules, stageSchedules,
      custom_stages, customStages, attachments, project_code
    } = req.body;

    if (status === 'completed') {
      const matrixCheck = await getProjectProgressMatrixStatus(id, orm);
      if (!matrixCheck.allMatrixCompleted) {
        return res.status(400).json({
          error: `امکان تغییر وضعیت پروژه به تکمیل‌شده وجود ندارد؛ هنوز تمام گزینه‌های ماتریس پیشرفت فیزیکی محصولات در بخش «پیشرفت به تفکیک کد کالا» تیک نخورده‌اند (${matrixCheck.completedMatrixCells} از ${matrixCheck.totalMatrixCells} مورد تکمیل شده است).`
        });
      }
    }

    const { current: updated } = await ProjectService.updateProject(id, {
      title,
      projectCode: project_code,
      customerId: customer_id,
      customerName: customer_name,
      itemId: item_id,
      itemCode: item_code,
      itemName: item_name,
      quantity,
      unit,
      startDate: start_date,
      endDate: end_date,
      status,
      priority,
      description,
      products,
      inventoryControl: inventoryControl ?? inventory_control,
      stageSchedules: stageSchedules ?? stage_schedules,
      customStages: customStages ?? custom_stages,
      attachments
    });

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
}));

// POST /api/projects/:id/add-to-inventory - Add produced project products to warehouse stock
router.post('/projects/:id/add-to-inventory', authorizePermission('projects.edit'), idempotency({ scope: 'project_delivery' }), validate(addProjectToInventorySchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { itemsToAdd, markCompleted, overDeliveryReason } = req.body;
    const currentUser = req.user?.username || 'سیستم';

    const result = await ProjectService.addProjectToInventory({
      projectId: id,
      itemsToAdd,
      markCompleted,
      currentUser,
      userId: req.user?.id,
      overDeliveryReason
    });

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || currentUser,
      action: 'UPDATE',
      entity: 'پروژه تولید',
      entityId: String(id),
      description: `افزایش موجودی انبار بابت تحویل ${result.addedCount} قلم محصول از پروژه ${result.projectCode}${result.refNumber ? ` با رسید تولید ${result.refNumber}` : ''}${result.overDeliveries.length > 0 ? ` (تحویل بیش از برنامه با دلیل: ${overDeliveryReason})` : ''}`,
      ...(result.overDeliveries.length > 0 ? { details: { overDeliveries: result.overDeliveries, overDeliveryReason } } : {})
    });

    res.json({
      success: true,
      message: 'محصولات با موفقیت به موجودی انبار افزوده شدند',
      addedCount: result.addedCount,
      documentId: result.documentId,
      refNumber: result.refNumber
    });
  } catch (err) {
    throw err;
  }
}));

// DELETE /api/projects/:id - Soft delete project and stages
router.delete('/projects/:id', authorizePermission('projects.delete'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const existing = await ProjectService.deleteProject(id);

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
}));

// POST /api/projects/:id/stages - Add a stage to project
router.post('/projects/:id/stages', authorizePermission('projects.edit'), validate(createProjectStageSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const { title, status, start_date, end_date, assigned_personnel, required_resources, notes } = req.body;

    const newStage = await ProjectService.addStage(projectId, {
      title,
      status,
      startDate: start_date,
      endDate: end_date,
      assignedPersonnel: assigned_personnel,
      requiredResources: required_resources,
      notes
    });

    res.status(201).json(formatStage(newStage));
  } catch (err) {
    throw err;
  }
}));

// PUT /api/projects/:id/stages/:stageId - Update a stage
router.put('/projects/:id/stages/:stageId', authorizePermission('projects.edit'), validate(updateProjectStageSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);
    if (isNaN(projectId) || isNaN(stageId)) {
      return res.status(400).json({ error: 'شناسه‌ها نامعتبر هستند' });
    }

    const { 
      title, stage_order, status, start_date, end_date, 
      assigned_personnel, required_resources, progress_percent, notes 
    } = req.body;

    await ProjectService.updateStage(projectId, stageId, {
      title,
      stageOrder: stage_order,
      status,
      startDate: start_date,
      endDate: end_date,
      assignedPersonnel: assigned_personnel,
      requiredResources: required_resources,
      progressPercent: progress_percent,
      notes
    });

    // همگام‌سازی مجدد و خودکار مراحل و وضعیت پروژه بر اساس پیشرفت SKUها
    const syncRes: any = await syncProjectStagesAndStatusFromProductProgress(projectId);
    const targetStage = syncRes?.stages?.find((s: any) => s.id === stageId);
    const [updatedStage] = targetStage 
      ? [targetStage] 
      : await orm.select().from(projectStages).where(eq(projectStages.id, stageId));

    res.json(formatStage(updatedStage));
  } catch (err) {
    throw err;
  }
}));

// DELETE /api/projects/:id/stages/:stageId - Delete a stage
router.delete('/projects/:id/stages/:stageId', authorizePermission('projects.edit'), validate(deleteProjectStageSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const stageId = parseInt(req.params.stageId, 10);

    await ProjectService.deleteStage(projectId, stageId);

    res.json({ success: true, message: 'مرحله با موفقیت حذف شد' });
  } catch (err) {
    throw err;
  }
}));

// همگام‌سازی خودکار درصد پیشرفت و وضعیت هر مرحله و کل پروژه بر اساس ماتریس SKUها
export const syncProjectStagesAndStatusFromProductProgress = ProjectService.syncProjectStagesAndStatusFromProductProgress;


// GET /api/projects/:id/product-progress — ماتریس کامل پیشرفت SKUها
router.get('/projects/:id/product-progress', authorizePermission('projects.view', 'projects.edit', 'projects.create', 'warehouse.view', 'documents.view'), validate(paramsIdSchema), asyncHandler(async (req, res) => {
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
}));

// PUT /api/projects/:id/product-progress — بولک آپسِرت وضعیت دودویی هر SKU در هر مرحله
const updateProductProgressSchema = z.object({
  params: z.object({
    id: numericIdString
  }),
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

router.put('/projects/:id/product-progress', authorizePermission('projects.edit'), validate(updateProductProgressSchema), asyncHandler(async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: 'شناسه پروژه نامعتبر است' });

    const currentUser = req.user?.username || 'سیستم';
    const updates = req.body.items as Array<{ item_id: number | string; stage_order: number | string; stage_title?: string; status: ProductProgressStatus }>;

    const { applied, skippedInvalid } = await ProjectService.updateProductProgress(
      projectId,
      updates.map(u => ({
        itemId: Number(u.item_id),
        stageOrder: Number(u.stage_order),
        stageTitle: u.stage_title,
        status: u.status
      })),
      currentUser
    );

    const [project] = await orm.select({ projectCode: productionProjects.projectCode, status: productionProjects.status }).from(productionProjects).where(eq(productionProjects.id, projectId));

    await logActivity({
      userId: req.user?.id,
      username: currentUser,
      userFullName: req.user?.full_name || '',
      action: 'UPDATE',
      entity: 'پیشرفت به تفکیک کد کالا',
      entityId: String(projectId),
      description: `بروزرسانی پیشرفت ماتریسی SKU×مرحله پروژه ${project?.projectCode || projectId}: ${applied} تغییر اعمال شد`
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
}));

export default router;
